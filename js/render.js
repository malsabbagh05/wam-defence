'use strict';

/**
 * Canvas drawing and visual effects. Reads game state and never changes it.
 * Animations use the renderer's own clock, so they pause when the game is paused.
 * Players who prefer reduced motion get fewer particles, no shake and no bobbing.
 */
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
const MAX_PARTICLES = 500;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOutBack = (x) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.W = DATA.COLS * DATA.TILE;
    this.H = DATA.ROWS * DATA.TILE;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = this.W * dpr;
    canvas.height = this.H * dpr;
    this.ctx = canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.clock = 0;
    this.particles = [];
    this.towerAnim = new Map(); // tower id -> { born, kind: 'place' | 'upgrade' }
    this.fireTimes = new Map(); // tower id -> clock time of the last shot
    this.shake = { t: 0, dur: 1, mag: 0 };
    this.flash = { t: 0, dur: 1, rgb: '255,255,255', a: 0 };
    this.portalFlash = -10;
    this.gatePulse = -10;
  }

  // -------------------------------------------------------------- animation

  /** Advances animation time. dt is in seconds. */
  update(dt) {
    this.clock += dt;
    if (this.shake.t > 0) this.shake.t -= dt;
    if (this.flash.t > 0) this.flash.t -= dt;
    for (const p of this.particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      p.rot += p.vr * dt;
    }
    this.particles = this.particles.filter((p) => p.t < p.life);
  }

  startShake(mag, dur) {
    if (this.reduced) return;
    this.shake = { t: dur, dur, mag };
  }

  startFlash(rgb, a, dur) {
    if (this.reduced) return;
    this.flash = { t: dur, dur, rgb, a };
  }

  /** Spawns a burst of particles at pixel position (x, y). */
  burst(x, y, count, o) {
    const n = this.reduced ? Math.ceil(count * 0.3) : count;
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = o.speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: o.gravity || 0, t: 0, life: o.life * (0.6 + Math.random() * 0.6),
        size: o.size * (0.6 + Math.random() * 0.8),
        color: o.colors[Math.floor(Math.random() * o.colors.length)],
        kind: o.kind || 'dot', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8,
      });
    }
  }

  /** Adds an expanding ring particle. */
  ringAt(x, y, radius, color, life) {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({ x, y, vx: 0, vy: 0, g: 0, t: 0, life, size: radius, color, kind: 'ring', rot: 0, vr: 0 });
  }

  confetti() {
    const colors = ['#ffd54f', '#4fc3f7', '#81c784', '#ff8a65', '#ce93d8', '#ffffff'];
    const n = this.reduced ? 40 : 140;
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: Math.random() * this.W, y: -10 - Math.random() * this.H * 0.6,
        vx: (Math.random() - 0.5) * 60, vy: 50 + Math.random() * 110, g: 30, t: 0,
        life: 4 + Math.random() * 3, size: 4 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        kind: 'square', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  /** Reacts to game events with visual effects. */
  handle(name, d) {
    const T = DATA.TILE;
    switch (name) {
      case 'reset':
        this.particles = [];
        this.towerAnim.clear();
        this.fireTimes.clear();
        this.shake.t = 0;
        this.flash.t = 0;
        break;
      case 'place':
        this.towerAnim.set(d.id, { born: this.clock, kind: 'place' });
        this.burst(d.x * T, d.y * T + T * 0.3, 8, { speed: 60, life: 0.5, size: 3, colors: ['#c9b88a', '#a89868', '#8a7a55'], gravity: 80 });
        this.ringAt(d.x * T, d.y * T, T * 0.7, 'rgba(255,255,255,0.8)', 0.4);
        break;
      case 'upgrade':
        this.towerAnim.set(d.id, { born: this.clock, kind: 'upgrade' });
        this.burst(d.x * T, d.y * T, 12, { speed: 70, life: 0.9, size: 5, colors: ['#ffe082', '#fff59d', '#ffffff'], kind: 'star', gravity: -30 });
        this.ringAt(d.x * T, d.y * T, T * 1.0, 'rgba(255,224,130,0.9)', 0.6);
        break;
      case 'sell':
        this.burst(d.x * T, d.y * T, 12, { speed: 70, life: 0.6, size: 4, colors: ['#ffffff', '#cfd8dc', '#b0bec5'], gravity: -20 });
        break;
      case 'fire':
        this.fireTimes.set(d.id, this.clock);
        break;
      case 'hit':
        this.burst(d.enemy.x * T, d.enemy.y * T, 3, {
          speed: 90, life: 0.3, size: 2.5, gravity: 120,
          colors: d.ai ? ['#d1b3ff', '#b388ff'] : ['#fff59d', '#ffd54f'],
        });
        break;
      case 'miss':
        this.burst(d.x * T, d.y * T - T * 0.4, 6, { speed: 45, life: 0.45, size: 3, colors: ['#b388ff', '#7e57c2', '#ffffff'], kind: 'square' });
        break;
      case 'kill': {
        const def = DATA.enemies[d.type];
        const col = DATA.familyStyle[def.family].color;
        this.burst(d.x * T, d.y * T, def.boss ? 50 : 10, {
          speed: def.boss ? 200 : 110, life: def.boss ? 1.1 : 0.6, size: def.boss ? 6 : 4,
          colors: [col, '#ffffff', '#ffe082'], gravity: 60,
        });
        this.ringAt(d.x * T, d.y * T, def.size * T * (def.boss ? 4 : 2.2), col, def.boss ? 0.8 : 0.4);
        if (def.boss) this.startShake(10, 0.6);
        break;
      }
      case 'leak': {
        const px = DATA.COLS * T - T * 0.5;
        const py = 7.5 * T;
        this.portalFlash = this.clock;
        this.startShake(6, 0.35);
        this.startFlash('255,0,0', 0.3, 0.35);
        this.burst(px, py, 14, { speed: 120, life: 0.7, size: 4, colors: ['#ff6b6b', '#ff8a80', '#ffffff'], gravity: 40 });
        break;
      }
      case 'phase':
        this.startShake(9, 0.5);
        this.startFlash('255,255,255', 0.45, 0.25);
        this.ringAt(d.enemy.x * T, d.enemy.y * T, T * 4, 'rgba(255,255,255,0.9)', 0.7);
        this.ringAt(d.enemy.x * T, d.enemy.y * T, T * 2.5, 'rgba(255,100,80,0.9)', 0.5);
        break;
      case 'spawn':
        if (d.x < 1) this.gatePulse = this.clock;
        if (DATA.enemies[d.type].boss) this.startShake(5, 0.4);
        break;
      case 'waveStart':
        this.gatePulse = this.clock;
        break;
      case 'win':
        this.confetti();
        break;
      case 'lose':
        this.startFlash('0,0,0', 0.5, 0.7);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------- draw

  /** view: { hoverTile, placing, selected } */
  draw(view) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.save();
    if (this.shake.t > 0 && !this.reduced) {
      const m = this.shake.mag * (this.shake.t / this.shake.dur);
      ctx.translate((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * 2 * m);
    }
    this.drawMap();
    this.drawAuras();
    this.drawTowers(view);
    this.drawEnemies();
    this.drawFx();
    this.drawParticles();
    this.drawRanges(view);
    ctx.restore();
    this.drawVignette();
    this.drawFlash();
    this.drawBanner();
  }

  // ------------------------------------------------------------------- map

  drawMap() {
    const ctx = this.ctx;
    const T = DATA.TILE;
    const path = this.game.path;
    for (let r = 0; r < DATA.ROWS; r++) {
      for (let c = 0; c < DATA.COLS; c++) {
        const onPath = path.tiles.has(c + ',' + r);
        if (onPath) ctx.fillStyle = (c + r) % 2 ? '#d9c9a0' : '#e0d1aa';
        else ctx.fillStyle = (c + r) % 2 ? '#3d7a4b' : '#438353';
        ctx.fillRect(c * T, r * T, T, T);
      }
    }

    // Chevrons that flow along the path to show the direction of travel
    const spacing = 1.0;
    const offset = (this.clock * 1.4) % spacing;
    ctx.fillStyle = 'rgba(110,85,40,0.35)';
    for (let d = offset; d < path.total - 0.3; d += spacing) {
      const p = path.at(d);
      const q = path.at(Math.min(path.total, d + 0.1));
      ctx.save();
      ctx.translate(p.x * T, p.y * T);
      ctx.rotate(Math.atan2(q.y - p.y, q.x - p.x));
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(-3, -4.5);
      ctx.lineTo(-1, 0);
      ctx.lineTo(-3, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Deadline Gate (spawn)
    const gx = 0.5 * T;
    const gy = 1.5 * T;
    const gk = (this.clock - this.gatePulse) / 0.8;
    if (gk >= 0 && gk < 1) {
      ctx.beginPath();
      ctx.arc(gx, gy, 10 + 30 * gk, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(229,57,53,' + (1 - gk) + ')';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    this.label('⏰', gx, gy + (this.reduced ? 0 : Math.sin(this.clock * 3) * 1.5), 24);
    this.smallText('DEADLINE', gx, gy + 20);

    // Results Portal (goal)
    const px = 15.5 * T;
    const py = 7.5 * T;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 3);
    const grad = ctx.createRadialGradient(px, py, 2, px, py, 26 + 4 * pulse);
    grad.addColorStop(0, 'rgba(255,224,130,0.75)');
    grad.addColorStop(1, 'rgba(255,224,130,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, 30, 0, Math.PI * 2);
    ctx.fill();
    const lk = (this.clock - this.portalFlash) / 0.5;
    if (lk >= 0 && lk < 1) {
      ctx.beginPath();
      ctx.arc(px, py, 10 + 34 * lk, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(239,83,80,' + (1 - lk) + ')';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    this.label('🎓', px, py + (this.reduced ? 0 : Math.sin(this.clock * 2.2) * 1.5), 24);
    this.smallText('RESULTS', px, py + 20);
  }

  label(text, x, y, size) {
    const ctx = this.ctx;
    ctx.font = size + 'px ' + EMOJI_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(text, x, y);
  }

  smallText(text, x, y) {
    const ctx = this.ctx;
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5a4a2a';
    ctx.fillText(text, x, y);
  }

  // ---------------------------------------------------------------- shapes

  shapePath(shape, x, y, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(x, y, r, 0, Math.PI * 2);
      return;
    }
    const sides = { diamond: 4, square: 4, hexagon: 6, triangle: 3 }[shape] || 4;
    const rot = { diamond: -Math.PI / 2, square: -Math.PI / 4, hexagon: 0, triangle: -Math.PI / 2 }[shape] || 0;
    const rad = shape === 'square' ? r * 1.2 : r * 1.1;
    for (let i = 0; i < sides; i++) {
      const a = rot + (i * Math.PI * 2) / sides;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // ---------------------------------------------------------------- towers

  drawAuras() {
    const ctx = this.ctx;
    const T = DATA.TILE;
    for (const t of this.game.towers) {
      if (t.kind !== 'extension') continue;
      const s = this.game.statsOf(t);
      const pulse = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * 2 + t.id);
      ctx.beginPath();
      ctx.arc(t.x * T, t.y * T, s.range * T, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(79,195,247,' + (0.07 + 0.05 * pulse) + ')';
      ctx.fill();
    }
  }

  drawTowers(view) {
    const ctx = this.ctx;
    const T = DATA.TILE;
    for (const t of this.game.towers) {
      const def = DATA.towers[t.kind];
      const x = t.x * T;
      const y = t.y * T;
      const selected = view.selected === t;

      let scale = 1;
      let glow = 0;
      const a = this.towerAnim.get(t.id);
      if (a) {
        const k = (this.clock - a.born) / (a.kind === 'place' ? 0.4 : 0.5);
        if (k >= 1) {
          this.towerAnim.delete(t.id);
        } else if (a.kind === 'place') {
          scale = 0.2 + 0.8 * easeOutBack(clamp01(k));
        } else {
          scale = 1 + 0.25 * Math.sin(Math.PI * k);
          glow = 1 - k;
        }
      }
      const ft = this.fireTimes.get(t.id);
      if (ft !== undefined) {
        const k = (this.clock - ft) / 0.14;
        if (k < 1) scale *= 1 + 0.14 * (1 - k);
      }
      if (!this.reduced) scale *= 1 + 0.02 * Math.sin(this.clock * 3 + t.id);

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      if (glow > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, T * 0.58, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,235,130,' + glow * 0.6 + ')';
        ctx.fill();
      }
      this.shapePath(def.shape, 0, 0, T * 0.36);
      ctx.fillStyle = def.color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = selected ? 3 : 2;
      ctx.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.55)';
      ctx.stroke();
      this.label(def.emoji, 0, 1, T * 0.5);
      ctx.restore();

      // Short Extension: slowly rotating dashed ring
      if (t.kind === 'extension') {
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.lineDashOffset = -this.clock * 20;
        ctx.beginPath();
        ctx.arc(x, y, T * 0.46, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(79,195,247,0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // Level pips
      for (let i = 0; i <= t.level; i++) {
        ctx.beginPath();
        ctx.arc(x - t.level * 4 + i * 8, y + T * 0.42, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (t.slowed) {
        this.label('💤', x + T * 0.3, y - T * 0.3 + (this.reduced ? 0 : Math.sin(this.clock * 4 + t.id) * 2), 14);
      }

      // Public Holiday pulse progress
      if (t.kind === 'holiday') {
        const s = this.game.statsOf(t);
        const frac = 1 - Math.max(0, Math.min(1, t.cd / s.interval));
        ctx.beginPath();
        ctx.arc(x, y, T * 0.43, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  drawRanges(view) {
    const ctx = this.ctx;
    const T = DATA.TILE;
    const g = this.game;
    let range = null;
    let x = 0;
    let y = 0;
    let color = 'rgba(255,255,255,0.8)';

    if (view.placing && view.hoverTile) {
      const def = DATA.towers[view.placing];
      const { c, r } = view.hoverTile;
      const ok = g.canBuildAt(c, r) && g.sp >= def.cost && !(def.max && g.countOf(view.placing) >= def.max);
      range = def.levels[0].range;
      x = (c + 0.5) * T;
      y = (r + 0.5) * T;

      // Pulsing tile highlight
      const pulse = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * 6);
      ctx.fillStyle = ok ? 'rgba(255,255,255,' + (0.12 + 0.12 * pulse) + ')' : 'rgba(229,57,53,' + (0.2 + 0.15 * pulse) + ')';
      ctx.fillRect(c * T, r * T, T, T);

      // Ghost preview that gently bobs
      ctx.globalAlpha = 0.6;
      this.shapePath(def.shape, x, y - (ok && !this.reduced ? pulse * 2 : 0), T * 0.36);
      ctx.fillStyle = ok ? def.color : '#e53935';
      ctx.fill();
      ctx.globalAlpha = 1;
      this.label(def.emoji, x, y + 1 - (ok && !this.reduced ? pulse * 2 : 0), T * 0.5);
      color = ok ? 'rgba(255,255,255,0.85)' : 'rgba(255,90,90,0.9)';
    } else if (view.selected) {
      range = g.statsOf(view.selected).range;
      x = view.selected.x * T;
      y = view.selected.y * T;
    }
    if (range === null) return;
    ctx.beginPath();
    ctx.arc(x, y, range * T, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -this.clock * 25;
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  // --------------------------------------------------------------- enemies

  /** Ghosts fade out before going invisible and fade back in, using the same timing as the game rules. */
  visibility(e) {
    if (e.type !== 'ghost') return 1;
    const ph = e.t % 5;
    if (ph < 2.7) return 1;
    if (ph < 3) return 1 - ((ph - 2.7) / 0.3) * 0.82;
    if (ph < 4.7) return 0.18;
    return 0.18 + ((ph - 4.7) / 0.3) * 0.82;
  }

  drawEnemies() {
    const ctx = this.ctx;
    const T = DATA.TILE;
    // Draw bigger enemies first so small ones stay visible on top.
    const list = this.game.enemies.filter((e) => e.alive)
      .sort((a, b) => DATA.enemies[b.type].size - DATA.enemies[a.type].size);
    for (const e of list) {
      const def = DATA.enemies[e.type];
      const fam = DATA.familyStyle[def.family];
      const x = e.x * T;
      const y = e.y * T;
      const r = def.size * T;
      const alpha = this.visibility(e);
      const bob = this.reduced ? 0 : Math.sin(this.clock * 9 + e.id * 1.7);
      const spawnScale = e.age < 0.3 ? easeOutBack(clamp01(e.age / 0.3)) : 1;
      const hitPulse = e.flash > 0 ? 1.12 : 1;
      const sway = e.type === 'ghost' && !this.reduced ? Math.sin(this.clock * 3 + e.id) * 3 : 0;

      // Boss aura
      if (def.boss) {
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 4);
        const grad = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * (1.6 + 0.2 * pulse));
        grad.addColorStop(0, 'rgba(255,60,40,0.45)');
        grad.addColorStop(1, 'rgba(255,60,40,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
        ctx.fill();
      }

      // Shadow
      ctx.globalAlpha = 0.25 * alpha;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.9, r * 0.9 * spawnScale, r * 0.3 * spawnScale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Body with a walking bob and squash
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(x + sway, y + bob * 2);
      ctx.scale(spawnScale * hitPulse * (1 + 0.05 * bob), spawnScale * hitPulse * (1 - 0.05 * bob));
      this.shapePath(fam.shape, 0, 0, r);
      ctx.fillStyle = e.flash > 0 ? '#ffffff' : fam.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
      this.label(def.emoji, 0, 1, r * 1.5);
      ctx.restore();

      // Slow effect: pulsing frost ring
      if (e.slow > 0) {
        const pulse = this.reduced ? 0 : Math.sin(this.clock * 6 + e.id);
        ctx.beginPath();
        ctx.arc(x + sway, y + bob * 2, r * 1.15 + 2 + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(79,195,247,0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Paused by a Public Holiday: floating sleep icon
      if (e.pause > 0) {
        this.label('💤', x + r, y - r - 2 + (this.reduced ? 0 : Math.sin(this.clock * 4 + e.id) * 3), 14);
      }
      ctx.globalAlpha = 1;

      // Health bar
      if (e.hp < e.maxHp || def.boss) {
        const w = Math.max(r * 2, 20);
        const bx = x - w / 2;
        const by = y - r - 9;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(bx, by, w, 4);
        ctx.fillStyle = e.hp / e.maxHp > 0.5 ? '#66bb6a' : e.hp / e.maxHp > 0.25 ? '#ffca28' : '#ef5350';
        ctx.fillRect(bx, by, w * Math.max(0, e.hp / e.maxHp), 4);
      }
    }
  }

  // --------------------------------------------------------------- effects

  drawFx() {
    const ctx = this.ctx;
    const T = DATA.TILE;
    for (const f of this.game.fx) {
      const k = f.t / f.life;
      if (f.kind === 'beam') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(f.x1 * T, f.y1 * T);
        ctx.lineTo(f.x2 * T, f.y2 * T);
        ctx.stroke();
        // Bright bolt head travelling to the target
        const h = Math.min(1, k * 2.2);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc((f.x1 + (f.x2 - f.x1) * h) * T, (f.y1 + (f.y2 - f.y1) * h) * T, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (f.kind === 'ring') {
        const rad = f.radius * T * (0.3 + 0.7 * k);
        ctx.globalAlpha = 1 - k;
        ctx.beginPath();
        ctx.arc(f.x * T, f.y * T, rad, 0, Math.PI * 2);
        ctx.fillStyle = f.color;
        ctx.globalAlpha = (1 - k) * 0.12;
        ctx.fill();
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (f.kind === 'text') {
        const pop = 1 + 0.6 * Math.max(0, 1 - f.t / 0.18);
        ctx.globalAlpha = 1 - k * k;
        ctx.font = 'bold ' + Math.round(14 * pop) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(f.text, f.x * T, (f.y - k * 0.8) * T);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x * T, (f.y - k * 0.8) * T);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const k = p.t / p.life;
      ctx.globalAlpha = p.kind === 'square' && p.vy > 40 ? Math.min(1, (1 - k) * 3) : 1 - k;
      if (p.kind === 'ring') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.2 + 0.8 * k), 0, Math.PI * 2);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * (1 - k) + 0.5;
        ctx.stroke();
      } else if (p.kind === 'star') {
        const s = p.size * (1 - k * 0.5);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const rad = i % 2 ? s * 0.35 : s;
          const a = (i * Math.PI) / 4;
          ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'square') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, p.size * (1 - k * 0.6)), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Red pulsing edges when WAM is low, like a heartbeat. */
  drawVignette() {
    const g = this.game;
    if (this.reduced || g.wam > 25 || g.wam <= 0 || g.isOver) return;
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 5);
    const grad = ctx.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.4, this.W / 2, this.H / 2, this.H * 0.95);
    grad.addColorStop(0, 'rgba(255,0,0,0)');
    grad.addColorStop(1, 'rgba(255,0,0,' + (0.18 + 0.2 * pulse) + ')');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  drawFlash() {
    if (this.flash.t <= 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(' + this.flash.rgb + ',' + this.flash.a * (this.flash.t / this.flash.dur) + ')';
    ctx.fillRect(0, 0, this.W, this.H);
  }

  drawBanner() {
    const b = this.game.banner;
    if (!b) return;
    const ctx = this.ctx;
    const enter = clamp01(b.t / 0.35);
    const exit = clamp01((b.life - b.t) / 0.4);
    ctx.globalAlpha = exit;
    ctx.font = 'bold 22px sans-serif';
    const w = ctx.measureText(b.text).width + 40;
    const x = (this.W - w) / 2;
    const y = this.reduced ? 14 : -46 + 60 * easeOutBack(enter);
    ctx.fillStyle = 'rgba(0, 40, 80, 0.88)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, 44, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.text, this.W / 2, y + 23);
    ctx.globalAlpha = 1;
  }
}
