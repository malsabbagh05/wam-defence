'use strict';

/**
 * Game rules and state. This file has no drawing or DOM code, so it can run anywhere.
 */

class Path {
  constructor(points) {
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(x1 - x0, y1 - y0));
    }
    this.total = this.cum[this.cum.length - 1];

    // Tiles covered by the path, stored as "col,row" strings.
    this.tiles = new Set();
    for (let d = 0; d <= this.total; d += 0.1) {
      const p = this.at(d);
      const c = Math.floor(p.x);
      const r = Math.floor(p.y);
      if (c >= 0 && r >= 0 && c < DATA.COLS && r < DATA.ROWS) this.tiles.add(c + ',' + r);
    }
  }

  /** Position (in tile units) at distance d along the path. */
  at(d) {
    d = Math.max(0, Math.min(this.total, d));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const seg = this.cum[i] - this.cum[i - 1];
    const t = seg === 0 ? 0 : (d - this.cum[i - 1]) / seg;
    const [x0, y0] = this.points[i - 1];
    const [x1, y1] = this.points[i];
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
  }
}

class Game {
  constructor(rng) {
    this.rng = rng || Math.random;
    this.path = new Path(DATA.waypoints);
    this.onEvent = null;
    this.godMode = false;
    this.reset();
  }

  reset() {
    this.wam = DATA.START_WAM;
    this.sp = DATA.START_SP;
    this.week = 1;
    this.phase = 'prep'; // prep | wave | results | won | lost
    this.towers = [];
    this.enemies = [];
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.fx = [];
    this.banner = null;
    this.nextId = 1;
    this.stats = this.freshStats();
    this.summary = null;
    this.result = null;
    this.time = 0;
    this.emit('reset');
  }

  freshStats() {
    return { defeated: 0, wamLost: 0, spEarned: 0 };
  }

  emit(name, data) {
    if (this.onEvent) this.onEvent(name, data);
  }

  // ---------------------------------------------------------------- helpers

  get isOver() {
    return this.phase === 'won' || this.phase === 'lost';
  }

  gradeFor(wam) {
    return DATA.grades.find((g) => wam >= g.min) || DATA.grades[DATA.grades.length - 1];
  }

  setBanner(text, life) {
    this.banner = { text, life: life || 3, t: 0 };
  }

  addFx(fx) {
    fx.t = 0;
    this.fx.push(fx);
  }

  floatText(x, y, text, color) {
    this.addFx({ kind: 'text', x, y, text, color: color || '#fff', life: 1.1 });
  }

  // ----------------------------------------------------------------- towers

  towerAt(c, r) {
    return this.towers.find((t) => t.c === c && t.r === r) || null;
  }

  canBuildAt(c, r) {
    return c >= 0 && r >= 0 && c < DATA.COLS && r < DATA.ROWS &&
      !this.path.tiles.has(c + ',' + r) && !this.towerAt(c, r);
  }

  statsOf(t) {
    return DATA.towers[t.kind].levels[t.level];
  }

  countOf(kind) {
    return this.towers.filter((t) => t.kind === kind).length;
  }

  /** Chance that one AI Improvement shot hallucinates. */
  hallucChance(t) {
    const others = this.countOf('ai') - (t && this.towers.includes(t) ? 1 : 0);
    return Math.min(0.9, this.statsOf(t).halluc + 0.05 * others);
  }

  placeTower(kind, c, r, free) {
    const def = DATA.towers[kind];
    if (this.isOver) return { ok: false, reason: 'The run is over.' };
    if (!this.canBuildAt(c, r)) return { ok: false, reason: 'You cannot build there.' };
    if (def.max && this.countOf(kind) >= def.max) {
      return { ok: false, reason: 'Only ' + def.max + ' ' + def.name + ' towers allowed.' };
    }
    if (!free && this.sp < def.cost) return { ok: false, reason: 'Not enough SP.' };
    if (!free) this.sp -= def.cost;
    const t = {
      id: this.nextId++, kind, c, r, x: c + 0.5, y: r + 0.5, level: 0,
      cd: kind === 'holiday' ? 2 : 0, invested: free ? 0 : def.cost, slowed: false,
    };
    this.towers.push(t);
    this.emit('place', t);
    return { ok: true, tower: t };
  }

