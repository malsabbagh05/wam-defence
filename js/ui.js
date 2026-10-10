'use strict';

/**
 * Buttons, keyboard, overlays, side panel and the main loop.
 * All text injected into the page comes from data.js (not from the player), so it is safe to use innerHTML.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const T = DATA.TILE;
  const TOWER_KINDS = Object.keys(DATA.towers);

  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /** Small helper for one-off animations. Does nothing for players who prefer reduced motion. */
  function animateEl(el, keyframes, duration) {
    if (reducedMotion || !el.animate) return;
    el.animate(keyframes, { duration, easing: 'ease-out' });
  }

  const game = new Game();
  const canvas = $('game');
  const renderer = new Renderer(canvas, game);

  const app = {
    game,
    demo: false,
    started: false,
    paused: false,
    speed: 1,
    autoStart: false,
    autoTimer: 0,
    overlay: null, // 'title' | 'results' | 'end' | null
    placing: null,
    selected: null,
    hoverTile: null,
    hoverEnemy: null,
    hoverBuild: null,
    demoPanel: null,
    showToast,
    hideOverlay,
    syncAfterChange,
  };
  app.renderer = renderer;
  window.app = app;

  // ----------------------------------------------------------------- toast

  let toastTimer = null;
  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // --------------------------------------------------------------- overlay

  function showOverlay(name, html) {
    app.overlay = name;
    $('overlay').classList.remove('celebrate');
    $('overlay-card').innerHTML = html;
    $('overlay').classList.remove('hidden');
    const primary = $('overlay-card').querySelector('button.primary');
    if (primary) primary.focus();
  }

  function hideOverlay() {
    app.overlay = null;
    $('overlay').classList.add('hidden');
  }

  function guideHtml() {
    const towers = TOWER_KINDS.map((k) => {
      const d = DATA.towers[k];
      return '<tr><td>' + d.emoji + '</td><td><b>' + d.name + '</b> (' + d.cost + ' SP)</td><td>' + d.desc + '</td></tr>';
    }).join('');
    const enemies = Object.keys(DATA.enemies).map((k) => {
      const d = DATA.enemies[k];
      return '<tr><td>' + d.emoji + '</td><td><b>' + d.name + '</b></td><td>' + d.note + '</td></tr>';
    }).join('');
    return '<details><summary>Towers and enemies guide</summary>' +
      '<table class="guide-table">' + towers + '</table>' +
      '<table class="guide-table">' + enemies + '</table></details>';
  }

  function showTitle() {
    const demoFirst = new URLSearchParams(location.search).has('demo');
    showOverlay('title',
      '<h2>WAM Defence</h2>' +
      '<p class="muted">Survive the Semester</p>' +
      '<p>Twelve teaching weeks and one exam stand between you and your results. Your WAM starts at 100. ' +
      'Assignments, bad teammates and sickness walk toward the Results Portal, and every one that gets through costs you marks.</p>' +
      '<ul>' +
      '<li>Pick a tower (keys <b>1</b> to <b>4</b>) and click a green tile to build it.</li>' +
      '<li>Click a tower to upgrade or sell it.</li>' +
      '<li>Press <b>Space</b> to start each week. <b>P</b> pauses and <b>F</b> changes speed.</li>' +
      '<li>Earn Study Points (SP) by defeating enemies. Survive the Final Exam to get your grade.</li>' +
      '</ul>' +
      guideHtml() +
      '<div class="overlay-buttons">' +
      '<button type="button" class="' + (demoFirst ? '' : 'primary') + '" data-act="play">Play</button>' +
      '<button type="button" class="' + (demoFirst ? 'primary' : '') + '" data-act="demo">Demo Mode</button>' +
      '</div>');
  }

  function showResults() {
    const s = game.summary;
    const nextLabel = game.week + 1 === DATA.EXAM_WEEK ? 'Exam week' : 'Week ' + (game.week + 1);
    showOverlay('results',
      '<h2>Week ' + s.week + ' complete</h2>' +
      '<p class="muted">' + DATA.weeks[s.week - 1].theme + '</p>' +
      '<div class="stat-grid">' +
      '<span>Enemies defeated</span><span>' + s.defeated + '</span>' +
      '<span>WAM lost this week</span><span>' + s.wamLost + '</span>' +
      '<span>Study Points earned</span><span>' + s.spEarned + '</span>' +
      '<span>WAM now</span><span>' + s.wam + '</span>' +
      '<span>Stipend for ' + nextLabel + '</span><span>+' + DATA.WEEKLY_STIPEND + ' SP</span>' +
      '</div>' +
      '<div class="overlay-buttons"><button type="button" class="primary" data-act="continue">Continue to ' +
      nextLabel + '</button></div>');
  }

  function showEnd() {
    const r = game.result;
    const built = game.towers.length;
    if (game.phase === 'won') {
      const g = r.grade;
      showOverlay('end',
        '<h2>Semester complete</h2>' +
        '<div class="grade-big grade-' + g.code + '">' + g.code + '</div>' +
        '<p><b>' + g.name + '</b>: "' + g.title + '"</p>' +
        (r.perfect ? '<span class="badge">Perfect Semester</span>' : '') +
        '<div class="stat-grid">' +
        '<span>Final WAM</span><span>' + r.wam + '</span>' +
        '<span>Towers standing</span><span>' + built + '</span>' +
        '</div>' +
        '<div class="overlay-buttons"><button type="button" class="primary" data-act="again">Play again</button></div>');
      $('overlay').classList.add('celebrate'); // lighter backdrop so the confetti shows through
    } else {
      showOverlay('end',
        '<h2>Withdrawn from unit</h2>' +
        '<div class="grade-big grade-N">0</div>' +
        '<p>Your WAM hit 0 in ' + (game.week === DATA.EXAM_WEEK ? 'exam week' : 'Week ' + game.week) + '. Better luck next semester.</p>' +
        '<div class="overlay-buttons"><button type="button" class="primary" data-act="again">Try again</button></div>');
    }
  }

  function startRun(demo) {
    app.demo = demo;
    app.started = true;
    app.paused = false;
    app.speed = 1;
    app.autoStart = false;
    app.autoTimer = 0;
    app.placing = null;
    app.selected = null;
    game.reset();
    if (demo) {
      app.demoPanel.show();
    } else {
      game.godMode = false;
      app.demoPanel.hide();
    }
    hideOverlay();
    syncAfterChange();
  }

  $('overlay-card').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'play') startRun(false);
    else if (act === 'demo') startRun(true);
    else if (act === 'again') startRun(app.demo);
    else if (act === 'continue') {
      hideOverlay();
      game.nextWeek();
      syncAfterChange();
    }
  });

  // ---------------------------------------------------------- tower buttons

  function buildTowerButtons() {
    const wrap = $('tower-buttons');
    wrap.innerHTML = TOWER_KINDS.map((k) => {
      const d = DATA.towers[k];
      return '<button type="button" class="tower-btn" data-kind="' + k + '">' +
        '<span class="t-top">' + d.emoji + ' ' + d.name + '</span>' +
        '<span class="t-cost">' + d.cost + ' SP <span class="t-key">[' + d.key + ']</span></span></button>';
    }).join('');
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('.tower-btn');
      if (b) togglePlacing(b.dataset.kind);
    });
    wrap.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.tower-btn');
      app.hoverBuild = b ? b.dataset.kind : null;
    });
    wrap.addEventListener('mouseleave', () => { app.hoverBuild = null; });
  }

  function togglePlacing(kind) {
    if (!app.started || app.overlay || game.isOver) return;
    app.placing = app.placing === kind ? null : kind;
    app.selected = null;
  }

  function refreshTowerButtons() {
    for (const b of $('tower-buttons').children) {
      const d = DATA.towers[b.dataset.kind];
      b.classList.toggle('selected', app.placing === b.dataset.kind);
      b.classList.toggle('unaffordable', game.sp < d.cost);
    }
  }

  // -------------------------------------------------------------------- HUD

  function buildWeekTrack() {
    let html = '';
    for (let w = 1; w <= DATA.TEACHING_WEEKS; w++) html += '<div class="wk" data-w="' + w + '">' + w + '</div>';
    html += '<div class="wk exam" data-w="' + DATA.EXAM_WEEK + '">Exam</div>';
    $('week-track').innerHTML = html;
  }

  const hudCache = {};
  /** Updates text only when it changes. Returns true if it changed. */
  function setText(id, text) {
    if (hudCache[id] === text) return false;
    const first = hudCache[id] === undefined;
    hudCache[id] = text;
    $(id).textContent = text;
    return !first;
  }

  /** Updates a number and gives it a quick pop (green for up, red for down). */
  function setNumber(id, value) {
    const prev = hudCache[id] === undefined ? value : Number(hudCache[id]);
    if (setText(id, String(value))) {
      animateEl($(id), [{ transform: 'scale(1.4)', color: value > prev ? '#a5f3a5' : '#ff8a80' }], 350);
    }
  }

  function refreshHud() {
    setNumber('wam-val', game.wam);
    setNumber('sp-val', game.sp);
    const fill = $('wam-fill');
    fill.style.width = game.wam + '%';
    fill.style.background = game.wam > 50 ? 'var(--good)' : game.wam > 25 ? 'var(--warn)' : 'var(--bad)';
    fill.parentElement.setAttribute('aria-valuenow', String(game.wam));
    const exam = game.week === DATA.EXAM_WEEK;
    const phaseNames = { prep: 'Prep', wave: 'Wave', results: 'Results', won: 'Finished', lost: 'Withdrawn' };
    if (setText('phase-label', phaseNames[game.phase])) {
      animateEl($('phase-label'), [{ transform: 'scale(1.3)', background: 'rgba(255,255,255,0.45)' }], 400);
    }
    if (setText('week-label', exam ? 'Exam week' : 'Week ' + game.week + ' of ' + DATA.TEACHING_WEEKS)) {
      animateEl($('week-label'), [{ transform: 'translateY(-6px)', opacity: 0 }], 350);
    }
    for (const el of $('week-track').children) {
      const w = Number(el.dataset.w);
      el.classList.toggle('now', w === game.week);
      el.classList.toggle('done', w < game.week);
    }
    setText('btn-speed', 'Speed ' + app.speed + 'x');
    setText('btn-pause', app.paused ? 'Resume' : 'Pause');
    $('pause-badge').classList.toggle('hidden', !(app.paused && app.started));
  }

  // -------------------------------------------------------------- side panel

  function row(label, value) {
    return '<div class="info-row"><span class="muted">' + label + '</span><span>' + value + '</span></div>';
  }

  function chip(family) {
    const f = DATA.familyStyle[family];
    return '<span class="shape-chip shape-' + f.shape + '" style="background:' + f.color + '"></span>';
  }

  function towerRows(kind, level, tower) {
    const s = DATA.towers[kind].levels[level];
    const rows = [];
    if (kind === 'lecturer') {
      rows.push(row('Damage', s.damage), row('Range', s.range + ' tiles'), row('Fire rate', '1 / sec'), row('Targets', s.targets));
    } else if (kind === 'extension') {
      rows.push(row('Slow', Math.round(s.slow * 100) + '%'), row('Range', s.range + ' tiles'));
    } else if (kind === 'ai') {
      const chance = tower ? game.hallucChance(tower) : Math.min(0.9, s.halluc + 0.05 * game.countOf('ai'));
      rows.push(row('Damage', s.damage + ' (ignores armour)'), row('Range', s.range + ' tiles'),
        row('Fire rate', '1 / 2 sec'), row('Hallucination', Math.round(chance * 100) + '%'));
    } else if (kind === 'holiday') {
      rows.push(row('Pause', s.pause + ' sec'), row('Every', s.interval + ' sec'), row('Range', s.range + ' tiles'));
    }
    return rows.join('');
  }

  function infoModel() {
    if (app.hoverEnemy && app.hoverEnemy.alive) {
      const e = app.hoverEnemy;
      return { key: 'enemy:' + e.id + ':' + Math.ceil(e.hp), html: enemyInfo(e) };
    }
    const buildKind = app.hoverBuild || app.placing;
    if (buildKind) {
      const d = DATA.towers[buildKind];
      return {
        key: 'build:' + buildKind + ':' + game.countOf('ai'),
        html: '<div class="info-title">' + d.emoji + ' ' + d.name + '</div>' +
          '<div class="info-sub">Costs ' + d.cost + ' SP. Click a green tile to build.</div>' +
          towerRows(buildKind, 0, null) +
          '<div class="info-note">' + d.desc + '</div>' +
          '<div class="info-note muted">Upgrade: ' + d.levels[1].name + ' for ' + d.levels[1].cost + ' SP.</div>',
      };
    }
    if (app.selected) {
      const t = app.selected;
      const d = DATA.towers[t.kind];
      const cost = game.upgradeCost(t);
      const key = ['tower', t.id, t.level, cost !== null && game.sp >= cost, game.countOf('ai'), t.slowed].join(':');
      let html = '<div class="info-title">' + d.emoji + ' ' + d.name + '</div>' +
        '<div class="info-sub">' + d.levels[t.level].name + ' (level ' + (t.level + 1) + ' of ' + d.levels.length + ')</div>' +
        towerRows(t.kind, t.level, t);
      if (t.slowed) html += '<div class="info-note">💤 Slowed by a nearby Free-rider.</div>';
      if (cost !== null) {
        html += '<div class="info-note muted">Next: ' + d.levels[t.level + 1].name + '</div>';
      }
      html += '<div class="info-actions">' +
        (cost !== null
          ? '<button type="button" data-act="upgrade"' + (game.sp < cost ? ' disabled' : '') + '>Upgrade (' + cost + ' SP) [U]</button>'
          : '<button type="button" disabled>Max level</button>') +
        '<button type="button" data-act="sell">Sell +' + game.sellValue(t) + ' [S]</button></div>';
      return { key, html };
    }
    return {
      key: 'hint:' + game.phase,
      html: '<div class="info-note">Choose a tower above, then click a green tile.</div>' +
        '<div class="info-note muted">Hover an enemy to see what it does. Click a tower to upgrade or sell it.</div>' +
        '<div class="info-note muted">Shapes show the family: square = assignment, circle = bad teammate, triangle = sickness.</div>',
    };
  }

  function enemyInfo(e) {
    const d = DATA.enemies[e.type];
    const f = DATA.familyStyle[d.family];
    return '<div class="info-title">' + d.emoji + ' ' + d.name + '</div>' +
      '<div class="info-sub">' + chip(d.family) + ' ' + f.label + '</div>' +
      row('Health', Math.ceil(e.hp) + ' / ' + e.maxHp) +
      row('Speed', d.speed === 'veryslow' ? 'very slow' : d.speed) +
      row('WAM damage', d.dmg) +
      row('SP reward', d.reward) +
      '<div class="info-note">' + d.note + '</div>';
  }

  let lastInfoKey = '';
  let lastInfoGroup = '';
  function refreshInfo() {
    const m = infoModel();
    if (m.key !== lastInfoKey) {
      lastInfoKey = m.key;
      $('info-body').innerHTML = m.html;
      // Fade the panel in only when it switches to a different subject, not on every health tick.
      const group = m.key.split(':').slice(0, 2).join(':');
      if (group !== lastInfoGroup) {
        lastInfoGroup = group;
        animateEl($('info-body'), [{ opacity: 0, transform: 'translateY(5px)' }], 180);
      }
    }
  }

  $('info-body').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    if (btn.dataset.act === 'upgrade') upgradeSelected();
    if (btn.dataset.act === 'sell') sellSelected();
  });

  function upgradeSelected() {
    if (!app.selected) return;
    const res = game.upgradeTower(app.selected);
    if (!res.ok) showToast(res.reason);
    lastInfoKey = '';
  }

  function sellSelected() {
    if (!app.selected) return;
    game.sellTower(app.selected);
    app.selected = null;
    lastInfoKey = '';
  }

  let lastWaveKey = '';
  function refreshWave() {
    const exam = game.week === DATA.EXAM_WEEK;
    const w = DATA.weeks[game.week - 1];
    const waveLeft = game.enemies.filter((e) => e.alive).length + game.spawnQueue.length;
    const key = [game.week, game.phase, game.phase === 'wave' ? waveLeft : '', game.week].join(':');
    const btn = $('btn-start');
    if (key !== lastWaveKey) {
      lastWaveKey = key;
      $('wave-title').textContent = (exam ? 'Exam week' : 'Week ' + game.week) + ': ' + w.theme;
      let html = '';
      if (game.phase === 'wave') {
        html = '<div class="muted">Enemies left: <b>' + waveLeft + '</b></div>';
      } else if (game.phase === 'prep') {
        const fresh = DATA.newThreats[game.week] || [];
        html = '<div class="muted">Incoming threats:</div><ul>' +
          game.previewWave(game.week).map((g) => {
            const d = DATA.enemies[g.type];
            return '<li><span class="count">' + g.count + '×</span>' + chip(d.family) + ' ' + d.emoji + ' ' + d.name +
              (fresh.includes(g.type) ? ' <span class="new-tag">NEW</span>' : '') + '</li>';
          }).join('') + '</ul>';
      } else if (game.phase === 'results') {
        html = '<div class="muted">Week complete.</div>';
      }
      $('wave-body').innerHTML = html;
    }
    const canStart = game.phase === 'prep' && app.started && !app.overlay;
    btn.disabled = !canStart;
    btn.textContent = game.phase === 'wave' ? 'Week in progress...' :
      exam ? 'Start the Final Exam' : 'Start Week ' + game.week + ' [Space]';
  }

  $('btn-start').addEventListener('click', startWeek);

  function startWeek() {
    if (!app.started || app.overlay) return;
    if (game.phase === 'prep') {
      game.startWave();
      app.selected = null;
      syncAfterChange();
    }
  }

  function syncAfterChange() {
    lastInfoKey = '';
    lastWaveKey = '';
    if (app.selected && !game.towers.includes(app.selected)) app.selected = null;
  }

  // ------------------------------------------------------------------ input

  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * renderer.W) / rect.width;
    const y = ((e.clientY - rect.top) * renderer.H) / rect.height;
    return { x, y, c: Math.floor(x / T), r: Math.floor(y / T) };
  }

  canvas.addEventListener('mousemove', (e) => {
    const p = canvasPos(e);
    app.hoverTile = p.c >= 0 && p.r >= 0 && p.c < DATA.COLS && p.r < DATA.ROWS ? { c: p.c, r: p.r } : null;
    const tx = p.x / T;
    const ty = p.y / T;
    let best = null;
    for (const en of game.enemies) {
      if (!en.alive || en.invisible) continue;
      const d = Math.hypot(en.x - tx, en.y - ty);
      if (d <= DATA.enemies[en.type].size + 0.15 && (!best || DATA.enemies[en.type].size < DATA.enemies[best.type].size)) best = en;
    }
    app.hoverEnemy = best;
  });
  canvas.addEventListener('mouseleave', () => { app.hoverTile = null; app.hoverEnemy = null; });

  canvas.addEventListener('click', (e) => {
    if (!app.started || app.overlay) return;
    const p = canvasPos(e);
    if (app.placing) {
      const res = game.placeTower(app.placing, p.c, p.r);
      if (!res.ok) {
        showToast(res.reason);
      } else {
        app.selected = e.shiftKey ? null : res.tower;
        if (!e.shiftKey) app.placing = null;
        lastInfoKey = '';
      }
    } else {
      app.selected = game.towerAt(p.c, p.r);
      lastInfoKey = '';
    }
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancel();
  });

  function cancel() {
    app.placing = null;
    app.selected = null;
    lastInfoKey = '';
  }

  function cycleSpeed() {
    const speeds = app.demo ? [1, 2, 4] : [1, 2];
    app.speed = speeds[(speeds.indexOf(app.speed) + 1) % speeds.length];
  }

  function togglePause() {
    if (!app.started || app.overlay) return;
    app.paused = !app.paused;
  }

  $('btn-pause').addEventListener('click', togglePause);
  $('btn-speed').addEventListener('click', cycleSpeed);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const inControl = e.target.closest && e.target.closest('button, select, input');

    if (app.overlay) {
      if (key === 'escape' && app.overlay === 'help') hideOverlay();
      return;
    }
    if (!app.started) return;

    if (key === ' ' || key === 'spacebar') {
      if (inControl) return;
      e.preventDefault();
      startWeek();
      return;
    }
    const tIndex = TOWER_KINDS.findIndex((k) => DATA.towers[k].key === key);
    if (tIndex >= 0) togglePlacing(TOWER_KINDS[tIndex]);
    else if (key === 'p') togglePause();
    else if (key === 'f') cycleSpeed();
    else if (key === 'escape') cancel();
    else if (key === 'u') upgradeSelected();
    else if (key === 's') sellSelected();
    else if (app.demo) app.demoPanel.handleKey(key);
  });

  // ------------------------------------------------------------------- loop

  game.onEvent = (name, data) => {
    renderer.handle(name, data);
    if (name === 'waveEnd') {
      if (!app.autoStart) showResults();
      else app.autoTimer = 1.5;
    } else if (name === 'win' || name === 'lose') {
      showEnd();
    } else if (name === 'leak') {
      animateEl($('hud-wam'), [{ transform: 'scale(1.15)', color: '#ff8a80' }, { transform: 'scale(1)' }], 300);
    }
  };

  function runAutoStart(realDt) {
    if (!app.autoStart || game.isOver) return;
    if (game.phase !== 'prep' && game.phase !== 'results') return;
    app.autoTimer -= realDt;
    if (app.autoTimer > 0) return;
    app.autoTimer = 1.5;
    if (game.phase === 'results') game.nextWeek();
    else game.startWave();
    syncAfterChange();
  }

  let last = performance.now();
  function frame(now) {
    const realDt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const running = app.started && !app.paused && !app.overlay;
    // Visual effects keep moving behind overlays (title, results, confetti) but freeze when paused.
    if (!app.paused) renderer.update(realDt * (running ? app.speed : 1));

    if (running) {
      runAutoStart(realDt);
      const total = realDt * app.speed;
      const steps = Math.max(1, Math.ceil(total / (1 / 30)));
      const dt = total / steps;
      for (let i = 0; i < steps && !game.isOver; i++) game.update(dt);
    }

    if (app.selected && !game.towers.includes(app.selected)) app.selected = null;
    renderer.draw({ hoverTile: app.hoverTile, placing: app.placing, selected: app.selected });
    refreshHud();
    refreshTowerButtons();
    refreshInfo();
    refreshWave();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------- init

  buildTowerButtons();
  buildWeekTrack();
  app.demoPanel = new DemoPanel(app, $('demo-panel'));
  showTitle();
  requestAnimationFrame(frame);
})();
