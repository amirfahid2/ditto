/* Ditto stick figures — a decorative layer that never gets in the way.
 *
 * Tiny walkers drop out of the sky above the title, live in the gaps, margins and
 * background, stand only on the outer top edges of boxes, grab edges as they fall,
 * pull themselves up and crawl under low ceilings, climb ladders beside the board and
 * leave through one glowing EXIT door at the bottom right. The canvas has
 * pointer-events: none; clicks are read with a passive document listener that never
 * calls preventDefault.
 *
 * <script src="figures.js" defer data-boxes=".sq, .store" data-sky=".wordmark"></script>
 *   data-boxes        CSS selector for boxes figures must never enter (their tops are platforms)
 *   data-sky          element new figures fall from above (default: the first box)
 *   data-ladder-from  element whose top is the foot of the left ladder (default: the ground)
 *   data-ignore       extra selector whose clicks the figures ignore (e.g. ".scrim, .sheet")
 *   data-cap          population cap (default 50; 5 on small screens)
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var ds = (script && script.dataset) || {};
  var BOX_SELECTOR = ds.boxes || ".sq";
  var IGNORE = "a, button, input, select, textarea, label, summary, [role=button], [contenteditable], .sf-ui" +
    (ds.ignore ? ", " + ds.ignore : "");
  var TEXT_SELECTOR = "p, h1, h2, h3, h4, li, a, label, button, .wordmark";
  var STORE_KEY = "ditto.figures";

  var H = 14.6, HALF_W = 3;      // standing: feet to top of head, half the body width
  var HC = 8.6, HALF_WC = 5;     // crawling on hands and knees
  var GRAVITY = 700, CLIMB = 26, WALK_MIN = 15, WALK_MAX = 24, CRAWL_MIN = 8, CRAWL_MAX = 12;
  var START = 2, COOLDOWN = 2000, EXIT_CHANCE = 0.3, GRAB_CHANCE = 0.35, RESPAWN_MS = 4000;
  var SMALL = Math.min(window.innerWidth, screen.width || 9999) < 520;
  var CAP = SMALL ? 5 : (parseInt(ds.cap, 10) || 50);

  var W = { width: 0, height: 0, ground: 0, boxes: [], ladders: [], door: null };
  var figs = [], effects = [];
  var enabled = false, dirty = true, raf = 0, last = 0, nextId = 1, emptySince = 0, fadeOut = 0;
  var colors = { ink: "#16262E", muted: "#64808B", accent: "#0E7C86" };
  var canvas, ctx, ui, toggle, counter, dpr = 1, shownCount = null, timeScale = 1;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ease(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }

  /* ---------------- terrain ---------------- */

  function docRect(el) {
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if ((cs.animationName && cs.animationName !== "none") || cs.transform !== "none") {
      // wiggling or scaled (Arrange mode, a pressed square): the untransformed box plus a margin
      var x = 0, y = 0, n = el, pad = 2;
      while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      return { l: x - pad, t: y - pad, r: x + el.offsetWidth + pad, b: y + el.offsetHeight + pad };
    }
    return { l: r.left + window.scrollX, t: r.top + window.scrollY, r: r.right + window.scrollX, b: r.bottom + window.scrollY };
  }

  function computeWorld() {
    var de = document.documentElement;
    W.width = de.clientWidth;
    W.height = Math.max(de.scrollHeight, window.innerHeight);
    W.ground = W.height - 3;
    W.boxes = [];
    var els = document.querySelectorAll(BOX_SELECTOR);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (ui && ui.contains(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (getComputedStyle(el).position === "fixed") continue;
      W.boxes.push(docRect(el));
    }
    buildLadders();
    buildDoor();
    // ladders are rebuilt on every layout change: keep climbers on the one at the same spot
    figs.forEach(function (f) {
      if (f.ladder) f.ladder = sameLadder(f.ladder);
      if (f.goal && f.goal.ladder) f.goal = sameLadder(f.goal.ladder) ? { ladder: sameLadder(f.goal.ladder) } : null;
      if (f.climbAfter) f.climbAfter = sameLadder(f.climbAfter);
    });
    readColors();
    placeUi();
    dirty = false;
  }

  // Does a figure with its feet at (x, y) overlap the inside of a box? Standing exactly on a
  // top edge is fine; a box above that leaves less than the figure's height is not.
  function hitsBox(x, y, hw, h) {
    hw = hw || HALF_W; h = h || H;
    for (var i = 0; i < W.boxes.length; i++) {
      var b = W.boxes[i];
      if (x + hw > b.l && x - hw < b.r && y > b.t + 0.5 && y - h < b.b) return b;
    }
    return null;
  }

  function extents(f) {
    if (f.state === "crawl" || (f.state === "pull" && f.grab && f.grab.k > 0.55)) return [HALF_WC, HC];
    return [HALF_W, H];
  }

  function platformUnder(x, y) {
    for (var i = 0; i < W.boxes.length; i++) {
      var b = W.boxes[i];
      if (Math.abs(b.t - y) < 0.75 && x >= b.l && x <= b.r) return b;
    }
    return null;
  }

  function regionClear(l, t, r, b, list) {
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      if (r > q.l && l < q.r && b > q.t && t < q.b) return false;
    }
    return true;
  }

  function textRects() {
    var out = [], els = document.querySelectorAll(TEXT_SELECTOR);
    for (var i = 0; i < els.length; i++) {
      if (ui && ui.contains(els[i])) continue;
      var r = els[i].getBoundingClientRect();
      if (r.width && r.height) out.push(docRect(els[i]));
    }
    return out;
  }

  function sameLadder(old) {
    for (var i = 0; i < W.ladders.length; i++) {
      var L = W.ladders[i];
      if (Math.abs(L.x - old.x) < 3 && Math.abs(L.top - old.top) < 6) return L;
    }
    return null;
  }

  // Ladders: one up the left side from the top of the "saved" note, one up the right side
  // from the ground (so a figure at the bottom can always get back up), and one in any
  // vertical gap of 20 px or more.
  function buildLadders() {
    W.ladders = [];
    if (!W.boxes.length) return;
    var texts = textRects();
    function addLadder(x, top, bottom, exitX, exitDir) {
      if (x < 6 || x > W.width - 6 || bottom - top < H * 2) return;
      if (!regionClear(x - 5, top - H, x + 5, bottom - 0.5, W.boxes)) return;
      if (!regionClear(x - 4.5, top - 4, x + 4.5, bottom - 0.5, texts)) return;
      for (var i = 0; i < W.ladders.length; i++) {
        var o = W.ladders[i];
        if (Math.abs(o.x - x) < 12 && bottom > o.top && top < o.bottom) return;   // conflicts with an existing ladder
      }
      W.ladders.push({ x: x, top: top, bottom: bottom, exitX: exitX, exitDir: exitDir });
    }
    var minL = Infinity, maxR = -Infinity;
    W.boxes.forEach(function (b) { minL = Math.min(minL, b.l); maxR = Math.max(maxR, b.r); });
    var leftTop = null, rightTop = null;
    W.boxes.forEach(function (b) {
      if (b.l < minL + 30 && !hitsBox(b.l + 5, b.t) && (!leftTop || b.t < leftTop.t)) leftTop = b;
      if (b.r > maxR - 30 && !hitsBox(b.r - 5, b.t) && (!rightTop || b.t < rightTop.t)) rightTop = b;
    });
    var leftX = Math.max(minL - 12, 8), rightX = Math.min(maxR + 12, W.width - 8);
    var from = ds.ladderFrom && document.querySelector(ds.ladderFrom);
    if (leftTop && leftX + 4.5 < minL - 1) {
      var bottom = from ? docRect(from).t : W.ground;
      addLadder(leftX, leftTop.t, bottom, leftTop.l + 5, 1);
    }
    if (rightTop && rightX - 4.5 > maxR + 1) addLadder(rightX, rightTop.t, W.ground, rightTop.r - 5, -1);
    W.boxes.forEach(function (a) {
      var right = null;
      W.boxes.forEach(function (b) {
        if (b === a || Math.abs(b.t - a.t) > 3 || b.l < a.r) return;
        if (!right || b.l < right.l) right = b;
      });
      if (!right || right.l - a.r < 20) return;
      addLadder((a.r + right.l) / 2, Math.min(a.t, right.t), W.ground, right.l + 5, 1);
    });
  }

  // The single exit: a glowing door on the ground in the bottom-right corner.
  function buildDoor() {
    W.door = null;
    var texts = textRects(), x = W.width - 14;
    for (var tries = 0; tries < 8; tries++, x -= 10) {
      var clash = W.ladders.some(function (L) { return Math.abs(L.x - x) < 12 && L.bottom > W.ground - 20; });
      if (clash) continue;
      if (regionClear(x - 6, W.ground - 22, x + 6, W.ground, W.boxes) && regionClear(x - 6, W.ground - 22, x + 6, W.ground, texts)) {
        W.door = { x: x, y: W.ground };
        return;
      }
    }
  }

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    colors.ink = (cs.getPropertyValue("--ink") || "").trim() || colors.ink;
    colors.muted = (cs.getPropertyValue("--muted") || "").trim() || colors.muted;
    colors.accent = (cs.getPropertyValue("--accent") || "").trim() || colors.accent;
  }

  /* ---------------- figures ---------------- */

  function makeFig(x, y) {
    var f = {
      id: nextId++, x: x, y: y, dir: Math.random() < 0.5 ? -1 : 1, speed: rand(WALK_MIN, WALK_MAX),
      crawlSpeed: rand(CRAWL_MIN, CRAWL_MAX), state: "walk", vx: 0, vy: 0, phase: rand(0, 6),
      born: performance.now(), lastHit: -1e9, wave: 0, bounce: 0, squash: 0, goal: null, dismount: null,
      climbAfter: null, ladder: null, grab: null, crawlLeft: 0, tried: {}, alpha: 1, scale: 1, dead: false
    };
    figs.push(f);
    return f;
  }

  // New figures fall out of the sky above the title, spread a little sideways.
  function skySpawn(n) {
    var anchor = ds.sky && document.querySelector(ds.sky);
    var a = anchor ? docRect(anchor) : (W.boxes[0] || { l: W.width / 2 - 20, r: W.width / 2 + 20 });
    for (var i = 0; i < n && figs.length < CAP; i++) {
      var f = makeFig(rand(a.l + 4, Math.max(a.l + 5, a.r - 4)), -rand(20, 60) - i * 28);
      f.state = "fall";
      f.vy = rand(0, 30);
    }
  }

  function onGround(f) { return Math.abs(f.y - W.ground) < 0.75; }

  function chooseGoal(f) {
    var ladders = W.ladders.filter(function (L) { return Math.abs(L.bottom - W.ground) < 2; });
    if (W.door && (Math.random() < EXIT_CHANCE || !ladders.length)) return { exit: true };
    if (!ladders.length) return { wander: true };
    var best = ladders[0];
    ladders.forEach(function (L) { if (Math.abs(L.x - f.x) < Math.abs(best.x - f.x)) best = L; });
    return { ladder: best };
  }

  function touchDown(f, vy) {
    f.state = "walk"; f.vx = 0; f.vy = 0; f.goal = null; f.tried = {};
    if (vy > 140) f.squash = 0.22;
  }

  function startCrawl(f, distance) {
    f.state = "crawl";
    f.crawlLeft = distance;
  }

  // Where would a figure dropping at x from y land? null if onto a box with no room even to crawl.
  function dropTarget(x, y) {
    var land = null;
    W.boxes.forEach(function (b) {
      if (x + HALF_W > b.l && x - HALF_W < b.r && b.t >= y && (!land || b.t < land.t)) land = b;
    });
    if (!land || land.t > W.ground) return hitsBox(x, W.ground) ? null : W.ground;
    var lx = clamp(x, land.l + 0.5, land.r - 0.5);
    return (hitsBox(lx, land.t) && hitsBox(lx, land.t, HALF_WC, HC)) ? null : land.t;
  }

  function stepOffEdge(f, p, crawling) {
    var edge = f.dir > 0 ? p.r : p.l;
    // a ladder whose foot is at this height just past the edge: walk onto it and climb
    for (var i = 0; i < W.ladders.length; i++) {
      var L = W.ladders[i], reach = f.dir > 0 ? L.x - edge : edge - L.x;
      if (Math.abs(L.bottom - f.y) < 2 && reach >= 0 && reach <= 16 && !crawling) {
        f.dismount = L.x; f.climbAfter = L;
        return;
      }
    }
    var neighbour = null, gap = 0;
    W.boxes.forEach(function (b) {
      if (b === p || Math.abs(b.t - p.t) > 2) return;
      var g = f.dir > 0 ? b.l - p.r : p.l - b.r;
      if (g >= 0 && g <= 18 && (!neighbour || g < gap)) { neighbour = b; gap = g; }
    });
    var dropX = edge + f.dir * (HALF_W + 1);
    var canDrop = !hitsBox(dropX, f.y) && dropTarget(dropX, f.y) !== null;
    if (!crawling && neighbour && !hitsBox(f.dir > 0 ? neighbour.l + 5 : neighbour.r - 5, neighbour.t) &&
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
      if (hitsBox(f.x + s, f.y)) { f.dismount = null; f.climbAfter = null; return; }
      f.x += s; f.dir = Math.sign(d) || f.dir;
      if (Math.abs(f.dismount - f.x) < 0.5) {
        f.dismount = null;
        if (f.climbAfter) { f.x = f.climbAfter.x; f.ladder = f.climbAfter; f.climbAfter = null; f.state = "climb"; }
      }
      return;
    }
    if (onGround(f)) {
      if (f.bounce <= 0) {
        if (!f.goal || (f.goal.ladder && W.ladders.indexOf(f.goal.ladder) < 0) || (f.goal.exit && !W.door)) f.goal = chooseGoal(f);
        if (f.goal.ladder) {
          var L = f.goal.ladder, dx = L.x - f.x;
          if (Math.abs(dx) < 0.8) { f.x = L.x; f.state = "climb"; f.ladder = L; f.goal = null; return; }
          f.dir = dx > 0 ? 1 : -1;
          step = Math.min(step, Math.abs(dx));
        } else if (f.goal.exit) {
          f.dir = W.door.x >= f.x ? 1 : -1;
        }
      }
      var nx = f.x + f.dir * step;
      if (f.goal && f.goal.exit && W.door && Math.abs(nx - W.door.x) < 1.5) {
        f.state = "exit"; f.exitT = 0; f.door = W.door;
        return;
      }
      if (nx < 4 || nx > W.width - 4) { f.dir = -f.dir; f.goal = null; return; }   // page edge: turn around
      if (hitsBox(nx, W.ground)) {
        if (!hitsBox(nx, W.ground, HALF_WC, HC)) { startCrawl(f, 14); return; }
        f.dir = -f.dir; f.goal = { wander: true }; f.bounce = 1;
        return;
      }
      f.x = nx;
      return;
    }
    var p = platformUnder(f.x, f.y);
    if (!p) { f.state = "fall"; f.vy = 0; f.vx = 0; return; }
    var px = f.x + f.dir * step;
    if (px >= p.l && px <= p.r) {
      if (hitsBox(px, f.y)) {
        // low ceiling: get down and crawl under it, or turn back if even that won't fit
        if (!hitsBox(px, f.y, HALF_WC, HC)) startCrawl(f, 10); else f.dir = -f.dir;
        return;
      }
      f.x = px;
      return;
    }
    stepOffEdge(f, p, false);
  }

  function crawl(f, dt) {
    var step = f.crawlSpeed * dt;
    var nx = f.x + f.dir * step;
    if (onGround(f)) {
      if (nx < 6 || nx > W.width - 6) { f.dir = -f.dir; return; }
      if (hitsBox(nx, W.ground, HALF_WC, HC)) { f.dir = -f.dir; return; }
      f.x = nx;
    } else {
      var p = platformUnder(f.x, f.y);
      if (!p) { f.state = "fall"; f.vy = 0; f.vx = 0; return; }
      if (nx < p.l || nx > p.r) { stepOffEdge(f, p, true); return; }   // crawl off the edge into the gap
      if (hitsBox(nx, f.y, HALF_WC, HC)) { f.dir = -f.dir; return; }
      f.x = nx;
    }
    f.crawlLeft -= step;
    if (f.crawlLeft <= 0 && !hitsBox(f.x, f.y)) f.state = "walk";   // room to stand: up and walking
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
    if (tryGrab(f, nx, ny)) return;
    var land = null;
    W.boxes.forEach(function (b) {
      if (nx + HALF_W > b.l && nx - HALF_W < b.r && b.t >= f.y - 0.01 && b.t <= ny && (!land || b.t < land.t)) land = b;
    });
    if (land && land.t <= W.ground) {
      var lx = clamp(nx, land.l + 0.5, land.r - 0.5);
      if (!hitsBox(lx, land.t)) { f.x = lx; f.y = land.t; touchDown(f, f.vy); return; }
      if (!hitsBox(lx, land.t, HALF_WC, HC)) {          // too low to stand: land crouched and crawl
        f.x = lx; f.y = land.t; touchDown(f, 0); startCrawl(f, 12);
        return;
      }
      // no room at all on that box: slip past its side and keep dropping through the gap
      var sideX = nx < (land.l + land.r) / 2 ? land.l - HALF_W - 1 : land.r + HALF_W + 1;
      if (!hitsBox(sideX, f.y)) { f.x = sideX; f.vx = 0; f.y = Math.min(ny, land.t - 0.1); return; }
      settle(f, true);
      return;
    }
    if (ny >= W.ground) { f.x = nx; f.y = W.ground; touchDown(f, f.vy); return; }
    f.x = nx; f.y = ny;
  }

  // Falling past the side of a box, the raised hands sometimes catch its top corner.
  function tryGrab(f, nx, ny) {
    var handsBefore = f.y - H - 1, handsNow = ny - H - 1;
    for (var i = 0; i < W.boxes.length; i++) {
      var b = W.boxes[i];
      if (b.t <= handsBefore || b.t > handsNow) continue;
      var side;
      if (b.l - (nx + HALF_W) >= 0 && b.l - (nx + HALF_W) <= 5) side = -1;          // figure is left of the box
      else if ((nx - HALF_W) - b.r >= 0 && (nx - HALF_W) - b.r <= 5) side = 1;      // figure is right of it
      else continue;
      var key = Math.round(b.l) + ":" + Math.round(b.t);
      if (f.tried[key]) continue;
      f.tried[key] = true;
      if (Math.random() > GRAB_CHANCE) continue;
      var hx = side < 0 ? b.l - HALF_W - 1 : b.r + HALF_W + 1, hy = b.t + 15;
      var topX = side < 0 ? b.l + HALF_WC + 1 : b.r - HALF_WC - 1;
      // the whole move must stay in the gap and on the edge: hanging, rising beside the box, crawling on top
      if (hitsBox(hx, hy) || hitsBox(hx, b.t) || hitsBox(topX, b.t, HALF_WC, HC) || b.r - b.l < 2 * HALF_WC + 4) continue;
      f.state = "hang"; f.x = hx; f.y = hy; f.vx = 0; f.vy = 0;
      f.grab = { cx: side < 0 ? b.l : b.r, cy: b.t, side: side, hx: hx, hy: hy, topX: topX, t: 0, k: 0, hold: rand(0.35, 0.75) };
      return true;
    }
    return false;
  }

  function grabStillValid(f) {
    var g = f.grab;
    return !!g && W.boxes.some(function (b) { return Math.abs(b.t - g.cy) < 1 && Math.abs((g.side < 0 ? b.l : b.r) - g.cx) < 1; });
  }

  function hang(f, dt) {
    if (!grabStillValid(f)) { f.state = "fall"; f.vy = 0; f.grab = null; return; }
    f.grab.t += dt;
    if (f.grab.t >= f.grab.hold) { f.state = "pull"; f.grab.t = 0; }
  }

  // Pull-up: rise beside the box until the feet reach its top, then roll onto the edge on hands and knees.
  function pull(f, dt) {
    if (!grabStillValid(f)) { f.state = "fall"; f.vy = 0; f.grab = null; return; }
    var g = f.grab;
    g.t += dt;
    g.k = Math.min(1, g.t / 0.8);
    if (g.k < 0.55) {
      f.x = g.hx;
      f.y = g.hy + (g.cy - g.hy) * ease(g.k / 0.55);
    } else {
      f.y = g.cy;
      f.x = g.hx + (g.topX - g.hx) * ease((g.k - 0.55) / 0.45);
    }
    f.dir = -g.side;
    if (g.k >= 1) { f.x = g.topX; f.grab = null; startCrawl(f, rand(16, 36)); }
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
    var e = extents(f);
    if (!force && !hitsBox(f.x, f.y, e[0], e[1])) return;
    var best = null, bd = Infinity;
    W.boxes.forEach(function (b) {
      if (b.r - b.l < 2 * HALF_W) return;
      var x = clamp(f.x, b.l + HALF_W, b.r - HALF_W);
      if (hitsBox(x, b.t)) return;
      var d = Math.abs(x - f.x) + Math.abs(b.t - f.y);
      if (d < bd) { bd = d; best = { x: x, y: b.t }; }
    });
    var gx = clamp(f.x, 6, W.width - 6);
    if (!hitsBox(gx, W.ground) && Math.abs(gx - f.x) + Math.abs(W.ground - f.y) < bd) best = { x: gx, y: W.ground };
    if (!best) { f.dead = true; return; }
    f.x = best.x; f.y = best.y; f.state = "walk"; f.vx = 0; f.vy = 0;
    f.dismount = null; f.climbAfter = null; f.goal = null; f.grab = null;
  }

  function collide(now) {
    for (var i = 0; i < figs.length; i++) {
      var a = figs[i];
      if (a.state !== "walk" || a.dismount !== null || a.wave > 0 || a.dead) continue;
      for (var j = i + 1; j < figs.length; j++) {
        var b = figs[j];
        if (b.state !== "walk" || b.dismount !== null || b.wave > 0 || b.dead) continue;
        if (Math.abs(a.y - b.y) > 2 || Math.abs(a.x - b.x) > 5) continue;
        var left = a.x <= b.x ? a : b, right = left === a ? b : a;
        left.dir = -1; right.dir = 1; left.bounce = right.bounce = 0.7;
        left.goal = right.goal = null;
        if (now - a.lastHit > COOLDOWN && now - b.lastHit > COOLDOWN) {
          a.lastHit = b.lastHit = now;
          replicate(now);
        }
      }
    }
  }

  // A collision brings one more figure, dropping in from the sky like everyone else.
  function replicate(now) {
    var alive = figs.filter(function (f) { return !f.dead; });
    if (alive.length >= CAP) {
      var oldest = alive.reduce(function (o, f) { return f.born < o.born ? f : o; });
      poof(oldest);
    }
    var before = figs.length;
    skySpawn(1);
    if (figs.length > before) figs[figs.length - 1].lastHit = now;
  }

  function poof(f) {
    f.dead = true;
    var e = extents(f);
    effects.push({ x: f.x, y: f.y - e[1] / 2, t: 0 });
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

  function pen() {
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1.25;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  // On hands and knees, facing +x (mirrored for -x).
  function drawCrawler(f) {
    var s = Math.sin(f.phase);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.dir, 1);
    pen();
    ctx.beginPath();
    ctx.moveTo(-3.2, -4.2); ctx.lineTo(2.4, -5.2);                                             // back
    ctx.moveTo(-3.2, -4.2); ctx.lineTo(-2.6 + 1.3 * s, 0); ctx.lineTo(-4.6 + 1.3 * s, -0.4);   // leg
    ctx.moveTo(-3.2, -4.2); ctx.lineTo(-2.6 - 1.3 * s, 0); ctx.lineTo(-4.6 - 1.3 * s, -0.4);   // leg
    ctx.moveTo(2.4, -5.2); ctx.lineTo(3.0 - 1.3 * s, 0);                                       // arm
    ctx.moveTo(2.4, -5.2); ctx.lineTo(3.0 + 1.3 * s, 0);                                       // arm
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(3.9, -6.6, 1.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Hanging from a corner or pulling up: both hands on the corner, body below and beside it.
  function drawHanger(f, t) {
    var g = f.grab;
    ctx.save();
    pen();
    var sx = f.x, sy = f.y - 10.4;                      // shoulders
    var hx = g.cx - g.side * 0.6, hy = g.cy - 0.6;      // hands just outside the corner
    var kick = f.state === "pull" ? 0.55 * Math.sin(t / 60) : 0.18 * Math.sin(t / 160);
    ctx.beginPath();
    ctx.moveTo(sx, sy); ctx.lineTo(hx, hy);
    ctx.moveTo(sx, sy); ctx.lineTo(hx + g.side * 1.4, hy + 0.3);
    ctx.moveTo(f.x, f.y - 6.6); ctx.lineTo(f.x, f.y - 11);
    limb(f.x, f.y - 6.6, kick, 6.6);
    limb(f.x, f.y - 6.6, -kick * 0.6 - 0.1, 6.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(f.x, f.y - 12.7, 1.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawFigure(f, t) {
    if (f.state === "crawl" || (f.state === "pull" && f.grab && f.grab.k > 0.55)) { drawCrawler(f); return; }
    if ((f.state === "hang" || f.state === "pull") && f.grab) { drawHanger(f, t); return; }
    ctx.save();
    ctx.translate(f.x, f.y);
    var sq = f.squash > 0 ? f.squash / 0.22 : 0;          // landing squash
    ctx.scale((f.state === "climb" ? 1 : f.dir) * f.scale * (1 + 0.28 * sq), f.scale * (1 - 0.28 * sq));
    ctx.globalAlpha *= f.alpha;
    pen();
    var s = Math.sin(f.phase), legA, legB, armA, armB;
    if (f.state === "climb") {
      legA = 0.35 * s; legB = -0.35 * s; armA = 2.7 + 0.35 * s; armB = -2.7 + 0.35 * s;
    } else if (f.state === "fall") {
      var fl = t / 55 + f.id;                              // flailing
      legA = 0.3 + 0.25 * Math.sin(fl * 0.8); legB = -0.3 - 0.25 * Math.sin(fl * 0.8 + 1);
      armA = 2.25 + 0.6 * Math.sin(fl); armB = -2.25 - 0.6 * Math.sin(fl + 1.3);
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
    ctx.save();
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
    ctx.restore();
  }

  // The exit: a glowing doorway on the ground with a flickering sign above it.
  function drawDoor(t) {
    var D = W.door;
    if (!D) return;
    var dx = D.x, dy = D.y, w = 9, h = 14;
    var pulse = 0.75 + 0.25 * Math.sin(t / 380);
    ctx.save();
    ctx.shadowColor = colors.accent;
    ctx.shadowBlur = 8 * pulse;
    var g = ctx.createLinearGradient(dx, dy - h, dx, dy);
    g.addColorStop(0, "rgba(255, 236, 160, " + (0.55 * pulse) + ")");
    g.addColorStop(1, "rgba(255, 196, 80, " + (0.95 * pulse) + ")");
    ctx.fillStyle = g;
    ctx.fillRect(dx - w / 2, dy - h, w, h);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(dx - w / 2 - 0.5, dy - h - 0.5, w + 1, h + 0.5);
    ctx.beginPath();                                    // door mat
    ctx.moveTo(dx - 7, dy + 0.5); ctx.lineTo(dx + 7, dy + 0.5);
    ctx.stroke();
    ctx.globalAlpha *= Math.random() < 0.07 ? 0.2 : 1;  // the sign flickers
    ctx.fillStyle = "#E5484D";
    ctx.shadowColor = "#E5484D";
    ctx.shadowBlur = 3;
    ctx.font = "bold 5px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("EXIT", dx, dy - h - 2);
    ctx.restore();
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
    drawDoor(t);
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
      if (f.squash > 0) f.squash -= dt;
      var moving = f.state === "climb" || f.state === "exit" || f.state === "crawl" || (f.state === "walk" && f.wave <= 0);
      if (moving) f.phase += dt * (f.state === "climb" ? 9 : f.state === "crawl" ? 8 : 11);
      if (f.state === "walk") walk(f, dt);
      else if (f.state === "fall") fall(f, dt);
      else if (f.state === "climb") climb(f, dt);
      else if (f.state === "hang") hang(f, dt);
      else if (f.state === "pull") pull(f, dt);
      else if (f.state === "crawl") crawl(f, dt);
      else if (f.state === "exit") exitStep(f, dt);
    });
    if (!fadeOut) collide(now);
    figs.forEach(function (f) { settle(f, false); });
    figs = figs.filter(function (f) { return !f.dead; });
    if (!fadeOut) {
      if (figs.length) emptySince = 0;
      else if (!emptySince) emptySince = now;
      else if (now - emptySince > RESPAWN_MS) { emptySince = 0; skySpawn(START); }
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
      "background:transparent;color:var(--accent,#0E7C86);cursor:pointer;display:grid;place-items:center;" +
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
    var sx = window.scrollX;
    ui.style.right = "10px";
    var others = document.querySelectorAll("a, button, input, select, textarea, [role=button], " + BOX_SELECTOR);
    for (var pass = 0; pass < 6; pass++) {
      var u = ui.getBoundingClientRect(), moved = false;
      for (var i = 0; i < others.length; i++) {
        var el = others[i];
        if (ui.contains(el)) continue;
        var r = el.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(el).position === "fixed") continue;
        if (r.right + 6 > u.left && r.left - 6 < u.right && r.bottom + 4 > u.top && r.top - 4 < u.bottom) {
          ui.style.right = (W.width - (r.left + sx) + 8) + "px";
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
      if (!figs.length) skySpawn(START);
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
      var e = extents(f);
      if (x < f.x - e[0] - pad || x > f.x + e[0] + pad || y < f.y - e[1] - pad || y > f.y + pad) return;
      var d = Math.abs(x - f.x) + Math.abs(y - (f.y - e[1] / 2));
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
    if (!f || (f.state !== "walk" && f.state !== "crawl")) return;
    if (f.state === "crawl") { f.crawlLeft = 0; return; }   // a crawler stands up as soon as there's room
    if (Math.random() < 0.5) { f.state = "fall"; f.vy = -170; f.vx = 0; f.dismount = null; f.climbAfter = null; }
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
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    // test hook, only on a local preview
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      window.__dittoFigures = {
        figs: function () { return figs; }, world: function () { return W; }, cap: CAP,
        skySpawn: skySpawn, setSpeed: function (k) { timeScale = k; }, hitsBox: hitsBox, extents: extents,
        setGrabChance: function (p) { GRAB_CHANCE = p; }
      };
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