  upgradeCost(t) {
    const next = DATA.towers[t.kind].levels[t.level + 1];
    return next ? next.cost : null;
  }

  upgradeTower(t, free) {
    const cost = this.upgradeCost(t);
    if (cost === null) return { ok: false, reason: 'Already at max level.' };
    if (!free && this.sp < cost) return { ok: false, reason: 'Not enough SP.' };
    if (!free) {
      this.sp -= cost;
      t.invested += cost;
    }
    t.level++;
    this.emit('upgrade', t);
    return { ok: true };
  }

  sellValue(t) {
    return Math.floor(t.invested * DATA.SELL_RATIO);
  }

  sellTower(t) {
    const i = this.towers.indexOf(t);
    if (i < 0) return { ok: false, reason: 'Tower not found.' };
    this.sp += this.sellValue(t);
    this.towers.splice(i, 1);
    this.emit('sell', t);
    return { ok: true };
  }

  /** Demo helper: places the ready-made layout for free, skipping occupied tiles. */
  buildDemoDefence() {
    for (const [kind, c, r, level] of DATA.demoDefence) {
      const res = this.placeTower(kind, c, r, true);
      if (res.ok) {
        res.tower.level = Math.min(level, DATA.towers[kind].levels.length - 1);
      }
    }
  }

  // ------------------------------------------------------------------ waves

  previewWave(week) {
    return DATA.weeks[week - 1].groups.map(([type, count]) => ({ type, count }));
  }

  buildQueue(week) {
    const groups = this.previewWave(week).map((g) => ({ type: g.type, total: g.count, left: g.count }));
    const total = groups.reduce((s, g) => s + g.total, 0);
    const list = [];
    // Interleave groups: always take from the group with the most remaining (relative to its size).
    while (list.length < total) {
      let best = null;
      for (const g of groups) {
        if (g.left > 0 && (!best || g.left / g.total > best.left / best.total)) best = g;
      }
      best.left--;
      list.push({ type: best.type });
    }
    return list;
  }

  startWave() {
    if (this.phase !== 'prep') return false;
    this.spawnQueue = this.buildQueue(this.week);
    this.spawnTimer = 0.6;
    this.phase = 'wave';
    const label = this.week === DATA.EXAM_WEEK ? 'Exam week' : 'Week ' + this.week;
    this.setBanner(label + ': ' + DATA.weeks[this.week - 1].theme, 2.5);
    this.emit('waveStart');
    return true;
  }

  spawnEnemy(type, dist) {
    const def = DATA.enemies[type];
    const d = dist || 0;
    const p = this.path.at(d);
    const hp = def.boss ? def.hp : Math.round(def.hp * DATA.hpScale[this.week - 1]);
    const e = {
      id: this.nextId++, type, hp, maxHp: hp, dist: d, x: p.x, y: p.y,
      alive: true, pause: 0, t: this.rng() * 5, invisible: false, slow: 0,
      speedMul: 1, phase: 1, flash: 0, sprinting: false, age: 0,
    };
    this.enemies.push(e);
    if (type === 'finalexam') {
      this.setBanner('Phase 1: Multiple Choice', 3);
      for (let i = 0; i < 20; i++) this.spawnQueue.push({ type: 'quiz', gap: 0.4 });
    }
    this.emit('spawn', e);
    return e;
  }

  // ----------------------------------------------------------------- combat

  damageEnemy(e, dmg, ignoreArmour) {
    if (!e.alive) return;
    const armour = ignoreArmour ? 0 : (DATA.enemies[e.type].armour || 0);
    e.hp -= Math.max(1, dmg - armour);
    e.flash = 0.1;
    this.emit('hit', { enemy: e, ai: !!ignoreArmour });
    if (e.hp <= 0) {
      this.killEnemy(e);
    } else if (e.type === 'finalexam') {
      this.checkExamPhases(e);
    }
  }

