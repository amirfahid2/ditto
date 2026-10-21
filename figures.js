/* Ditto stick figures — a decorative layer that never gets in the way.
 *
 * Tiny walkers live in the gaps, margins and background, stand only on the outer
 * top edges of boxes, climb side ladders and leave through glowing exits. The
 * canvas has pointer-events: none; clicks are read with a passive document
 * listener that never calls preventDefault.
 *
 * <script src="figures.js" defer data-boxes=".sq, .store"></script>
 *   data-boxes   CSS selector for the boxes figures must never enter (their tops are platforms)
 *   data-ignore  extra selector whose clicks the figures ignore (e.g. ".scrim, .sheet")
 *   data-cap     population cap (default 30; 5 on small screens)
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var ds = (script && script.dataset) || {};
  var BOX_SELECTOR = ds.boxes || ".sq";
  var IGNORE = "a, button, input, select, textarea, label, summary, [role=button], [contenteditable], .sf-ui" +
    (ds.ignore ? ", " + ds.ignore : "");
  var STORE_KEY = "ditto.figures";

  var H = 14.6;              // feet to top of head, px
  var HALF_W = 3;            // half the body width, used for every overlap test
  var GRAVITY = 700, CLIMB = 26, WALK_MIN = 15, WALK_MAX = 24;
  var START = 2, COOLDOWN = 2000, EXIT_CHANCE = 0.3, RESPAWN_MS = 4000;
  var SMALL = Math.min(window.innerWidth, screen.width || 9999) < 520;
  var CAP = SMALL ? 5 : (parseInt(ds.cap, 10) || 30);

  var W = { width: 0, height: 0, ground: 0, boxes: [], ladders: [], ramps: [] };
  var figs = [], effects = [];
  var enabled = false, dirty = true, raf = 0, last = 0, nextId = 1, emptySince = 0, fadeOut = 0;
  var colors = { ink: "#16262E", muted: "#64808B", accent: "#0E7C86" };
  var canvas, ctx, ui, toggle, counter, dpr = 1, shownCount = null, timeScale = 1;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------------- terrain ---------------- */

  function computeWorld() {
    var sx = window.scrollX, sy = window.scrollY, de = document.documentElement;
    W.width = de.clientWidth;
    W.height = Math.max(de.scrollHeight, window.innerHeight);
    W.ground = W.height - 20;
    W.boxes = [];
    var els = document.querySelectorAll(BOX_SELECTOR);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (ui && ui.contains(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      var cs = getComputedStyle(el);
      if (cs.position === "fixed") continue;
      if ((cs.animationName && cs.animationName !== "none") || cs.transform !== "none") {
        // wiggling or scaled (Arrange mode, a pressed square): use the untransformed box plus a margin
        var x = 0, y = 0, n = el, pad = 2;
        while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        W.boxes.push({ l: x - pad, t: y - pad, r: x + el.offsetWidth + pad, b: y + el.offsetHeight + pad });
      } else {
        W.boxes.push({ l: r.left + sx, t: r.top + sy, r: r.right + sx, b: r.bottom + sy });
      }
    }
    buildRamps();
    buildLadders();
    // ladders are rebuilt on every layout change: keep climbers on the one at the same spot
    figs.forEach(function (f) {
      if (f.ladder) f.ladder = sameLadder(f.ladder) || null;
      if (f.goal && f.goal.ladder) f.goal = sameLadder(f.goal.ladder) ? { ladder: sameLadder(f.goal.ladder) } : null;
    });

    readColors();
    placeUi();
    dirty = false;
  }

  // Does a figure with its feet at (x, y) overlap the inside of any box?
  // Standing exactly on a top edge is fine; a box directly above (no headroom) is not.
  function hitsBox(x, y) {
    for (var i = 0; i < W.boxes.length; i++) {
      var b = W.boxes[i];
      if (x + HALF_W > b.l && x - HALF_W < b.r && y > b.t + 0.5 && y - H < b.b) return b;
    }
    return null;
  }

  function platformUnder(x, y) {
    for (var i = 0; i < W.boxes.length; i++) {
      var b = W.boxes[i];
      if (Math.abs(b.t - y) < 0.75 && x >= b.l && x <= b.r) return b;
    }
    return null;
  }

  function regionClear(l, t, r, b) {
    for (var i = 0; i < W.boxes.length; i++) {
      var q = W.boxes[i];
      if (r > q.l && l < q.r && b > q.t && t < q.b) return false;
    }
    return true;
  }

  // Ramps at the far left and right: the ground slopes down to a glowing exit door.
  function buildRamps() {
    W.ramps = [];
    var y2 = W.height - 3;
    [-1, 1].forEach(function (side) {
      var x1 = side < 0 ? 48 : W.width - 48;
      var x2 = side < 0 ? 18 : W.width - 18;
      var doorX = side < 0 ? 10 : W.width - 10;
      var l = Math.min(x1, doorX) - 6, r = Math.max(x1, doorX) + 6;
      if (W.width < 200 || !regionClear(l, W.ground - H - 8, r, W.height)) return;
      W.ramps.push({ side: side, x1: x1, x2: x2, y1: W.ground, y2: y2, door: { x: doorX, y: y2 } });
    });
  }

  function sameLadder(old) {
    for (var i = 0; i < W.ladders.length; i++) {
      var L = W.ladders[i];
      if (Math.abs(L.x - old.x) < 3 && Math.abs(L.top - old.top) < 6) return L;
    }
    return null;
  }

  function rampFor(side) {
    for (var i = 0; i < W.ramps.length; i++) if (W.ramps[i].side === side) return W.ramps[i];
    return null;
  }

  // Ground height at x: flat, then sloping down along a ramp toward its door.
  function groundY(x) {
    for (var i = 0; i < W.ramps.length; i++) {
      var R = W.ramps[i];
      var beyond = R.side < 0 ? x < R.x1 : x > R.x1;
      if (!beyond) continue;
      var k = clamp((x - R.x1) / (R.x2 - R.x1), 0, 1);
      return R.y1 + (R.y2 - R.y1) * k;
    }
    return W.ground;
  }

  // Ladders: in vertical gaps of 20 px or more, plus one on each outer side of the board.
  function buildLadders() {
    W.ladders = [];
    if (!W.boxes.length) return;
    var leftRamp = rampFor(-1), rightRamp = rampFor(1);
    function addLadder(x, top, exitX, exitDir) {
      if (leftRamp && x - 5 < leftRamp.x1 + 4) return;
      if (rightRamp && x + 5 > rightRamp.x1 - 4) return;
      if (x < 6 || x > W.width - 6 || top >= W.ground - H) return;
      if (!regionClear(x - 5, top - H, x + 5, W.ground)) return;
      W.ladders.push({ x: x, top: top, bottom: W.ground, exitX: exitX, exitDir: exitDir });
    }
    // gaps between neighbours in a row, when the channel runs clear down to the ground
    W.boxes.forEach(function (a) {
      var right = null;
      W.boxes.forEach(function (b) {
        if (b === a || Math.abs(b.t - a.t) > 3 || b.l < a.r) return;
        if (!right || b.l < right.l) right = b;
      });
      if (!right || right.l - a.r < 20) return;
      var x = (a.r + right.l) / 2, top = Math.min(a.t, right.t);
      addLadder(x, top, right.l + 5, 1);
    });
    // outer sides: reach the top row of the board
    var minL = Infinity, maxR = -Infinity;
    W.boxes.forEach(function (b) { minL = Math.min(minL, b.l); maxR = Math.max(maxR, b.r); });
    var leftTop = null, rightTop = null;
    W.boxes.forEach(function (b) {
      if (b.l < minL + 30 && !hitsBox(b.l + 5, b.t) && (!leftTop || b.t < leftTop.t)) leftTop = b;
      if (b.r > maxR - 30 && !hitsBox(b.r - 5, b.t) && (!rightTop || b.t < rightTop.t)) rightTop = b;
    });
    if (leftTop) addLadder(minL - 12, leftTop.t, leftTop.l + 5, 1);
    if (rightTop) addLadder(maxR + 12, rightTop.t, rightTop.r - 5, -1);
  }

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    colors.ink = (cs.getPropertyValue("--ink") || "").trim() || colors.ink;
    colors.muted = (cs.getPropertyValue("--muted") || "").trim() || colors.muted;
    colors.accent = (cs.getPropertyValue("--accent") || "").trim() || colors.accent;
  }

  /* ---------------- figures ---------------- */

  function makeFig(x, y, dir) {
    var f = {
      id: nextId++, x: x, y: y, dir: dir || (Math.random() < 0.5 ? -1 : 1), speed: rand(WALK_MIN, WALK_MAX),
      state: "walk", vx: 0, vy: 0, phase: rand(0, 6), born: performance.now(), lastHit: -1e9,
      wave: 0, bounce: 0, goal: null, dismount: null, ladder: null, alpha: 1, scale: 1, dead: false
    };
    figs.push(f);
    return f;
  }

  // A random legal spot, preferring what's on screen.
  function spawnSpot() {
    var top = window.scrollY, bottom = top + window.innerHeight, spots = [];
    W.boxes.forEach(function (b) {
      if (b.r - b.l < 2 * HALF_W + 2) return;
      var x = rand(b.l + HALF_W, b.r - HALF_W);
      if (!hitsBox(x, b.t) && b.t > top + H && b.t < bottom) spots.push({ x: x, y: b.t });
    });
    if (spots.length) return spots[Math.floor(Math.random() * spots.length)];
    for (var i = 0; i < 20; i++) {
      var gx = rand(60, Math.max(61, W.width - 60)), gy = groundY(gx);
      if (!hitsBox(gx, gy)) return { x: gx, y: gy };
    }
    return null;
  }

  function spawn(n) {
    for (var i = 0; i < n && figs.length < CAP; i++) {
      var s = spawnSpot();
      if (s) makeFig(s.x, s.y);
    }
  }

  function onGround(f) { return Math.abs(f.y - groundY(f.x)) < 0.75; }

  function chooseGoal(f) {
    var ladders = W.ladders;
    if (W.ramps.length && (Math.random() < EXIT_CHANCE || !ladders.length)) {
      return { side: rampFor(f.dir) ? f.dir : (rampFor(-f.dir) ? -f.dir : 0) };
    }
    if (!ladders.length) return { side: 0 };
    var best = ladders[0];
    ladders.forEach(function (L) { if (Math.abs(L.x - f.x) < Math.abs(best.x - f.x)) best = L; });
    return { ladder: best };
  }

  function touchDown(f) {
    f.state = "walk"; f.vx = 0; f.vy = 0; f.goal = null;
  }

  // Where would a figure dropping at x from y land? null if it would hit a box with no headroom.
  function dropTarget(x, y) {
    var land = null;
    W.boxes.forEach(function (b) {
      if (x + HALF_W > b.l && x - HALF_W < b.r && b.t >= y && (!land || b.t < land.t)) land = b;
    });
    var gy = groundY(x);
    if (!land || land.t > gy) return hitsBox(x, gy) ? null : gy;
    return hitsBox(clamp(x, land.l + 0.5, land.r - 0.5), land.t) ? null : land.t;
  }

  function stepOffEdge(f, p) {
    var edge = f.dir > 0 ? p.r : p.l;
    var neighbour = null, gap = 0;
    W.boxes.forEach(function (b) {
      if (b === p || Math.abs(b.t - p.t) > 2) return;
      var g = f.dir > 0 ? b.l - p.r : p.l - b.r;
      if (g >= 0 && g <= 18 && (!neighbour || g < gap)) { neighbour = b; gap = g; }
    });
    var dropX = edge + f.dir * (HALF_W + 1);
    var canDrop = !hitsBox(dropX, f.y) && dropTarget(dropX, f.y) !== null;
    if (neighbour && !hitsBox(f.dir > 0 ? neighbour.l + 5 : neighbour.r - 5, neighbour.t) &&
        (!canDrop || Math.random() < 0.5)) {
      // hop across a narrow gap to the next box's top edge
      f.x = edge;
      f.state = "fall"; f.vy = -95; f.vx = f.dir * (gap + 7) / (2 * 95 / GRAVITY);
      return;
    }
    if (canDrop) { f.x = dropX; f.state = "fall"; f.vy = 0; f.vx = 0; return; }
    f.dir = -f.dir;
  }

  function walk(f, dt) {
    if (f.wave > 0) return;
    var step = f.speed * dt;
    if (f.dismount !== null) {
      var d = f.dismount - f.x, s = Math.sign(d) * Math.min(Math.abs(d), step);
      if (hitsBox(f.x + s, f.y)) { f.dismount = null; return; }
      f.x += s; f.dir = Math.sign(d) || f.dir;
      if (Math.abs(f.dismount - f.x) < 0.5) f.dismount = null;
      return;
    }
    if (onGround(f)) {
      if (f.bounce <= 0) {
        if (!f.goal || (f.goal.ladder && W.ladders.indexOf(f.goal.ladder) < 0)) f.goal = chooseGoal(f);
        if (f.goal.ladder) {
          var L = f.goal.ladder, dx = L.x - f.x;
          if (Math.abs(dx) < 0.8) { f.x = L.x; f.state = "climb"; f.ladder = L; f.goal = null; return; }
          f.dir = dx > 0 ? 1 : -1;
          step = Math.min(step, Math.abs(dx));
        } else if (f.goal.side) {
          f.dir = f.goal.side;
        }
      }
      var nx = f.x + f.dir * step;
      var R = rampFor(f.dir);
      if (R && (f.dir < 0 ? nx <= R.x2 : nx >= R.x2)) { f.state = "exit"; f.exitT = 0; f.door = R.door; return; }
      if (nx < 4 || nx > W.width - 4) { f.dir = -f.dir; f.goal = null; return; }
      var ny = groundY(nx);
      if (hitsBox(nx, ny)) { f.dir = -f.dir; f.goal = { side: 0 }; f.bounce = 1; return; }
      f.x = nx; f.y = ny;
      return;
    }
    var p = platformUnder(f.x, f.y);
    if (!p) { f.state = "fall"; f.vy = 0; f.vx = 0; return; }
    var px = f.x + f.dir * step;
    if (px >= p.l && px <= p.r) {
      if (hitsBox(px, f.y)) { f.dir = -f.dir; return; }    // something hangs low over this edge
      f.x = px;
      return;
    }
    stepOffEdge(f, p);
  }

  function fall(f, dt) {
    f.vy = Math.min(f.vy + GRAVITY * dt, 420);
    var nx = f.x + f.vx * dt;
    if (f.vx && (nx < 4 || nx > W.width - 4 || hitsBox(nx, f.y))) { f.vx = 0; nx = f.x; }
    var ny = f.y + f.vy * dt;
    if (f.vy < 0) {
      if (hitsBox(nx, ny)) { f.vy = 0; ny = f.y; }       // bonk: never rise into a box
      f.x = nx; f.y = ny;
      return;
    }
    var land = null;
    W.boxes.forEach(function (b) {
      if (nx + HALF_W > b.l && nx - HALF_W < b.r && b.t >= f.y - 0.01 && b.t <= ny && (!land || b.t < land.t)) land = b;
    });
    var gy = groundY(nx);
    if (land && land.t <= gy) {
      var lx = clamp(nx, land.l + 0.5, land.r - 0.5);
      if (!hitsBox(lx, land.t)) { f.x = lx; f.y = land.t; touchDown(f); return; }
      // no headroom on that box: slip past its side and keep dropping through the gap
      var sideX = nx < (land.l + land.r) / 2 ? land.l - HALF_W - 1 : land.r + HALF_W + 1;
      if (!hitsBox(sideX, f.y)) { f.x = sideX; f.vx = 0; f.y = Math.min(ny, land.t - 0.1); return; }
      settle(f, true);
      return;
    }
    if (ny >= gy) { f.x = nx; f.y = gy; touchDown(f); return; }
    f.x = nx; f.y = ny;
  }

  function climb(f, dt) {
    var L = f.ladder;
    if (!L || W.ladders.indexOf(L) < 0) { f.state = "fall"; f.vy = 0; f.vx = 0; f.ladder = null; return; }
    f.x = L.x;
    f.y -= CLIMB * dt;
    if (f.y <= L.top) {
      f.y = L.top; f.state = "walk"; f.dismount = L.exitX; f.dir = L.exitDir; f.ladder = null;
    }
  }

  function exitStep(f, dt) {
    f.exitT += dt;
    var k = Math.min(1, f.exitT / 0.8);
    f.x += (f.door.x - f.x) * Math.min(1, dt * 5);
    f.y = f.door.y;
    f.scale = 1 - 0.85 * k;
    f.alpha = 1 - k;
    if (k >= 1) f.dead = true;
  }

  // Strict rule: never inside a box. Anything that ends up there (layout change, resize)
  // moves to the nearest legal top edge or the ground.
  function settle(f, force) {
    if (f.dead || f.state === "exit") return;
    if (f.state === "climb") {
      if (f.ladder && W.ladders.indexOf(f.ladder) >= 0) return;
      f.state = "fall"; f.vy = 0; f.vx = 0; f.ladder = null;
    }
    if (!force && !hitsBox(f.x, f.y)) return;
    var best = null, bd = Infinity;
    W.boxes.forEach(function (b) {
      if (b.r - b.l < 2 * HALF_W) return;
      var x = clamp(f.x, b.l + HALF_W, b.r - HALF_W);
      if (hitsBox(x, b.t)) return;
      var d = Math.abs(x - f.x) + Math.abs(b.t - f.y);
      if (d < bd) { bd = d; best = { x: x, y: b.t }; }
    });
    var gx = clamp(f.x, 6, W.width - 6), gy = groundY(gx);
    if (!hitsBox(gx, gy) && Math.abs(gx - f.x) + Math.abs(gy - f.y) < bd) best = { x: gx, y: gy };
    if (!best) { f.dead = true; return; }
    f.x = best.x; f.y = best.y; f.state = "walk"; f.vx = 0; f.vy = 0; f.dismount = null; f.goal = null;
  }

  function collide(now) {
    for (var i = 0; i < figs.length; i++) {
      var a = figs[i];
      if (a.state !== "walk" || a.dismount !== null || a.wave > 0 || a.dead) continue;
      for (var j = i + 1; j < figs.length; j++) {
        var b = figs[j];
        if (b.state !== "walk" || b.dismount !== null || b.wave > 0 || b.dead) continue;
        if (Math.abs(a.y - b.y) > 2 || Math.abs(a.x - b.x) > 5) continue;
        // bounce apart
        var left = a.x <= b.x ? a : b, right = left === a ? b : a;
        left.dir = -1; right.dir = 1; left.bounce = right.bounce = 0.7;
        left.goal = right.goal = null;
        if (now - a.lastHit > COOLDOWN && now - b.lastHit > COOLDOWN) {
          a.lastHit = b.lastHit = now;
          replicate((a.x + b.x) / 2, Math.min(a.y, b.y), now);
        }
      }
    }
  }

  function replicate(x, y, now) {
    var alive = figs.filter(function (f) { return !f.dead; });
    if (alive.length >= CAP) {
      var oldest = alive.reduce(function (o, f) { return f.born < o.born ? f : o; });
      poof(oldest);
    }
    var n = makeFig(x, y);
    n.lastHit = now;
    n.state = "fall"; n.vy = -110; n.vx = n.dir * 35;
  }

  function poof(f) {
    f.dead = true;
    effects.push({ x: f.x, y: f.y - H / 2, t: 0 });
  }

  /* ---------------- drawing ---------------- */

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }

  function limb(x, y, angle, len) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.sin(angle) * len, y + Math.cos(angle) * len);
  }

  function drawFigure(f, t) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale((f.state === "climb" ? 1 : f.dir) * f.scale, f.scale);
    ctx.globalAlpha *= f.alpha;
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1.25;
    ctx.lineCap = "round";
    var s = Math.sin(f.phase), legA, legB, armA, armB;
    if (f.state === "climb") {
      legA = 0.35 * s; legB = -0.35 * s; armA = 2.7 + 0.35 * s; armB = -2.7 + 0.35 * s;
    } else if (f.state === "fall") {
      legA = 0.35; legB = -0.25; armA = 2.4; armB = -2.4;
    } else if (f.wave > 0) {
      legA = 0.12; legB = -0.12; armA = -0.25; armB = -(2.5 + 0.5 * Math.sin(t / 70));
    } else {
      legA = 0.14 + 0.5 * s; legB = -0.14 - 0.5 * s; armA = 0.22 - 0.55 * s; armB = -0.22 + 0.55 * s;
    }
    ctx.beginPath();
    limb(0, -6.6, legA, 6.6);
    limb(0, -6.6, legB, 6.6);
    ctx.moveTo(0, -6.6); ctx.lineTo(0, -11);
    limb(0, -10.4, armA, 4.6);
    limb(0, -10.4, armB, 4.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -12.7, 1.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawLadders() {
    ctx.strokeStyle = colors.muted;
    ctx.globalAlpha *= 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    W.ladders.forEach(function (L) {
      ctx.moveTo(L.x - 3.5, L.top - 4); ctx.lineTo(L.x - 3.5, L.bottom);
      ctx.moveTo(L.x + 3.5, L.top - 4); ctx.lineTo(L.x + 3.5, L.bottom);
      for (var y = L.bottom - 2; y > L.top - 3; y -= 4.5) { ctx.moveTo(L.x - 3.5, y); ctx.lineTo(L.x + 3.5, y); }
    });
    ctx.stroke();
    ctx.globalAlpha /= 0.55;
  }

  function drawRamps(t) {
    W.ramps.forEach(function (R) {
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(R.x1 - R.side * 8, R.y1); ctx.lineTo(R.x1, R.y1); ctx.lineTo(R.x2, R.y2); ctx.lineTo(R.door.x, R.y2);
      ctx.stroke();
      // the exit: a glowing doorway with a flickering sign
      var dx = R.door.x, dy = R.door.y, w = 9, h = 14;
      var pulse = 0.75 + 0.25 * Math.sin(t / 380);
      ctx.save();
      ctx.shadowColor = colors.accent;
      ctx.shadowBlur = 7 * pulse;
      var g = ctx.createLinearGradient(dx, dy - h, dx, dy);
      g.addColorStop(0, "rgba(255, 236, 160, " + (0.55 * pulse) + ")");
      g.addColorStop(1, "rgba(255, 196, 80, " + (0.9 * pulse) + ")");
      ctx.fillStyle = g;
      ctx.fillRect(dx - w / 2, dy - h, w, h);
      ctx.restore();
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(dx - w / 2 - 0.5, dy - h - 0.5, w + 1, h + 0.5);
      var flicker = Math.random() < 0.07 ? 0.2 : 1;
      ctx.save();
      ctx.globalAlpha *= flicker;
      ctx.fillStyle = "#E5484D";
      ctx.font = "bold 5px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.shadowColor = "#E5484D";
      ctx.shadowBlur = 3;
      ctx.fillText("EXIT", dx + R.side * -1, dy - h - 2);
      ctx.restore();
    });
  }

  function drawEffects(dt, fade) {
    effects.forEach(function (e) {
      e.t += dt;
      var k = e.t / 0.8;
      if (k >= 1) { e.done = true; return; }
      ctx.save();
      ctx.fillStyle = colors.muted;
      for (var i = 0; i < 7; i++) {
        var a = i / 7 * Math.PI * 2 + 0.4;
        ctx.globalAlpha = fade * 0.55 * (1 - k);
        ctx.beginPath();
        ctx.arc(e.x + Math.cos(a) * (2 + 9 * k), e.y + Math.sin(a) * (2 + 7 * k), 1.2 + 3.4 * k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = fade * (1 - k);
      ctx.fillStyle = colors.ink;
      ctx.font = "600 7px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("poof!", e.x, e.y - 10 - 12 * k);
      ctx.restore();
    });
    effects = effects.filter(function (e) { return !e.done; });
  }

  function draw(t, dt, fade) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.translate(-window.scrollX, -window.scrollY);
    ctx.globalAlpha = fade;
    drawLadders();
    drawRamps(t);
    var top = window.scrollY - 30, bottom = window.scrollY + window.innerHeight + 30;
    figs.forEach(function (f) { if (f.y > top && f.y - H < bottom) drawFigure(f, t); });
    drawEffects(dt, fade);
    ctx.globalAlpha = 1;
  }

  /* ---------------- loop ---------------- */

  function frame(t) {
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min(0.05, (t - last) / 1000) * timeScale : 0;
    last = t;
    if (dirty) computeWorld();
    var now = performance.now();
    var fade = 1;
    if (fadeOut) {
      fade = 1 - (now - fadeOut) / 300;
      if (fade <= 0) { stopLoop(true); return; }
    }
    figs.forEach(function (f) {
      if (f.wave > 0) f.wave -= dt;
      if (f.bounce > 0) f.bounce -= dt;
      var moving = f.state === "climb" || f.state === "exit" || (f.state === "walk" && f.wave <= 0);
      if (moving) f.phase += dt * (f.state === "climb" ? 9 : 11);
      if (f.state === "walk") walk(f, dt);
      else if (f.state === "fall") fall(f, dt);
      else if (f.state === "climb") climb(f, dt);
      else if (f.state === "exit") exitStep(f, dt);
    });
    if (!fadeOut) collide(now);
    figs.forEach(function (f) { settle(f, false); });
    figs = figs.filter(function (f) { return !f.dead; });
    if (!fadeOut) {
      if (figs.length) emptySince = 0;
      else if (!emptySince) emptySince = now;
      else if (now - emptySince > RESPAWN_MS) { emptySince = 0; spawn(START); }
    }
    draw(t, dt, fade);
    updateCounter();
  }

  function startLoop() {
    if (raf || !enabled || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stopLoop(clear) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (clear) {
      figs = []; effects = []; fadeOut = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      updateCounter();
    }
  }

  /* ---------------- toggle, counter, clicks ---------------- */

  var FIGURE_SVG =
    '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="4" r="2.2"/><path d="M10 6.4v6M10 12.4l-3.2 5M10 12.4l3.2 5' +
    'M10 8.2l-3.6 2.6M10 8.2l3.6 2.6"/><path class="sf-slash" d="M3 17L17 3" stroke-width="1.8"/></svg>';

  function injectCss() {
    var css =
      ".sf-canvas{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:40}" +
      ".sf-ui{position:absolute;top:10px;right:10px;z-index:45;display:flex;align-items:center;gap:3px;" +
      "font:600 12px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}" +
      ".sf-toggle{position:relative;width:28px;height:28px;padding:0;border-radius:9px;border:1px solid transparent;" +
      "background:transparent;color:" + "var(--accent,#0E7C86)" + ";cursor:pointer;display:grid;place-items:center;" +
      "transition:background .15s,border-color .15s,color .15s}" +
      ".sf-toggle:hover,.sf-toggle:focus-visible{background:rgba(14,124,134,.13);border-color:rgba(14,124,134,.3);outline:none}" +
      ".sf-toggle[aria-pressed=false]{color:#9AA9AF}" +
      ".sf-toggle .sf-slash{display:none}.sf-toggle[aria-pressed=false] .sf-slash{display:inline}" +
      ".sf-toggle::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);right:0;white-space:nowrap;" +
      "background:#16262E;color:#fff;font:500 12px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;" +
      "padding:6px 8px;border-radius:7px;opacity:0;transform:translateY(-3px);pointer-events:none;" +
      "transition:opacity .15s,transform .15s;z-index:1}" +
      ".sf-toggle:hover::after,.sf-toggle:focus-visible::after{opacity:1;transform:none}" +
      ".sf-count{color:var(--muted,#64808B);min-width:2.4em;font-variant-numeric:tabular-nums;pointer-events:none}" +
      ".sf-count[hidden]{display:none}" +
      "@media (prefers-reduced-motion:reduce){.sf-toggle,.sf-toggle::after{transition:none}}";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildUi() {
    canvas = document.createElement("canvas");
    canvas.className = "sf-canvas";
    canvas.setAttribute("aria-hidden", "true");
    ctx = canvas.getContext("2d");
    ui = document.createElement("div");
    ui.className = "sf-ui";
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sf-toggle";
    toggle.innerHTML = FIGURE_SVG;
    counter = document.createElement("span");
    counter.className = "sf-count";
    counter.setAttribute("aria-hidden", "true");
    ui.appendChild(toggle);
    ui.appendChild(counter);
    document.body.appendChild(canvas);
    document.body.appendChild(ui);
    toggle.addEventListener("click", function () { setEnabled(!enabled, true); });
    resizeCanvas();
  }

  // Top-right of the page, nudged left of anything clickable it would cover (e.g. Arrange).
  function placeUi() {
    if (!ui) return;
    var right = 10, sx = window.scrollX;
    ui.style.right = right + "px";
    var others = document.querySelectorAll("a, button, input, select, textarea, [role=button], " + BOX_SELECTOR);
    for (var pass = 0; pass < 6; pass++) {
      var u = ui.getBoundingClientRect(), moved = false;
      for (var i = 0; i < others.length; i++) {
        var el = others[i];
        if (ui.contains(el)) continue;
        var r = el.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(el).position === "fixed") continue;
        if (r.right + 6 > u.left && r.left - 6 < u.right && r.bottom + 4 > u.top && r.top - 4 < u.bottom) {
          right = W.width - (r.left + sx) + 8;
          ui.style.right = right + "px";
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
  }

  function updateCounter() {
    var n = enabled ? figs.length : -1;
    if (n === shownCount) return;
    shownCount = n;
    counter.hidden = !enabled;
    counter.textContent = "×" + Math.max(0, n);
  }

  function setEnabled(on, save) {
    if (save) { try { localStorage.setItem(STORE_KEY, on ? "on" : "off"); } catch (e) {} }
    enabled = on;
    toggle.setAttribute("aria-pressed", on ? "true" : "false");
    var tip = on ? "Turn off stick figures" : "Turn on stick figures";
    toggle.setAttribute("data-tip", tip);
    toggle.setAttribute("aria-label", tip);
    if (on) {
      fadeOut = 0;
      dirty = true;
      computeWorld();
      if (!figs.length) spawn(START);
      startLoop();
    } else if (raf) {
      fadeOut = performance.now();   // the loop fades everything out, then stops
    } else {
      stopLoop(true);
    }
    updateCounter();
  }

  function figureAt(clientX, clientY) {
    var x = clientX + window.scrollX, y = clientY + window.scrollY, pad = 5, best = null, bd = Infinity;
    figs.forEach(function (f) {
      if (f.dead || f.state === "exit") return;
      if (x < f.x - HALF_W - pad || x > f.x + HALF_W + pad || y < f.y - H - pad || y > f.y + pad) return;
      var d = Math.abs(x - f.x) + Math.abs(y - (f.y - H / 2));
      if (d < bd) { bd = d; best = f; }
    });
    return best;
  }

  function isInteractive(target) {
    return !!(target && target.closest && target.closest(IGNORE));
  }

  function onClick(e) {
    if (!enabled || fadeOut || isInteractive(e.target)) return;
    var f = figureAt(e.clientX, e.clientY);
    if (!f || f.state === "climb") return;
    if (Math.random() < 0.5 && f.state === "walk") { f.state = "fall"; f.vy = -170; f.vx = 0; f.dismount = null; }
    else f.wave = 1.2;
  }

  var cursorSet = false;
  function onPointerMove(e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    var over = enabled && !fadeOut && !isInteractive(e.target) && figureAt(e.clientX, e.clientY);
    if (over && !cursorSet) { document.documentElement.style.cursor = "pointer"; cursorSet = true; }
    else if (!over && cursorSet) { document.documentElement.style.cursor = ""; cursorSet = false; }
  }

  /* ---------------- start ---------------- */

  function markDirty() { dirty = true; }

  function init() {
    injectCss();
    buildUi();
    computeWorld();
    var saved = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch (e) {}
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEnabled(saved ? saved === "on" : !reduce, false);

    window.addEventListener("resize", function () { resizeCanvas(); markDirty(); }, { passive: true });
    window.addEventListener("scroll", markDirty, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(markDirty).observe(document.body);
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) if (!ui.contains(list[i].target)) { dirty = true; return; }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    if (window.matchMedia) {
      var mq = matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", markDirty);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
      else startLoop();
    });
    document.addEventListener("click", onClick);
    // test hook, only on a local preview
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      window.__dittoFigures = {
        figs: function () { return figs; }, world: function () { return W; }, cap: CAP,
        spawn: spawn, setSpeed: function (k) { timeScale = k; }, hitsBox: hitsBox
      };
    }
    document.addEventListener("pointermove", onPointerMove, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