  checkExamPhases(e) {
    const frac = e.hp / e.maxHp;
    if (e.phase < 2 && frac < 0.66) {
      e.phase = 2;
      this.setBanner('Phase 2: Short Answer', 3);
      const mix = ['report', 'ghost', 'report', 'ghost', 'report', 'ghost', 'report', 'report', 'report'];
      for (const type of mix) this.spawnQueue.push({ type });
      this.emit('phase', { phase: 2, enemy: e });
    }
    if (e.phase < 3 && frac < 0.33) {
      e.phase = 3;
      e.speedMul = 1.5;
      this.setBanner('Phase 3: Essay. The exam speeds up!', 3);
      this.spawnQueue.push({ type: 'major' }, { type: 'major' });
      this.emit('phase', { phase: 3, enemy: e });
    }
  }

  killEnemy(e) {
    if (!e.alive) return;
    e.alive = false;
    const def = DATA.enemies[e.type];
    this.sp += def.reward;
    this.stats.defeated++;
    this.stats.spEarned += def.reward;
    if (def.reward) this.floatText(e.x, e.y - 0.3, '+' + def.reward, '#ffe082');
    this.emit('kill', e);
    if (e.type === 'flu') {
      for (const off of [-0.3, 0, 0.3]) {
        this.spawnEnemy('cold', Math.max(0, Math.min(this.path.total - 0.05, e.dist + off)));
      }
    }
    if (e.type === 'finalexam') this.win();
  }

  leakEnemy(e) {
    e.alive = false;
    const def = DATA.enemies[e.type];
    const before = this.wam;
    this.wam = Math.max(this.godMode ? 1 : 0, this.wam - def.dmg);
    this.stats.wamLost += before - this.wam;
    if (def.spPenalty) this.sp = Math.max(0, this.sp - def.spPenalty);
    const p = this.path.at(this.path.total);
    this.floatText(p.x - 1.4, p.y - 0.4, '-' + def.dmg + ' WAM', '#ff6b6b');
    this.emit('leak', e);
    if (this.wam <= 0) this.lose();
  }

  lose() {
    this.phase = 'lost';
    this.result = { wam: 0, grade: null, perfect: false };
    this.emit('lose');
  }

  win() {
    this.phase = 'won';
    this.banner = null;
    this.enemies = [];
    this.spawnQueue = [];
    this.result = { wam: this.wam, grade: this.gradeFor(this.wam), perfect: this.wam === DATA.START_WAM };
    this.emit('win');
  }

  // ----------------------------------------------------------------- update

  update(dt) {
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t >= this.banner.life) this.banner = null;
    }
    this.fx = this.fx.filter((f) => (f.t += dt) < f.life);
    // The simulation runs during a wave. It also runs in prep phase while Demo Mode enemies are on the map.
    const demoActive = this.phase === 'prep' && (this.enemies.length > 0 || this.spawnQueue.length > 0);
    if (this.phase !== 'wave' && !demoActive) return;
    this.time += dt;

    // Spawning
    this.spawnTimer -= dt;
    if (this.spawnQueue.length === 0) {
      this.spawnTimer = Math.max(0, this.spawnTimer);
    } else if (this.spawnTimer <= 0) {
      const next = this.spawnQueue.shift();
      this.spawnEnemy(next.type);
      this.spawnTimer += next.gap || DATA.enemies[next.type].gap;
    }

    const phaseBefore = this.phase;
    this.updateHolidays(dt);
    this.updateEnemies(dt);
    if (this.phase !== phaseBefore) return;
    this.updateTowers(dt);
    if (this.phase !== phaseBefore) return;

    this.enemies = this.enemies.filter((e) => e.alive);
    if (this.phase === 'wave' && this.spawnQueue.length === 0 && this.enemies.length === 0) this.endWave();
  }

  updateHolidays(dt) {
    for (const t of this.towers) {
      if (t.kind !== 'holiday') continue;
      t.cd -= dt;
      if (t.cd > 0) continue;
      const s = this.statsOf(t);
      t.cd = s.interval;
      for (const e of this.enemies) {
        if (e.alive && Math.hypot(e.x - t.x, e.y - t.y) <= s.range) e.pause = Math.max(e.pause, s.pause);
      }
      this.addFx({ kind: 'ring', x: t.x, y: t.y, radius: s.range, color: '#ff8a65', life: 0.8 });
    }
  }

  updateEnemies(dt) {
    const extensions = this.towers.filter((t) => t.kind === 'extension');
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const def = DATA.enemies[e.type];
      e.t += dt;
      e.age += dt;
      if (e.flash > 0) e.flash -= dt;
      if (e.type === 'ghost') e.invisible = e.t % 5 >= 3;

      e.slow = 0;
      if (e.pause > 0) {
        e.pause = Math.max(0, e.pause - dt);
      } else {
        let speed = DATA.speeds[def.speed] * e.speedMul;
        for (const t of extensions) {
          const s = this.statsOf(t);
          if (Math.hypot(e.x - t.x, e.y - t.y) <= s.range) e.slow = Math.max(e.slow, s.slow);
        }
        speed *= 1 - e.slow;
        e.dist += speed * dt;
      }
      const p = this.path.at(e.dist);
      e.x = p.x;
      e.y = p.y;
      if (e.dist >= this.path.total) {
        this.leakEnemy(e);
        if (this.phase === 'lost') return;
      }
    }
  }

  updateTowers(dt) {
    const freeRiders = this.enemies.filter((e) => e.alive && e.type === 'freerider');
    for (const t of this.towers) {
      if (t.kind !== 'lecturer' && t.kind !== 'ai') continue;
      const s = this.statsOf(t);
      t.slowed = freeRiders.some((e) => Math.hypot(e.x - t.x, e.y - t.y) <= 2);
      t.cd = Math.max(0, t.cd - dt * (t.slowed ? 0.7 : 1));
      if (t.cd > 0) continue;

      const targets = this.enemies
        .filter((e) => e.alive && !e.invisible && Math.hypot(e.x - t.x, e.y - t.y) <= s.range)
        .sort((a, b) => b.dist - a.dist);
      if (targets.length === 0) continue;
      t.cd = s.interval;
      this.emit('fire', t);

      if (t.kind === 'lecturer') {
        for (const e of targets.slice(0, s.targets)) {
          this.damageEnemy(e, s.damage, false);
          this.addFx({ kind: 'beam', x1: t.x, y1: t.y, x2: e.x, y2: e.y, color: '#ffd54f', life: 0.12 });
        }
      } else {
        const e = targets[0];
        if (this.rng() < this.hallucChance(t)) {
          this.floatText(t.x, t.y - 0.5, '?', '#d1b3ff');
          this.emit('miss', t);
          this.addFx({ kind: 'beam', x1: t.x, y1: t.y, x2: e.x, y2: e.y, color: 'rgba(179,136,255,0.3)', life: 0.12 });
        } else {
          this.damageEnemy(e, s.damage, true);
          this.addFx({ kind: 'beam', x1: t.x, y1: t.y, x2: e.x, y2: e.y, color: '#b388ff', life: 0.15 });
        }
      }
      if (this.isOver) return;
    }
  }

  endWave() {
    if (this.week === DATA.EXAM_WEEK) {
      this.win();
      return;
    }
    this.phase = 'results';
    this.summary = Object.assign({ week: this.week, wam: this.wam }, this.stats);
    this.emit('waveEnd');
  }

  nextWeek() {
    if (this.phase !== 'results') return false;
    return this.goToWeek(this.week + 1, true);
  }

  /** Moves to a week in prep phase. Used by normal play and by Demo Mode jumps. */
  goToWeek(week, giveStipend) {
    if (this.isOver) return false;
    this.week = Math.max(1, Math.min(DATA.EXAM_WEEK, week));
    if (giveStipend) this.sp += DATA.WEEKLY_STIPEND;
    this.enemies = [];
    this.spawnQueue = [];
    this.fx = [];
    this.stats = this.freshStats();
    this.summary = null;
    this.phase = 'prep';
    this.emit('week');
    return true;
  }

  /** Demo helper: removes all enemies; during a wave this also ends the wave. */
  clearEnemies() {
    this.enemies = [];
    this.spawnQueue = [];
    if (this.phase === 'wave') this.endWave();
  }
}

if (typeof module !== 'undefined') module.exports = { Game, Path };
