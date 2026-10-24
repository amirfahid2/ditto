/* Ditto stick figures — a decorative layer that never gets in the way.
 *
 * Tiny walkers step out of a glowing door at the top left, walk down a ramp and drop
 * onto the title. They live in the gaps, margins and background, stand only on the
 * outer top edges of boxes (the real rounded shapes, not their bounding boxes), grab
 * rounded corners as they fall, pull themselves up, crawl under low ceilings, climb
 * ladders beside the board and leave through one glowing EXIT door at the bottom right.
 * The doors are the controls: the blue entrance is shut by default; a click opens it (and
 * the exit) and they start coming out; while open, each click lets one more out. A click on
 * the exit shuts it and the entrance with it, and they all go.
 * Every page load starts with the door shut.
 * When a crowd keeps doubling in one spot (15 poofs at the cap within 10 s), the 30 most
 * crowded figures go poof at once.
 * The canvas has pointer-events: none; clicks on figures are read with a passive document
 * listener that never calls preventDefault.
 *
 * <script src="figures.js" defer data-boxes=".sq, .wordmark" data-sky=".wordmark"></script>
 *   data-boxes        boxes figures must never enter; their top edges are platforms
 *   data-grab         boxes whose corners can be grabbed while falling (default ".sq")
 *   data-board        boxes that make up the board; ladders reach its top row (default ".sq")
 *   data-text-tops    text boxes whose platform is the top of the letters, not the line box
 *   data-sky          where arrivals are dropped off (the ramp ends above it)
 *   data-ignore       extra selector whose clicks the figures ignore (e.g. ".scrim, .sheet")
 *   data-cap          population cap (default 50; 25 on phones)
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var ds = (script && script.dataset) || {};
  var BOX_SELECTOR = ds.boxes || ".sq";
  var GRAB_SELECTOR = ds.grab || ".sq";
  var BOARD_SELECTOR = ds.board || ".sq";
  var TEXT_TOPS = ds.textTops || "";
  var IGNORE = "a, button, input, select, textarea, label, summary, [role=button], [contenteditable], .sf-ui" +
    (ds.ignore ? ", " + ds.ignore : "");
  var TEXT_SELECTOR = "p, h1, h2, h3, h4, li, a, label, button, .wordmark";
  var STORE_KEY = "ditto.figures";
  var STATS_KEY = "ditto.figures.stats";   // the tally over the exit door, kept in this browser

  var H = 14.6, HALF_W = 3;      // standing: feet to top of head, half the body width
  var HC = 8.4, HALF_WC = 5;     // crawling on hands and knees
  var SHOULDER = 10.4;           // feet to shoulders
  var ROLL_G = 160;              // sliding down a rounded corner
  var SPIN_MAX = 70 * Math.PI / 180, SPIN_MIN_V = 1.1, SPIN_MAX_V = 2.2;   // tumbling in a long fall (rad, rad/s)
  var HALF_WH = 2;               // hanging from a corner: legs together, close to the box
  var GRAVITY = 700, CLIMB = 26, WALK_MIN = 15, WALK_MAX = 24, CRAWL_MIN = 8, CRAWL_MAX = 12;
  var START = 2, COOLDOWN = 2000, EXIT_CHANCE = 0.3, GRAB_CHANCE = 0.35;
  var STALL_MS = 10000, ARRIVAL_GAP_MS = 900;   // the door: one more only if the count hasn't grown in 10 s
  var CRUSH_POOFS = 15, CRUSH_MS = 10000, CRUSH_NEAR = 40;   // breaking up a crowd
  // a phone (by its screen, so a narrow window on a computer still gets the full cast)
  var SMALL = Math.min(screen.width || 9999, screen.height || 9999) < 500;
  // (a handful on a phone must never hit the cap: at 5, three or four out kept poofing)
  var CAP = SMALL ? 25 : (parseInt(ds.cap, 10) || 50);
  var CRUSH_CLEAR = Math.round(CAP * 0.6);   // 30 of 50
  // The first easter egg: after 200 Dittos have come out, little dogs start coming through the door
  // too (1 to 20 s apart, and one for every 10 door clicks). They chase Dittos and look for the exit.
  var DOG_UNLOCK = 200, DOG_GAP_MIN = 1000, DOG_GAP_MAX = 20000, DOG_CLICKS = 10;
  var DOG_HW = 4.8, DOG_H = 9.2, DOG_MIN = 34, DOG_MAX = 44, DOG_CAP = SMALL ? 6 : 12;
  var DOG_LONG = 1.5, DOG_SPRINT = 1.5;   // a box wider than 1.5 squares: run 1.5 times as fast, leap far off it
  var DOG_MEET_MS = 600;                   // a newborn puppy can't make another one straight away
  // The second easter egg: after 1000 Dittos, 1 in 50 that come through the door wears a tall striped
  // hat. A hat makes a Ditto 6 px taller, and it can't be doubled or go poof (it can still leave).
  var HAT_UNLOCK = 1000, HAT_CHANCE = 1 / 50, HAT_H = 6;

  var W = { width: 0, height: 0, ground: 0, boxes: [], ladders: [], door: null, entry: null };
  var figs = [], effects = [];
  var enabled = false, dirty = true, raf = 0, last = 0, nextId = 1;
  var pending = 0, lastArrival = 0, lastRelease = 0, history = [], poofTimes = [];
  var pendingDogs = 0, nextDogAt = 0, doorClicks = 0;
  var colors = { ink: "#16262E", muted: "#64808B", accent: "#0E7C86", card: "#FFFFFF" };
  var stats = { released: 0, exited: 0, giants: 0, dogsExited: 0, eggs: {} };   // giants: not built yet, so always 0
  var notes = [], dogSoon = false;               // "Easter egg unlocked" notes, one after another; the first dog right after
  var canvas, ctx, ui, entryBtn, exitBtn, dpr = 1, cw = 0, ch = 0, timeScale = 1;
  var entryOpen = false, exitOpen = false, entryK = 0, exitK = 0, sceneK = 0;   // the doors: shut by default
  var dbg = null;                // jump/relocation log, only on a local preview

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ease(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }

  /* ---------------- terrain ---------------- */

  function docRect(el) {
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if ((cs.animationName && cs.animationName !== "none") || cs.transform !== "none") {
      // wiggling or scaled (Arrange mode, a pressed square): the untransformed box plus a margin
      var x = 0, y = 0, n = el, pad = 1;
      while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      return { l: x - pad, t: y - pad, r: x + el.offsetWidth + pad, b: y + el.offsetHeight + pad };
    }
    return { l: r.left + window.scrollX, t: r.top + window.scrollY, r: r.right + window.scrollX, b: r.bottom + window.scrollY };
  }

  // In normal flow the offsetParent chain ends at <body>; inside a fixed overlay (a bottom
  // sheet waiting off-screen) it ends at that overlay instead.
  function inFlow(el) {
    var n = el, top = el;
    while (n) { top = n; n = n.offsetParent; }
    return top === document.body || top === document.documentElement;
  }

  function radius(value, w, h) {
    var v = parseFloat(value) || 0;
    if (/%/.test(value)) v = v / 100 * Math.min(w, h);
    return clamp(v, 0, Math.min(w, h) / 2);
  }

  // A box's identity across re-renders: the app rebuilds its squares, so use their slot.
  function anchorKey(el) {
    var d = el.dataset || {};
    if (d.index !== undefined) return "i" + d.index;
    if (d.item !== undefined) return "f" + d.folder + ":" + d.item;
    // no slot number (the "Add square" tile, the open folder panel): its own stable classes plus
    // which one of its kind it is, so the key survives re-renders and Arrange mode
    var kind = stableClasses(el), parent = el.parentElement;
    if (!parent || !kind) return el;
    var same = 0;
    for (var c = parent.firstElementChild; c && c !== el; c = c.nextElementSibling) if (stableClasses(c) === kind) same++;
    return "c:" + kind + "#" + same;
  }

  var TRANSIENT = /^(flash|drag-src|drop-into|drop-before|selected|dragging|arranging|on)$/;
  function stableClasses(el) {
    return Array.prototype.filter.call(el.classList, function (c) { return !TRANSIENT.test(c); }).join(".");
  }

  function makeBox(el) {
    var b = docRect(el), cs = getComputedStyle(el), w = b.r - b.l, h = b.b - b.t;
    b.el = el;
    b.key = anchorKey(el);
    b.rtl = radius(cs.borderTopLeftRadius, w, h);
    b.rtr = radius(cs.borderTopRightRadius, w, h);
    b.rbl = radius(cs.borderBottomLeftRadius, w, h);
    b.rbr = radius(cs.borderBottomRightRadius, w, h);
    if (TEXT_TOPS && el.matches(TEXT_TOPS)) {
      // stand on the letters, not on the empty top of the line box
      var fs = parseFloat(cs.fontSize) || 16, lh = parseFloat(cs.lineHeight) || fs * 1.2;
      b.t += Math.max(0, (Math.min(lh, h) - fs * 0.72) / 2);
    }
    // the flat part of the top edge: past a rounded corner the top curves away
    b.sl = b.l + 0.6 * b.rtl;
    b.sr = b.r - 0.6 * b.rtr;
    b.grab = el.matches(GRAB_SELECTOR);
    b.board = el.matches(BOARD_SELECTOR);
    return b;
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
      if (!inFlow(el) || getComputedStyle(el).position === "fixed") continue;
      W.boxes.push(makeBox(el));
    }
    var heights = W.boxes.filter(function (b) { return b.board; }).map(function (b) { return b.b - b.t; }).sort(function (a, b) { return a - b; });
    W.squareH = heights.length ? heights[heights.length >> 1] : 100;
    var widths = W.boxes.filter(function (b) { return b.board; }).map(function (b) { return b.r - b.l; }).sort(function (a, b) { return a - b; });
    W.squareW = widths.length ? widths[widths.length >> 1] : 100;
    rideAlong();
    buildEntry();
    buildLadders();
    buildDoor();
    placeStats();
    // ladders are rebuilt on every layout change: keep climbers on the one at the same spot
    figs.forEach(function (f) {
      if (f.ladder) f.ladder = sameLadder(f.ladder);
      if (f.goal && f.goal.ladder) f.goal = sameLadder(f.goal.ladder) ? { ladder: sameLadder(f.goal.ladder) } : null;
      if (f.climbAfter) f.climbAfter = sameLadder(f.climbAfter);
    });
    readColors();
    placeDoors();
    dirty = false;
  }

  // Does the rectangle (l, t, r, bot) overlap the visible inside of box b? The area outside a
  // rounded corner's curve is empty space, and standing exactly on the top edge is fine.
  function boxHit(b, l, t, r, bot) {
    if (!(r > b.l && l < b.r && bot > b.t + 0.5 && t < b.b)) return false;
    var dx, dy;
    if (b.rtl > 1 && r <= b.l + b.rtl && bot <= b.t + b.rtl) {
      dx = b.l + b.rtl - r; dy = b.t + b.rtl - bot; return dx * dx + dy * dy < (b.rtl - 0.5) * (b.rtl - 0.5);
    }
    if (b.rtr > 1 && l >= b.r - b.rtr && bot <= b.t + b.rtr) {
      dx = l - (b.r - b.rtr); dy = b.t + b.rtr - bot; return dx * dx + dy * dy < (b.rtr - 0.5) * (b.rtr - 0.5);
    }
    if (b.rbl > 1 && r <= b.l + b.rbl && t >= b.b - b.rbl) {
      dx = b.l + b.rbl - r; dy = t - (b.b - b.rbl); return dx * dx + dy * dy < (b.rbl - 0.5) * (b.rbl - 0.5);
    }
    if (b.rbr > 1 && l >= b.r - b.rbr && t >= b.b - b.rbr) {
      dx = l - (b.r - b.rbr); dy = t - (b.b - b.rbr); return dx * dx + dy * dy < (b.rbr - 0.5) * (b.rbr - 0.5);
    }
    return true;
  }

  function boxByKey(key) {
    for (var i = 0; i < W.boxes.length; i++) if (W.boxes[i].key === key) return W.boxes[i];
    return null;
  }

  // After a layout change, figures standing, crawling or hanging on a box move with it.
  function rideAlong() {
    figs.forEach(function (f) {
      if (f.state === "slip" && f.slipG) {
        var S = f.slipG, sb = boxByKey(S.key);
        if (!sb) return;
        var sdx = (S.dir > 0 ? sb.r : sb.l) - S.edge, sdy = sb.t - S.t;
        S.edge += sdx; S.t += sdy; S.to += sdx; f.x += sdx; f.y += sdy;
        return;
      }
      if (f.grab && f.grab.key !== undefined) {
        var g = f.grab, nb = boxByKey(g.key);
        if (!nb) return;
        var dx = nb.l - g.l, dy = nb.t - g.t;
        if (!dx && !dy) return;
        g.l += dx; g.r = nb.r; g.t += dy; g.px += dx; g.py += dy; g.hx += dx; g.hy += dy; g.topX += dx;
        f.x += dx; f.y += dy;
        return;
      }
      if (f.onGround) { f.y = W.ground; return; }
      if (f.onKey === null || f.onKey === undefined) return;
      var b = boxByKey(f.onKey);
      if (!b) { f.onKey = null; return; }
      var mx = b.l - f.onL, my = b.t - f.onT;
      if (mx || my) {
        f.x += mx; f.y += my;
        if (f.dismount !== null) f.dismount += mx;
      }
      f.onL = b.l; f.onT = b.t;
    });
  }

  function hitsBox(x, y, hw, h) {
    hw = hw || HALF_W; h = h || H;
    for (var i = 0; i < W.boxes.length; i++) {
      if (boxHit(W.boxes[i], x - hw, y - h, x + hw, y)) return W.boxes[i];
    }
    return null;
  }

  // The size of a character standing up: a dog, a Ditto, or a Ditto in a hat.
  function standExtents(f) {
    if (f.dog) return [DOG_HW, DOG_H];
    return [HALF_W, f.hat ? H + HAT_H : H];
  }

  function bodyHits(f, x, y) {
    var e = standExtents(f);
    return hitsBox(x, y, e[0], e[1]);
  }

  function extents(f) {
    if (f.dog || f.hat) return standExtents(f);     // hats never crawl, hang or pull up
    if (f.state === "crawl" || f.state === "pull") return [HALF_WC, HC];
    if (f.state === "hang") return [HALF_WH, H];
    if ((f.state === "fall" || f.state === "slip") && f.lowSlip) return [HALF_WC, HC];   // still crouched, sliding off a low ledge
    return [HALF_W, H];
  }

  function platformUnder(x, y) {
    for (var i = 0; i < W.boxes.length; i++) {
      var b = W.boxes[i];
      if (Math.abs(b.t - y) < 0.75 && x >= b.sl && x <= b.sr) return b;
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

  function textRects(except) {
    var out = [], els = document.querySelectorAll(TEXT_SELECTOR);
    for (var i = 0; i < els.length; i++) {
      if (ui && ui.contains(els[i])) continue;
      if (except && (els[i] === except || except.contains(els[i]))) continue;
      if (!inFlow(els[i])) continue;
      var r = els[i].getBoundingClientRect();
      if (r.width && r.height) out.push(docRect(els[i]));
    }
    return out;
  }

  function boxFor(el) {
    for (var i = 0; i < W.boxes.length; i++) if (W.boxes[i].el === el) return W.boxes[i];
    return null;
  }

  function sameLadder(old) {
    if (!old) return null;
    for (var i = 0; i < W.ladders.length; i++) {
      var L = W.ladders[i];
      if (Math.abs(L.x - old.x) < 3 && Math.abs(L.top - old.top) < 6) return L;
    }
    return null;
  }

  // The way in: a glowing door in the top-left corner and a ramp that ends just above the title.
  function buildEntry() {
    W.entry = null;
    var anchor = ds.sky && document.querySelector(ds.sky);
    var a = anchor && (boxFor(anchor) || docRect(anchor));
    if (!a) return;
    var doorBottom = 15;
    var doorX = Math.max(8, a.l - 56);
    var endX = a.l + 7, endY = Math.max(doorBottom + 1, a.t - 3);
    if (endX - doorX < 8) return;
    var texts = textRects(anchor);
    var others = W.boxes.filter(function (b) { return b.el !== anchor; });
    if (!regionClear(doorX - 6, 0, endX + 4, endY - 0.5, others) || !regionClear(doorX - 6, 0, endX - 4, endY - 0.5, texts)) return;
    W.entry = { x: doorX, y: doorBottom, endX: endX, endY: endY };
  }

  // Ladders reach the top row of the board: one up each side from the ground (so a figure at
  // the bottom can always get back up), plus one in any vertical gap of 20 px or more.
  function buildLadders() {
    W.ladders = [];
    var board = W.boxes.filter(function (b) { return b.board; });
    if (!board.length) return;
    var texts = textRects();
    function addLadder(x, top, bottom, exitBox, exitDir) {
      if (x < 6 || x > W.width - 6 || bottom - top < H * 2) return;
      if (!regionClear(x - 5, top - H, x + 5, bottom - 0.5, W.boxes)) return;
      if (!regionClear(x - 4.5, top - 4, x + 4.5, bottom - 0.5, texts)) return;
      for (var i = 0; i < W.ladders.length; i++) {
        var o = W.ladders[i];
        if (Math.abs(o.x - x) < 12 && bottom > o.top && top < o.bottom) return;   // conflicts with an existing ladder
      }
      // step off the top onto the flat part of that square
      var exitX = exitDir > 0 ? exitBox.sl + 5 : exitBox.sr - 5;
      W.ladders.push({ x: x, top: top, bottom: bottom, exitX: exitX, exitDir: exitDir });
    }
    var topRow = Math.min.apply(null, board.map(function (b) { return b.t; }));
    var row = board.filter(function (b) { return Math.abs(b.t - topRow) < 3; });
    var first = row.reduce(function (m, b) { return b.l < m.l ? b : m; });
    var lastBox = row.reduce(function (m, b) { return b.r > m.r ? b : m; });
    var minL = Infinity, maxR = -Infinity;
    W.boxes.forEach(function (b) { if (b.b > topRow - 40) { minL = Math.min(minL, b.l); maxR = Math.max(maxR, b.r); } });
    var leftX = Math.max(minL - 12, 8), rightX = Math.min(maxR + 12, W.width - 8);
    if (leftX + 4.5 < minL - 1) addLadder(leftX, topRow, W.ground, first, 1);
    if (rightX - 4.5 > maxR + 1) addLadder(rightX, topRow, W.ground, lastBox, -1);
    board.forEach(function (a) {
      var right = null;
      board.forEach(function (b) {
        if (b === a || Math.abs(b.t - a.t) > 3 || b.l < a.r) return;
        if (!right || b.l < right.l) right = b;
      });
      if (!right || right.l - a.r < 20) return;
      addLadder((a.r + right.l) / 2, Math.min(a.t, right.t), W.ground, right, 1);
    });
  }

  // The single exit: a glowing door on the ground in the bottom-right corner.
  function buildDoor() {
    W.door = null;
    // keep clear of the right edge, where a floating scrollbar takes the clicks
    var texts = textRects(), x = W.width - 23;
    for (var tries = 0; tries < 20; tries++, x -= 4) {
      var clash = W.ladders.some(function (L) { return Math.abs(L.x - x) < 8 && L.bottom > W.ground - 20; });
      if (clash) continue;
      if (regionClear(x - 6, W.ground - 22, x + 6, W.ground, W.boxes) && regionClear(x - 6, W.ground - 22, x + 6, W.ground, texts)) {
        W.door = { x: x, y: W.ground };
        return;
      }
    }
  }

  // The tally sits right above the exit door's sign; when something is in the way, beside the
  // door, else higher up the right side. Checked against the words themselves, not whole
  // paragraph boxes (a short footer line leaves the rest of its row free).
  function placeStats() {
    W.stats = null;
    var D = W.door;
    if (!D) return;
    var size = statsSize(), lines = textLines(), pad = 4;
    var spots = [{ r: D.x + 7, b: D.y - 24 }, { r: D.x - 10, b: D.y - 1 }];
    for (var b = D.y - 30; b > D.y - 240; b -= 6) spots.push({ r: D.x + 7, b: b });
    for (var i = 0; i < spots.length; i++) {
      var S = spots[i], l = Math.max(4, S.r - size.w) - pad, t = S.b - size.h - pad;
      if (regionClear(l, t, S.r + pad, S.b + pad, W.boxes) && regionClear(l, t, S.r + pad, S.b + pad, lines)) { W.stats = S; return; }
    }
    W.stats = spots[0];
  }

  function textLines() {
    var out = [], els = document.querySelectorAll(TEXT_SELECTOR), range = document.createRange();
    for (var i = 0; i < els.length; i++) {
      if ((ui && ui.contains(els[i])) || !inFlow(els[i])) continue;
      range.selectNodeContents(els[i]);
      var rs = range.getClientRects();
      for (var j = 0; j < rs.length; j++) {
        if (rs[j].width && rs[j].height) out.push({ l: rs[j].left + window.scrollX, t: rs[j].top + window.scrollY, r: rs[j].right + window.scrollX, b: rs[j].bottom + window.scrollY });
      }
    }
    return out;
  }

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    colors.ink = (cs.getPropertyValue("--ink") || "").trim() || colors.ink;
    colors.muted = (cs.getPropertyValue("--muted") || "").trim() || colors.muted;
    colors.accent = (cs.getPropertyValue("--accent") || "").trim() || colors.accent;
    colors.card = (cs.getPropertyValue("--card") || "").trim() || colors.card;
  }

  /* ---------------- figures ---------------- */

  function makeFig(x, y) {
    var f = {
      id: nextId++, x: x, y: y, dir: Math.random() < 0.5 ? -1 : 1, speed: rand(WALK_MIN, WALK_MAX),
      crawlSpeed: rand(CRAWL_MIN, CRAWL_MAX), state: "walk", vx: 0, vy: 0, phase: rand(0, 6),
      born: performance.now(), lastHit: -1e9, wave: 0, bounce: 0, squash: 0, goal: null, dismount: null,
      climbAfter: null, ladder: null, grab: null, clearTo: null, crawlLeft: 0, tried: {},
      alpha: 1, scale: 1, dead: false, tilt: 0, spin: 0, spinV: 0, fallTop: null
    };
    figs.push(f);
    return f;
  }

  // The tally: every figure that comes through the top door, every one that leaves by the exit.
  // It lives in this browser's storage, so it survives reloads until the site data is cleared.
  function loadStats() {
    try {
      var saved = JSON.parse(localStorage.getItem(STATS_KEY) || "null");
      if (saved) {
        stats.released = +saved.released || 0; stats.exited = +saved.exited || 0;
        stats.giants = +saved.giants || 0; stats.dogsExited = +saved.dogsExited || 0;
        stats.eggs = saved.eggs && typeof saved.eggs === "object" ? saved.eggs : {};
      }
    } catch (e) {}
    checkEggs();            // a goal reached before this egg existed counts right away
  }

  function saveStats() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
  }

  // Easter eggs unlock from the saved tally, so anyone already past a goal when an egg is added
  // gets it at once. Each egg reads every counter that shows the goal was met: the dogs need 200
  // Dittos, through the door or out of the exit (doubled Dittos leave too, so exits can run ahead).
  var EGGS = [
    { id: "dogs", title: "Ditto dogs", reached: function () { return stats.released >= DOG_UNLOCK || stats.exited >= DOG_UNLOCK; } },
    { id: "hats", title: "Ditto hats", reached: function () { return stats.released >= HAT_UNLOCK || stats.exited >= HAT_UNLOCK; } },
  ];
  function checkEggs() {
    EGGS.forEach(function (egg) {
      if (stats.eggs[egg.id] || !egg.reached()) return;
      stats.eggs[egg.id] = new Date().toISOString().slice(0, 10);
      saveStats();
      dirty = true;                                 // the tally gets a row: place it again
      notes.push({ text: "Easter egg unlocked: " + egg.title + "!", t: 0 });   // shown the next time the doors are open
      if (egg.id === "dogs") { dogSoon = true; nextDogAt = 0; }
    });
  }

  function count(key) {
    stats[key]++;
    if (String(stats[key]).length > String(stats[key] - 1).length) dirty = true;   // a digit wider: place it again
    saveStats();
    checkEggs();
  }

  function people() { return figs.filter(function (f) { return !f.dead && !f.dog; }); }
  function dogs() { return figs.filter(function (f) { return !f.dead && f.dog; }); }
  function dogsUnlocked() { return !!stats.eggs.dogs; }

  // New figures come in through the door, one at a time.
  function arrive(n) {
    pending = Math.min(pending + n, Math.max(0, CAP - people().length));
  }

  function arriveDog() {
    if (dogs().length + pendingDogs < DOG_CAP) pendingDogs++;
  }

  function admitOne(now) {
    lastArrival = now;
    var dog = pendingDogs > 0 && (pending <= 0 || Math.random() < 0.5);
    if (dog) pendingDogs--; else { pending--; count("released"); }
    if (!W.entry) {                                   // no room for the door: drop from just above the title
      var anchor = ds.sky && document.querySelector(ds.sky);
      var a = anchor ? docRect(anchor) : (W.boxes[0] || { l: W.width / 2 - 20, r: W.width / 2 + 20 });
      var s = makeFig(rand(a.l + 4, Math.max(a.l + 5, a.r - 4)), -rand(20, 50));
      s.state = "fall";
      if (dog) makeDog(s); else if (stats.eggs.hats && Math.random() < HAT_CHANCE) s.hat = true;
      return;
    }
    var f = makeFig(W.entry.x, W.entry.y);
    f.state = "enter"; f.enterT = 0; f.dir = 1; f.alpha = 0; f.scale = 0.2;
    if (dog) makeDog(f); else if (stats.eggs.hats && Math.random() < HAT_CHANCE) f.hat = true;
  }

  function makeDog(f) {
    f.dog = true;
    f.speed = rand(DOG_MIN, DOG_MAX);
    f.wag = 0; f.bark = 0; f.chase = null; f.chaseT = 0; f.toExit = false;
    return f;
  }

  function onGround(f) { return Math.abs(f.y - W.ground) < 0.75; }

  // The page edges are walls, but only for going further out: something that ended up closer
  // to the edge (a long leap, a resize) can always walk back in.
  function pastEdge(nx, dir, margin) {
    return (dir < 0 && nx < margin) || (dir > 0 && nx > W.width - margin);
  }

  // Somewhere to head for on the ground: a ladder up, or the exit, but only one that lies ahead.
  // A walker keeps going the way it's facing and turns only at a wall, an edge or a bump (with
  // nothing ahead it walks on to the page edge, turns there, and picks again).
  function chooseGoal(f) {
    function ahead(x) { return (x - f.x) * f.dir >= 0; }
    var ladders = W.ladders.filter(function (L) { return Math.abs(L.bottom - W.ground) < 2 && ahead(L.x); });
    var exitAhead = W.door && exitOpen && ahead(W.door.x);
    if (exitAhead && (Math.random() < EXIT_CHANCE || !ladders.length)) return { exit: true };
    if (!ladders.length) return { wander: true };
    var best = ladders[0];
    ladders.forEach(function (L) { if (Math.abs(L.x - f.x) < Math.abs(best.x - f.x)) best = L; });
    return { ladder: best };
  }

  function touchDown(f, vy) {
    if (f.dog && f.toExit && W.door) { f.state = "exit"; f.exitT = 0; f.door = W.door; f.vx = 0; f.vy = 0; return; }   // the hop into the door
    f.state = "walk"; f.vx = 0; f.vy = 0; f.goal = null; f.tried = {}; f.clearTo = null; f.slip = false; f.lowSlip = false; f.tilt = 0;
    f.spin = 0; f.spinV = 0; f.fallTop = null;
    if (vy > 140) f.squash = 0.22;
  }

  function startCrawl(f, distance) {
    f.state = "crawl";
    f.crawlLeft = distance;
  }

  function boxKey(b) { return Math.round(b.l) + ":" + Math.round(b.t); }

  // Where would a figure dropping straight down at x from y end up? null if onto a box
  // with no room even to crawl.
  function dropTarget(x, y, f) {
    var land = null, stands = function (yy) { return f ? !bodyHits(f, x, yy) : !hitsBox(x, yy); };
    W.boxes.forEach(function (b) {
      if (x + HALF_W > b.l && x - HALF_W < b.r && b.t >= y && (!land || b.t < land.t)) land = b;
    });
    if (!land || land.t > W.ground) return stands(W.ground) ? W.ground : null;
    if (x < land.sl || x > land.sr) return W.ground;   // beside its rounded corner: slides past it
    var crouch = !(f && f.hat) && !hitsBox(x, land.t, HALF_WC, HC);
    return stands(land.t) || crouch ? land.t : null;
  }

  // A drop at x would clip the rounded corner of a box below: move outside it (in the
  // walking direction) or onto its flat top instead.
  function clearDrop(x, y, dir) {
    for (var i = 0; i < W.boxes.length; i++) {
      var b = W.boxes[i];
      if (b.t < y + 1 || x + HALF_W <= b.l || x - HALF_W >= b.r) continue;
      if (x >= b.sl && x <= b.sr) continue;
      if (x < b.sl) x = dir < 0 ? b.l - HALF_W - 0.5 : b.sl;
      else x = dir > 0 ? b.r + HALF_W + 0.5 : b.sr;
    }
    return x;
  }

  // At the end of a ledge: jump across to the next box, slip off close to this box's side
  // (and maybe catch the one below it), or slip further across the gap to hug the next box.
  function stepOffEdge(f, p, crawling) {
    var edge = f.dir > 0 ? p.r : p.l;
    if (!crawling) {
      // a ladder whose foot is at this height just past the edge: walk onto it and climb
      for (var i = 0; i < W.ladders.length; i++) {
        var L = W.ladders[i], reach = f.dir > 0 ? L.x - edge : edge - L.x;
        if (Math.abs(L.bottom - f.y) < 2 && reach >= 0 && reach <= 16 && p.rtl < 2 && p.rtr < 2) {
          f.dismount = L.x; f.climbAfter = L;
          return;
        }
      }
    }
    var neighbour = null, gap = 0;
    W.boxes.forEach(function (b) {
      if (b === p || Math.abs(b.t - p.t) > 2) return;
      var g = f.dir > 0 ? b.l - p.r : p.l - b.r;
      if (g >= 0 && g <= 18 && (!neighbour || g < gap)) { neighbour = b; gap = g; }
    });
    var options = [];
    var landX = neighbour ? (f.dir > 0 ? neighbour.sl + 3 : neighbour.sr - 3) : 0;
    if (!crawling && neighbour && !bodyHits(f, landX, neighbour.t)) options.push("jump");
    var nearX = clearDrop(edge + f.dir * (HALF_W + 0.5), f.y, f.dir);
    if (!bodyHits(f, nearX, f.y + 1) && dropTarget(nearX, f.y, f) !== null) options.push("near");
    var farX = null;
    if (neighbour && gap >= 2 * HALF_W + 1.5) {
      farX = (f.dir > 0 ? neighbour.l : neighbour.r) - f.dir * (HALF_W + 0.5);
      if (!bodyHits(f, farX, f.y + 1) && dropTarget(farX, f.y, f) !== null) options.push("far");
    }
    if (!options.length) { f.dir = -f.dir; return; }
    var pick = options[Math.floor(Math.random() * options.length)];
    f.tried[boxKey(p)] = true;
    f.state = "fall";
    f.lowSlip = crawling && pick !== "jump";
    if (pick === "jump") {
      // over the gap and both rounded corners to the flat top of the next box
      var T = 2 * 105 / GRAVITY;
      f.vy = -105; f.vx = (landX - f.x) / T; f.clearTo = null; f.slip = false;
      return;
    }
    // slip: slide down the rounded corner, then drop beside this box (near) or drift across to the next (far)
    f.state = "slip"; f.vy = 0; f.vx = 0; f.clearTo = null; f.slip = true;
    var S = f.slipG = { key: p.key, edge: edge, t: p.t, r: f.dir > 0 ? p.rtr : p.rtl, dir: f.dir, to: pick === "near" ? nearX : farX };
    if (crawling && S.r >= 6) {
      // on hands and knees: tip forward over the curve and slide down it
      var th0 = Math.asin(clamp((f.x - (edge - f.dir * S.r)) * f.dir / (S.r + 5.1), 0, 1));
      if (curveClear(edge, p.t, S.r, f.dir, f.dir, th0, Math.PI / 2)) { S.roll = true; S.th = th0; S.w = f.crawlSpeed / S.r; }
    }
  }

  // A crawler on a rounded corner: hands and knees on the curve at angle th (0 = the top,
  // 90 degrees = the side), the body tilted to match. side -1 = the box's left corner, +1 = its right.
  function onCurve(f, edge, t, r, side, th) {
    var lift = r + 5.1;                                   // curve to the middle of the body
    f.x = edge - side * r + lift * side * Math.sin(th);
    f.y = t + r - lift * Math.cos(th) + 4.5;
    f.tilt = f.dir === side ? th : -th;                   // nose down going over, nose up coming up
  }

  // Where the crawler's lines are drawn (hands, knees, back, head), for checking against boxes.
  function crawlerPoints(x, y, dir, tilt) {
    var c = Math.cos(tilt), s = Math.sin(tilt), out = [];
    [[-5.9, -0.4], [-3.3, -0.4], [-3.9, 0], [-1.3, 0], [-3.2, -4.2], [-0.4, -4.7], [2.4, -5.2], [1.7, 0], [4.3, 0],
     [3.9, -8.4], [5.7, -6.6], [3.9, -4.8], [2.1, -6.6]].forEach(function (q) {
      var lx = q[0], ly = q[1] + 4.5;                     // about the middle of the body
      out.push([x + dir * (lx * c - ly * s), y - 4.5 + lx * s + ly * c]);
    });
    return out;
  }

  // Is the whole way over (or up) a rounded corner, from angle a to b, clear of every box?
  function curveClear(edge, t, r, side, dir, a, b) {
    var probe = { dir: dir };
    for (var i = 0; i <= 6; i++) {
      onCurve(probe, edge, t, r, side, a + (b - a) * i / 6);
      var pts = crawlerPoints(probe.x, probe.y, dir, probe.tilt);
      for (var j = 0; j < pts.length; j++) if (hitsBox(pts[j][0], pts[j][1] + 0.6, 0.6, 1.2)) return false;
    }
    return true;
  }

  // Following the curve of the corner: the body just touches it until it's clear of the box.
  function slipStep(f, dt) {
    var S = f.slipG, e = extents(f);
    if (S.roll) { rollStep(f, S, dt); return; }
    f.x += S.dir * 70 * dt;
    var inner = S.dir > 0 ? f.x - e[0] : f.x + e[0];
    if (S.dir > 0 ? inner >= S.edge : inner <= S.edge) {
      f.state = "fall"; f.vy = 90; f.lowSlip = false; f.slipG = null;
      if (Math.abs(S.to - f.x) > 1) { f.vx = S.dir * 80; f.clearTo = S.to; }
      return;
    }
    var into = S.dir > 0 ? inner - (S.edge - S.r) : (S.edge + S.r) - inner;
    f.y = (S.r < 1.5 || into <= 0) ? S.t : S.t + S.r - Math.sqrt(Math.max(0, S.r * S.r - into * into)) - 0.6;
  }

  // Going over a rounded corner on hands and knees: it slides faster and faster down the curve,
  // then drops off beside the box (near) or drifts across to the next one (far), straightening out.
  function rollStep(f, S, dt) {
    S.w += ROLL_G * Math.sin(S.th) / S.r * dt;
    S.th = Math.min(Math.PI / 2, S.th + S.w * dt);
    onCurve(f, S.edge, S.t, S.r, S.dir, S.th);
    if (S.th < Math.PI / 2) return;
    f.state = "fall"; f.vy = S.w * S.r; f.vx = 0; f.slipG = null;
    if ((S.to - f.x) * S.dir > 1) { f.vx = S.dir * 80; f.clearTo = S.to; }
  }

  function walk(f, dt) {
    if (f.dog) { dogWalk(f, dt); return; }
    if (f.wave > 0) return;
    var step = f.speed * dt;
    if (f.dismount !== null) {
      var d = f.dismount - f.x, s = Math.sign(d) * Math.min(Math.abs(d), step);
      if (bodyHits(f, f.x + s, f.y)) { f.dismount = null; f.climbAfter = null; return; }
      f.x += s; f.dir = Math.sign(d) || f.dir;
      if (Math.abs(f.dismount - f.x) < 0.5) {
        f.dismount = null;
        if (f.climbAfter) { f.x = f.climbAfter.x; f.ladder = f.climbAfter; f.climbAfter = null; f.state = "climb"; }
      }
      return;
    }
    if (onGround(f)) {
      if (f.bounce <= 0) {
        if (!f.goal || (f.goal.ladder && W.ladders.indexOf(f.goal.ladder) < 0) || (f.goal.exit && (!W.door || !exitOpen))) f.goal = chooseGoal(f);
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
      if (W.door && (Math.abs(nx - W.door.x) < 1.5 || (f.x - W.door.x) * (nx - W.door.x) < 0)) {
        if (!exitOpen) { f.dir = -f.dir; f.goal = { wander: true }; f.bounce = 0.8; return; }   // shut: turn around
        f.state = "exit"; f.exitT = 0; f.door = W.door;
        return;
      }
      if (pastEdge(nx, f.dir, 4)) { f.dir = -f.dir; f.goal = null; return; }   // page edge: turn around
      if (bodyHits(f, nx, W.ground)) {
        if (!f.hat && !hitsBox(nx, W.ground, HALF_WC, HC)) { startCrawl(f, 14); return; }
        f.dir = -f.dir; f.goal = { wander: true }; f.bounce = 1;
        return;
      }
      f.x = nx;
      return;
    }
    var p = platformUnder(f.x, f.y);
    if (!p) { f.state = "fall"; f.vy = 0; f.vx = 0; return; }
    var px = f.x + f.dir * step;
    if (px >= p.sl && px <= p.sr) {
      if (bodyHits(f, px, f.y)) {
        // low ceiling: get down and crawl under it, or turn back if even that won't fit (or a hat won't)
        if (!f.hat && !hitsBox(px, f.y, HALF_WC, HC)) startCrawl(f, 10); else f.dir = -f.dir;
        return;
      }
      f.x = px;
      return;
    }
    stepOffEdge(f, p, false);
  }

  // A dog runs straight on, chasing any Ditto ahead of it on its level, and hops into the exit
  // when it gets there. Like every character it turns only when it bumps into someone (or runs
  // into a wall); at the end of a box it hops down beside it, or leaps off a long one.
  function dogWalk(f, dt) {
    if (f.bark > 0) return;                         // stops for a bark, then runs on
    var ground = onGround(f), p = ground ? null : platformUnder(f.x, f.y);
    if (!ground && !p) { f.state = "fall"; f.vy = 0; f.vx = 0; return; }
    f.chaseT -= dt;
    if (f.chaseT <= 0) { f.chase = pickChase(f); f.chaseT = rand(2, 5); }
    var target = f.chase && !f.chase.dead && f.chase.state === "walk" && Math.abs(f.chase.y - f.y) < 2 &&
      (f.chase.x - f.x) * f.dir > 0 ? f.chase : null;
    if (target && Math.abs(target.x - f.x) < 8) { scare(target, f); f.chase = null; f.chaseT = rand(1.5, 3); }
    f.sprint = !!p && p.r - p.l > DOG_LONG * W.squareW;   // a long box: room for a run-up
    f.dash = false;
    if (p) {
      // the run-up: from where it started running this way on this box to the end of its top
      if (f.runKey !== p.key || f.runDir !== f.dir) { f.runKey = p.key; f.runDir = f.dir; f.runFrom = f.x; }
      var runway = ((f.dir > 0 ? p.sr : p.sl) - f.runFrom) * f.dir;
      f.dash = !f.sprint && runway >= 0.5 * (p.sr - p.sl) && !!nextBoxAhead(f, p);   // half a square: enough to jump across
    }
    var nx = f.x + f.dir * f.speed * (f.sprint || f.dash ? DOG_SPRINT : 1) * dt;
    if (ground) {
      if (W.door && (Math.abs(nx - W.door.x) < 2 || (f.x - W.door.x) * (nx - W.door.x) < 0)) {
        if (!exitOpen) { f.dir = -f.dir; return; }
        f.x = W.door.x; f.toExit = true;            // a happy hop, then in through the door
        f.state = "fall"; f.vy = -150; f.vx = 0; f.clearTo = null;
        return;
      }
      if (pastEdge(nx, f.dir, 6) || hitsBox(nx, W.ground, DOG_HW, DOG_H)) { f.dir = -f.dir; f.chase = null; return; }   // a wall: back he comes
      f.x = nx;
      return;
    }
    if (nx >= p.sl && nx <= p.sr) {
      if (hitsBox(nx, f.y, DOG_HW, DOG_H)) { f.dir = -f.dir; return; }
      f.x = nx;
      return;
    }
    dogOffEdge(f, p);
  }

  // The end of a box: with a run-up of half a square and a square ahead, a jump across to it; off a
  // long box, a long leap; otherwise hop down beside it, else jump across anyway, else turn around.
  function dogOffEdge(f, p) {
    var edge = f.dir > 0 ? p.r : p.l, downX = edge + f.dir * (DOG_HW + 0.5);
    var ahead = f.dash && nextBoxAhead(f, p);
    if (ahead) { dogJump(f, p, ahead.x); return; }
    if (f.sprint && !hitsBox(f.x + f.dir * 8, p.t - 8, DOG_HW, DOG_H)) {
      f.state = "fall"; f.vy = -160; f.vx = f.dir * f.speed * DOG_SPRINT * 2.2; f.clearTo = null;   // out it flies
      return;
    }
    if (downX > 5 && downX < W.width - 5 && !hitsBox(downX, p.t + DOG_H + 2, DOG_HW, DOG_H) && dropTarget(downX, p.t) !== null) {
      f.state = "fall"; f.vy = -80; f.vx = f.dir * 70; f.clearTo = downX;   // up and out over the rounded corner
      return;
    }
    var next = nextBoxAhead(f, p);
    if (next) { dogJump(f, p, next.x); return; }
    f.dir = -f.dir;
  }

  // The next box along on the same row, just across the gap, with room for a dog on top.
  function nextBoxAhead(f, p) {
    var next = null;
    W.boxes.forEach(function (b) {
      if (b === p || Math.abs(b.t - p.t) > 2) return;
      var g = f.dir > 0 ? b.l - p.r : p.l - b.r;
      if (g >= 0 && g <= 18 && (!next || g < next.g)) next = { b: b, g: g };
    });
    if (!next) return null;
    var x = f.dir > 0 ? next.b.sl + DOG_HW + 6 : next.b.sr - DOG_HW - 6;
    return hitsBox(x, next.b.t, DOG_HW, DOG_H) ? null : { b: next.b, x: x };
  }

  // A jump from the end of box p to x on the next box's top, kept low enough to stay under
  // anything above (between rows there's only a little headroom).
  function dogJump(f, p, toX) {
    var l = Math.min(f.x, toX) - DOG_HW, r = Math.max(f.x, toX) + DOG_HW, room = 40;
    W.boxes.forEach(function (o) { if (o.b <= p.t + 0.5 && r > o.l && l < o.r) room = Math.min(room, p.t - o.b); });
    var rise = clamp(room - DOG_H - 1, 1.2, 12), vy = Math.sqrt(2 * GRAVITY * rise), T = 2 * vy / GRAVITY;
    f.state = "fall"; f.vy = -vy; f.vx = (toX - f.x) / T; f.clearTo = null;
  }

  // The nearest Ditto ahead on the same level, if it's not too far off.
  function pickChase(f) {
    var best = null, bd = 170;
    figs.forEach(function (g) {
      if (g.dog || g.dead || g.state !== "walk" || Math.abs(g.y - f.y) > 2 || (g.x - f.x) * f.dir <= 0) return;
      var d = Math.abs(g.x - f.x);
      if (d < bd) { bd = d; best = g; }
    });
    return best;
  }

  // Caught up with: the Ditto jumps in fright and runs off ahead of the dog.
  function scare(g, dog) {
    g.dir = dog.dir; g.goal = null; g.bounce = 0.9;
    if (Math.random() < 0.6 && !hitsBox(g.x, g.y - 12)) { g.state = "fall"; g.vy = -150; g.vx = 0; g.clearTo = null; }
  }

  function crawl(f, dt) {
    var step = f.crawlSpeed * dt;
    var nx = f.x + f.dir * step;
    if (onGround(f)) {
      if (pastEdge(nx, f.dir, 6)) { f.dir = -f.dir; return; }
      if (hitsBox(nx, W.ground, HALF_WC, HC)) { f.dir = -f.dir; return; }
      f.x = nx;
    } else {
      var p = platformUnder(f.x, f.y);
      if (!p) { f.state = "fall"; f.vy = 0; f.vx = 0; return; }
      if (nx < p.sl || nx > p.sr) { stepOffEdge(f, p, true); return; }   // crawl off the edge into the gap
      if (hitsBox(nx, f.y, HALF_WC, HC)) { f.dir = -f.dir; return; }
      f.x = nx;
    }
    f.crawlLeft -= step;
    if (f.crawlLeft <= 0 && !hitsBox(f.x, f.y)) f.state = "walk";   // room to stand: up and walking
  }

  // Falling more than two squares' height: the figure starts to tumble, turning one way then the
  // other at random, never past 70 degrees, and never so far that it would touch a box beside it.
  function tumble(f, dt) {
    f.fallTop = f.fallTop == null ? f.y : Math.min(f.fallTop, f.y);
    if (f.lowSlip || f.tilt || f.dog) return;
    if (!f.spinV) {
      if (f.y - f.fallTop < 2 * W.squareH) return;
      f.spinV = (Math.random() < 0.5 ? -1 : 1) * rand(SPIN_MIN_V, SPIN_MAX_V);
    }
    if (Math.random() < 0.6 * dt) f.spinV = -Math.sign(f.spinV) * rand(SPIN_MIN_V, SPIN_MAX_V);   // a random change of spin
    f.spin += f.spinV * dt;
    var room = Math.min(SPIN_MAX, spinRoom(f));
    if (Math.abs(f.spin) >= room) { f.spin = Math.sign(f.spin) * room; f.spinV = -Math.sign(f.spin) * rand(SPIN_MIN_V, SPIN_MAX_V); }
  }

  // How far the figure can turn about the middle of its body before it would reach a box.
  function spinRoom(f) {
    var hh = standExtents(f)[1], mid = f.y - hh / 2, gap = Infinity;
    W.boxes.forEach(function (b) {
      if (b.b < mid - hh / 2 - 4 || b.t > mid + hh / 2 + 4) return;
      if (b.l >= f.x) gap = Math.min(gap, b.l - f.x); else if (b.r <= f.x) gap = Math.min(gap, f.x - b.r);
    });
    gap = Math.min(gap, f.x - 1, W.width - 1 - f.x) - 0.8;
    for (var a = SPIN_MAX; a > 0.02; a -= 0.05) {
      if (HALF_W * Math.cos(a) + (hh / 2) * Math.sin(a) <= gap) return a;   // half the width, turned by a
    }
    return 0;
  }

  function fall(f, dt) {
    f.vy = Math.min(f.vy + GRAVITY * dt, 420);
    tumble(f, dt);
    if (f.tilt) {
      f.tilt = Math.sign(f.tilt) * Math.max(0, Math.abs(f.tilt) - 5 * dt);
      if (!f.tilt && f.lowSlip && f.clearTo === null && !hitsBox(f.x, f.y)) f.lowSlip = false;   // straightened out
    }
    var nx = f.x + f.vx * dt, e = extents(f);
    if (f.clearTo !== null && (f.vx > 0 ? nx >= f.clearTo : nx <= f.clearTo)) { nx = f.clearTo; f.vx = 0; f.clearTo = null; f.lowSlip = false; }
    if (f.vx && (nx < 4 || nx > W.width - 4 || hitsBox(nx, f.y, e[0], e[1]))) { f.vx = 0; nx = f.x; f.clearTo = null; }
    var ny = f.y + f.vy * dt;
    if (f.vy < 0) {
      if (hitsBox(nx, ny, e[0], e[1])) { f.vy = 0; ny = f.y; }       // bonk: never rise into a box
      f.x = nx; f.y = ny;
      return;
    }
    if (f.clearTo === null && !f.dog && !f.hat && tryGrab(f, nx, ny)) return;
    var land = null;
    W.boxes.forEach(function (b) {
      if (nx >= b.sl - 0.5 && nx <= b.sr + 0.5 && b.t >= f.y - 0.01 && b.t <= ny && (!land || b.t < land.t)) land = b;
    });
    if (land && land.t <= W.ground) {
      var lx = clamp(nx, land.sl, land.sr);
      if (!bodyHits(f, lx, land.t)) { f.x = lx; f.y = land.t; touchDown(f, f.vy); return; }
      if (!f.dog && !f.hat && !hitsBox(lx, land.t, HALF_WC, HC)) {          // too low to stand: land crouched and crawl
        f.x = lx; f.y = land.t; touchDown(f, 0); startCrawl(f, 12);
        return;
      }
    }
    if (ny >= W.ground && !hitsBox(nx, W.ground, e[0], e[1])) { f.x = nx; f.y = W.ground; touchDown(f, f.vy); return; }
    var hit = hitsBox(nx, ny, e[0], e[1]);
    if (hit) {
      // brushing a box's side or rounded corner: slide out beside it and keep dropping; anything
      // more than a nudge (a box appeared around the figure) takes the smallest legal move instead
      var sideX = nx < (hit.l + hit.r) / 2 ? hit.l - e[0] - 0.5 : hit.r + e[0] + 0.5;
      if (Math.abs(sideX - nx) > 6) { f.x = nx; f.y = ny; settle(f, true); return; }
      if (dbg && Math.abs(sideX - nx) > 4) dbg.push({ kind: "pushout", id: f.id, prev: f._ps, vx: Math.round(f.vx), clearTo: f.clearTo, from: [Math.round(nx), Math.round(ny)], to: [Math.round(sideX), Math.round(ny)] });
      if (!hitsBox(sideX, ny, e[0], e[1])) { nx = sideX; f.vx = 0; f.clearTo = null; }
      else { settle(f, true); return; }
    }
    f.x = nx; f.y = ny;
  }

  // Where the hands go: on the curve of the rounded top corner, 25 degrees up from the side, in
  // reach of normal-length arms (a square corner is simply the corner). side -1 = the box's left corner, +1 = its right.
  function gripPoint(b, side, rad) {
    var bx = side < 0 ? b.l : b.r;
    if (rad < 1.5) return { x: bx, y: b.t };
    var a = 25 * Math.PI / 180, inset = rad * (1 - Math.cos(a));
    return { x: side < 0 ? bx + inset : bx - inset, y: b.t + rad * (1 - Math.sin(a)) };
  }

  // Falling past the side of a box, the hands sometimes catch its rounded top corner.
  function tryGrab(f, nx, ny) {
    for (var i = 0; i < W.boxes.length; i++) {
      var b = W.boxes[i];
      if (!b.grab) continue;
      var side;
      var gapL = b.l - (nx + HALF_W), gapR = (nx - HALF_W) - b.r;
      if (gapL >= -0.6 && gapL <= 3) side = -1;          // figure is left of the box
      else if (gapR >= -0.6 && gapR <= 3) side = 1;      // figure is right of it
      else continue;
      var rad = side < 0 ? b.rtl : b.rtr;
      if (rad < 6) continue;                              // only rounded corners: the way up is along the curve
      var grip = gripPoint(b, side, rad);
      var shoulderY = grip.y + 2;                         // hands at chin height, arms their normal length
      if (!(f.y - SHOULDER < shoulderY && ny - SHOULDER >= shoulderY)) continue;
      var key = boxKey(b);
      if (f.tried[key]) continue;
      f.tried[key] = true;
      var chance = f.slip ? 0.55 : GRAB_CHANCE;
      f.slip = false;
      if (Math.random() > chance) continue;
      var hx = side < 0 ? b.l - HALF_WH - 0.5 : b.r + HALF_WH + 0.5, hy = shoulderY + SHOULDER;
      var topX = side < 0 ? b.sl + HALF_WC : b.sr - HALF_WC, edge = side < 0 ? b.l : b.r;
      if (b.sr - b.sl < 2 * HALF_WC + 4 || hitsBox(topX, b.t, HALF_WC, HC)) continue;
      if (hitsBox(hx, hy, HALF_WH, H)) continue;
      // then up the curve on hands and knees, starting where the hanging body already is
      var th0 = clamp(Math.atan2((hx - (edge - side * rad)) * side, b.t + rad - (hy - H / 2)), 0.3, 1.45);
      var thTop = Math.asin(clamp((topX - (edge - side * rad)) * side / (rad + 5.1), 0, 1));
      if (!curveClear(edge, b.t, rad, side, -side, th0, thTop)) continue;
      f.state = "hang"; f.x = hx; f.y = hy; f.vx = 0; f.vy = 0; f.tilt = 0; f.spin = 0; f.spinV = 0; f.fallTop = null;
      f.grab = { key: b.key, l: b.l, r: b.r, t: b.t, side: side, rad: rad, px: grip.x, py: grip.y, hx: hx, hy: hy, topX: topX,
        th: th0, thTop: thTop, time: 0, hold: rand(0.25, 0.45) };
      return true;
    }
    return false;
  }

  function grabStillValid(f) {
    var g = f.grab, b = g && boxByKey(g.key);
    return !!b && Math.abs(b.t - g.t) < 1 && Math.abs((g.side < 0 ? b.l : b.r) - (g.side < 0 ? g.l : g.r)) < 1;
  }

  function lostGrip(f, where) {
    if (dbg) {
      var g = f.grab, b = g && boxByKey(g.key);
      dbg.push({ kind: "griplost", id: f.id, where: where, key: g && String(g.key),
        box: !!b, dt: b ? [Math.round(b.t - g.t), Math.round((g.side < 0 ? b.l : b.r) - (g.side < 0 ? g.l : g.r))] : null });
    }
    f.state = "fall"; f.vy = 0; f.grab = null;
    if (f.tilt) f.lowSlip = true;                 // was crawling up the curve: falls crouched
  }

  function hang(f, dt) {
    if (!grabStillValid(f)) { lostGrip(f, "hang"); return; }
    f.grab.time += dt;
    if (f.grab.time >= f.grab.hold) { f.state = "pull"; f.grab.time = 0; pull(f, 0); }   // onto the curve at once
  }

  // Pull-up: straight from the catch, up the curve of the corner on hands and knees and onto
  // the top, where it crawls a little way before standing up.
  function pull(f, dt) {
    if (!grabStillValid(f)) { lostGrip(f, "pull"); return; }
    var g = f.grab;
    f.dir = -g.side;
    g.th = Math.max(g.thTop, g.th - f.crawlSpeed * 1.4 / g.rad * dt);
    onCurve(f, g.side < 0 ? g.l : g.r, g.t, g.rad, g.side, g.th);
    if (g.th <= g.thTop) { f.x = g.topX; f.y = g.t; f.tilt = 0; f.grab = null; startCrawl(f, rand(16, 36)); }
  }

  function climb(f, dt) {
    var L = f.ladder;
    if (!L || W.ladders.indexOf(L) < 0) { f.state = "fall"; f.vy = 0; f.vx = 0; f.ladder = null; return; }
    f.x = L.x;
    f.y -= CLIMB * dt;
    if (f.y <= L.top) {
      // hop off the top of the ladder onto the flat part of the square
      f.y = L.top; f.ladder = null; f.dir = L.exitDir;
      var T = 2 * 95 / GRAVITY;
      f.state = "fall"; f.vy = -95; f.vx = (L.exitX - f.x) / T; f.clearTo = null; f.tried = {};
    }
  }

  // Arriving: appear in the doorway, walk down the ramp, step off onto the title.
  function enter(f, dt) {
    var E = W.entry;
    if (!E) { f.state = "fall"; f.alpha = 1; f.scale = 1; return; }
    f.enterT += dt;
    var k = Math.min(1, f.enterT / 0.5);
    f.alpha = k; f.scale = 0.2 + 0.8 * k;
    f.x = E.x; f.y = E.y;
    if (k >= 1) { f.state = "ramp"; f.alpha = 1; f.scale = 1; }
  }

  function rampWalk(f, dt) {
    var E = W.entry;
    if (!E) { f.state = "fall"; return; }
    f.x = Math.min(E.endX, f.x + f.speed * dt);
    f.y = E.y + (E.endY - E.y) * clamp((f.x - E.x) / (E.endX - E.x), 0, 1);
    f.dir = 1;
    if (f.x >= E.endX) { f.state = "fall"; f.vx = 12; f.vy = 0; }
  }

  function exitStep(f, dt) {
    f.exitT += dt;
    var k = Math.min(1, f.exitT / 0.8);
    f.x += (f.door.x - f.x) * Math.min(1, dt * 5);
    f.y = f.door.y;
    f.scale = 1 - 0.85 * k;
    f.alpha = 1 - k;
    if (k >= 1) { f.dead = true; count(f.dog ? "dogsExited" : "exited"); if (dbg) dbg.push({ kind: "gone", why: f.dog ? "dog exit" : "exit", id: f.id }); }
  }

  function onCorner(f) {
    return (f.state === "slip" && f.slipG && f.slipG.roll) || (f.state === "pull" && !!f.grab);
  }

  // Strict rule: never inside a box. Anything that ends up there (layout change, resize)
  // moves to the nearest legal top edge or the ground.
  function settle(f, force) {
    if (f.dead || f.state === "exit" || f.state === "enter" || f.state === "ramp") return;
    if (onCorner(f)) return;                     // hugging a rounded corner: its pose was checked against the curve
    if (f.state === "climb") {
      if (f.ladder && W.ladders.indexOf(f.ladder) >= 0) return;
      f.state = "fall"; f.vy = 0; f.vx = 0; f.ladder = null;
    }
    var e = extents(f);
    var inside = hitsBox(f.x, f.y, e[0], e[1]);
    if (!force && !inside) return;
    var best = null, bd = Infinity;
    function consider(x, y, state, d) { if (d < bd) { bd = d; best = { x: x, y: y, state: state }; } }
    var se = standExtents(f), sw = se[0], sh = se[1];
    if (inside) {
      // step out sideways into the gap and keep falling: the smallest, most natural move
      [inside.l - sw - 0.5, inside.r + sw + 0.5].forEach(function (x) {
        if (x > 4 && x < W.width - 4 && !hitsBox(x, f.y, sw, sh)) consider(x, f.y, "fall", Math.abs(x - f.x) * 0.8);
      });
    }
    W.boxes.forEach(function (b) {
      if (b.sr - b.sl < 2) return;
      var x = clamp(f.x, b.sl, b.sr), d = Math.abs(x - f.x) + Math.abs(b.t - f.y);
      if (!hitsBox(x, b.t, sw, sh)) consider(x, b.t, "walk", d);
      else if (!f.dog && !f.hat && !hitsBox(x, b.t, HALF_WC, HC)) consider(x, b.t, "crawl", d);
    });
    var gx = clamp(f.x, 6, W.width - 6);
    if (!hitsBox(gx, W.ground, sw, sh)) consider(gx, W.ground, "walk", Math.abs(gx - f.x) + Math.abs(W.ground - f.y));
    if (!best) { if (dbg) dbg.push({ kind: "gone", why: "nowhere", id: f.id }); f.dead = true; return; }
    if (dbg) dbg.push({ kind: "settle", id: f.id, state: f.state, from: [Math.round(f.x), Math.round(f.y)], to: [Math.round(best.x), Math.round(best.y)], force: !!force });
    f.x = best.x; f.y = best.y; f.state = best.state; f.vx = 0; f.vy = 0;
    if (best.state === "crawl") f.crawlLeft = 10;
    f.dismount = null; f.climbAfter = null; f.goal = null; f.grab = null; f.clearTo = null; f.lowSlip = false; f.slip = false; f.slipG = null;
    f.tilt = 0; f.spin = 0; f.spinV = 0; f.fallTop = null;
  }

  function collide(now) {
    for (var i = 0; i < figs.length; i++) {
      var a = figs[i];
      if (a.state !== "walk" || a.dismount !== null || a.wave > 0 || a.dead) continue;
      for (var j = i + 1; j < figs.length; j++) {
        var b = figs[j];
        if (b.state !== "walk" || b.dismount !== null || b.wave > 0 || b.dead) continue;
        if (!!a.dog !== !!b.dog) continue;               // a dog only chases a Ditto (dogWalk)
        if (Math.abs(a.y - b.y) > 2 || Math.abs(a.x - b.x) > (a.dog ? 8 : 5)) continue;
        if (a.dog) { dogsMeet(a, b, now); continue; }
        var left = a.x <= b.x ? a : b, right = left === a ? b : a;
        left.dir = -1; right.dir = 1; left.bounce = right.bounce = 0.7;
        left.goal = right.goal = null;
        if (a.hat || b.hat) continue;                   // a hat never doubles
        if (now - a.lastHit > COOLDOWN && now - b.lastHit > COOLDOWN) {
          a.lastHit = b.lastHit = now;
          replicate((a.x + b.x) / 2, a.y, now);
        }
      }
    }
  }

  // Two dogs that bump into each other bounce apart, and a puppy pops up between them, every time.
  // They're pulled clear of each other at once, so one bump is one puppy (not a bump that lasts and
  // then waits out a cooldown, which was why some meetings made no puppy).
  function dogsMeet(a, b, now) {
    var left = a.x <= b.x ? a : b, right = left === a ? b : a;
    left.dir = -1; right.dir = 1; left.chase = right.chase = null; left.chaseT = right.chaseT = 0.8;
    var gap = 2 * DOG_HW + 1.5 - (right.x - left.x);
    if (gap > 0) {
      if (!pastEdge(left.x - gap / 2, -1, 6) && !hitsBox(left.x - gap / 2, left.y, DOG_HW, DOG_H)) left.x -= gap / 2;
      if (!pastEdge(right.x + gap / 2, 1, 6) && !hitsBox(right.x + gap / 2, right.y, DOG_HW, DOG_H)) right.x += gap / 2;
    }
    var newborn = now - a.lastHit < DOG_MEET_MS || now - b.lastHit < DOG_MEET_MS;   // only a puppy just born waits
    if (dbg) dbg.push({ kind: "dogmeet", newborn: newborn });
    if (newborn) return;
    a.lastHit = b.lastHit = now;
    var spots = [(left.x + right.x) / 2, left.x, right.x], x = null;
    for (var i = 0; i < spots.length && x === null; i++) if (!hitsBox(spots[i], a.y, DOG_HW, DOG_H)) x = spots[i];
    if (x === null) return;
    var pack = dogs();
    if (pack.length >= DOG_CAP) poof(pack.reduce(function (o, d) { return d.born < o.born ? d : o; }));
    var n = makeDog(makeFig(x, a.y));
    n.lastHit = now; n.grow = 0.3; n.dir = Math.random() < 0.5 ? -1 : 1;
    if (dbg) dbg.push({ kind: "puppy", id: n.id });
    effects.push({ type: "pop", x: x, y: a.y - DOG_H / 2, t: 0 });
  }

  // A collision doubles them: a new figure pops up right there and walks off its own way.
  function replicate(x, y, now) {
    var alive = people();
    if (alive.length >= CAP && !poofForRoom(alive)) return;   // nobody left who can go poof
    if (hitsBox(x, y)) return;
    var n = makeFig(x, y);
    n.lastHit = now;
    n.bounce = 0.8;           // heads off in its own direction before choosing where to go
    n.grow = 0.3;
    effects.push({ type: "pop", x: x, y: y - H / 2, t: 0 });
  }

  function poof(f, why) {
    f.dead = true;
    if (dbg) dbg.push({ kind: "gone", why: why || "poof", id: f.id });
    var e = extents(f);
    effects.push({ x: f.x, y: f.y - e[1] / 2, t: 0 });
  }

  // One goes poof to make room at the cap. A crowd that keeps doubling in one spot fills the
  // cap over and over: 15 of these within 10 s and the 30 most crowded go poof at once.
  function poofForRoom(alive) {
    var can = alive.filter(function (f) { return !f.hat; });   // a hat never goes poof
    if (!can.length) return false;
    poof(can.reduce(function (o, f) { return f.born < o.born ? f : o; }));
    var now = performance.now();
    poofTimes.push(now);
    while (poofTimes.length && now - poofTimes[0] > CRUSH_MS / timeScale) poofTimes.shift();
    if (poofTimes.length >= CRUSH_POOFS) breakUpCrowd();
    return true;
  }

  function breakUpCrowd() {
    poofTimes = [];
    var alive = people().filter(function (f) { return f.state !== "exit" && !f.hat; });
    alive.forEach(function (f) {
      f.crowd = 0;
      alive.forEach(function (g) {
        if (g !== f && Math.abs(g.x - f.x) < CRUSH_NEAR && Math.abs(g.y - f.y) < CRUSH_NEAR) f.crowd++;
      });
    });
    alive.sort(function (a, b) { return b.crowd - a.crowd || a.born - b.born; });
    alive.slice(0, Math.max(0, Math.min(CRUSH_CLEAR, alive.length - START))).forEach(function (f) { poof(f, "crowd"); });
  }

  /* ---------------- drawing ---------------- */

  // The canvas covers the layout viewport, which excludes a classic scrollbar: sizing it to
  // innerWidth would squeeze every drawing a few percent to the left.
  function resizeCanvas() {
    var de = document.documentElement;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = de.clientWidth; ch = de.clientHeight;
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
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
    if (f.tilt) { ctx.translate(0, -4.5); ctx.rotate(f.tilt); ctx.translate(0, 4.5); }   // on a curve: + nose down
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

  // Upper arm and forearm, 2.7 each (a normal arm): the elbow bends down when the hand is closer.
  function arm(sx, sy, hx, hy) {
    var dx = hx - sx, dy = hy - sy, d = Math.sqrt(dx * dx + dy * dy) || 1, bend = 0;
    if (d < 5.4) bend = Math.sqrt(2.7 * 2.7 - d * d / 4);
    var nx = -dy / d, ny = dx / d;
    if (ny < 0) { nx = -nx; ny = -ny; }
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + dx / 2 + nx * bend, sy + dy / 2 + ny * bend);
    ctx.lineTo(hx, hy);
  }

  // Hanging from a rounded corner: both hands on the curve, body close beside the box.
  function drawHanger(f, t) {
    var g = f.grab;
    var sx = f.x, sy = f.y - SHOULDER;
    var p = { x: g.px, y: g.py };                       // the hands stay on the corner while the body moves
    var kick = 0.25 * Math.sin(t / 210 + f.id);         // legs together, swinging a little
    ctx.save();
    pen();
    ctx.beginPath();
    arm(sx, sy, p.x, p.y);
    arm(sx, sy, p.x + g.side * 1.1, p.y + 1.1);
    ctx.moveTo(f.x, f.y - 6.6); ctx.lineTo(f.x, f.y - 11);
    limb(f.x, f.y - 6.6, kick, 6.6);
    limb(f.x, f.y - 6.6, -kick * 0.6 - 0.1, 6.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(f.x, f.y - 12.7, 1.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // A little dog, facing +x (mirrored for -x): body, four trotting legs, a big head with a floppy
  // ear, and a tail that wags hard after a click. It fits the dog's box (4.8 each way, 9.2 tall).
  function drawDog(f, t) {
    var s = Math.sin(f.phase), running = f.state === "walk" && f.bark <= 0;
    var grow = f.grow > 0 ? 1 - 0.7 * f.grow / 0.3 : 1;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.dir * f.scale * grow, f.scale * grow);
    ctx.globalAlpha *= f.alpha;
    pen();
    var a = running ? 0.5 * s : 0.08, air = f.state === "fall" ? 0.55 : 0;
    ctx.beginPath();
    ctx.moveTo(-2.6, -4.4); ctx.lineTo(1.6, -4.7);                    // body
    limb(1.5, -4.7, a + air, 4.4); limb(0.9, -4.7, -a + air, 4.4);     // front legs
    limb(-2.5, -4.4, -a - air, 4.2); limb(-1.9, -4.4, a - air, 4.2);   // back legs
    ctx.moveTo(1.6, -4.7); ctx.lineTo(2.3, -6.0);                      // neck
    var wag = f.wag > 0 ? 0.7 * Math.sin(t / 35) : 0.25 * Math.sin(t / 150 + f.id);
    ctx.moveTo(-2.6, -4.4); ctx.lineTo(-2.6 - 2.1 * Math.cos(1.05 + wag), -4.4 - 2.6 * Math.sin(1.05 + wag));   // tail
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(2.9, -7.3, 1.85, 0, Math.PI * 2);                          // head
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(2.0, -8.9); ctx.lineTo(1.3, -7.4);                      // floppy ear
    ctx.stroke();
    ctx.fillStyle = colors.ink;
    ctx.beginPath(); ctx.arc(3.6, -7.6, 0.45, 0, Math.PI * 2); ctx.fill();   // eye
    ctx.restore();
  }

  function drawFigure(f, t) {
    if (f.dog) { drawDog(f, t); return; }
    if (f.state === "crawl" || f.state === "pull" || ((f.state === "fall" || f.state === "slip") && f.lowSlip)) { drawCrawler(f); return; }
    if (f.state === "hang" && f.grab) { drawHanger(f, t); return; }
    ctx.save();
    ctx.translate(f.x, f.y);
    var mid = standExtents(f)[1] / 2;
    if (f.spin) { ctx.translate(0, -mid); ctx.rotate(f.spin); ctx.translate(0, mid); }   // tumbling
    var sq = f.squash > 0 ? f.squash / 0.22 : 0;          // landing squash
    var grow = f.grow > 0 ? 1 - 0.7 * f.grow / 0.3 : 1;   // a newborn pops up from small
    ctx.scale((f.state === "climb" ? 1 : f.dir) * f.scale * grow * (1 + 0.28 * sq), f.scale * grow * (1 - 0.28 * sq));
    ctx.globalAlpha *= f.alpha;
    pen();
    var s = Math.sin(f.phase), legA, legB, armA, armB;
    if (f.state === "climb") {
      legA = 0.35 * s; legB = -0.35 * s; armA = 2.7 + 0.35 * s; armB = -2.7 + 0.35 * s;
    } else if (f.state === "fall" || f.state === "slip") {
      var fl = t / 55 + f.id;                              // flailing
      legA = 0.3 + 0.25 * Math.sin(fl * 0.8); legB = -0.3 - 0.25 * Math.sin(fl * 0.8 + 1);
      armA = 2.25 + 0.6 * Math.sin(fl); armB = -2.25 - 0.6 * Math.sin(fl + 1.3);
    } else if (f.wave > 0) {
      legA = 0.12; legB = -0.12; armA = -0.25; armB = -(2.5 + 0.5 * Math.sin(t / 70));
    } else if (f.state === "enter") {
      legA = 0.12; legB = -0.12; armA = 0.25; armB = -0.25;
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
    if (f.hat) drawHat();
    ctx.restore();
  }

  // A tall top hat in red and white stripes, a little crooked, sitting on the head.
  function drawHat() {
    var bottom = -14.2, top = -12.7 - 1.95 - HAT_H + 0.65, w = 3.4, band = (bottom - top) / 4;
    ctx.save();
    ctx.translate(0.2, 0);
    ctx.rotate(-0.09);
    for (var i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? "#FFFFFF" : "#D62828";
      ctx.fillRect(-w / 2, bottom - (i + 1) * band, w, band + 0.05);
    }
    ctx.lineWidth = 0.7;
    ctx.strokeRect(-w / 2, top, w, bottom - top);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-2.8, bottom); ctx.lineTo(2.8, bottom);    // the brim
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

  // A door in its frame: the glowing doorway behind, the panel swinging open on its hinge
  // (k = 0 shut, 1 wide open). The entrance is blue, the exit warm.
  function drawDoor(dx, dy, k, warm, t) {
    var w = 9, h = 14, pulse = 0.75 + 0.25 * Math.sin(t / 380);
    if (k > 0.02) {
      ctx.save();
      ctx.shadowColor = colors.accent;
      ctx.shadowBlur = 8 * pulse * k;
      var g = ctx.createLinearGradient(dx, dy - h, dx, dy);
      if (warm) {
        g.addColorStop(0, "rgba(255, 236, 160, " + (0.55 * pulse * k) + ")");
        g.addColorStop(1, "rgba(255, 196, 80, " + (0.95 * pulse * k) + ")");
      } else {
        g.addColorStop(0, "rgba(170, 236, 240, " + (0.55 * pulse * k) + ")");
        g.addColorStop(1, "rgba(83, 183, 192, " + (0.95 * pulse * k) + ")");
      }
      ctx.fillStyle = g;
      ctx.fillRect(dx - w / 2, dy - h, w, h);
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1;
    var pw = w * (1 - 0.82 * k);                          // the panel narrows toward its hinge as it opens
    ctx.fillStyle = warm ? "#C98A2B" : "#53B7C0";
    ctx.fillRect(dx - w / 2, dy - h, pw, h);
    ctx.strokeRect(dx - w / 2 + 0.5, dy - h + 0.5, Math.max(0.5, pw - 1), h - 1);
    if (k < 0.5) {                                        // the knob, while it's mostly shut
      ctx.beginPath();
      ctx.arc(dx - w / 2 + pw - 2, dy - h / 2, 0.8, 0, Math.PI * 2);
      ctx.fillStyle = colors.ink;
      ctx.fill();
    }
    ctx.strokeRect(dx - w / 2 - 0.5, dy - h - 0.5, w + 1, h + 0.5);   // the frame
    ctx.restore();
  }

  // The way in (top left, with its ramp once it's open) and the way out (bottom right, shown while
  // the figures are about, with a flickering sign).
  function drawDoors(t, scene) {
    var E = W.entry;
    if (E) {
      drawDoor(E.x, E.y, entryK, false, t);
      if (entryK > 0.01) {
        ctx.save();
        ctx.globalAlpha = entryK;
        ctx.strokeStyle = colors.muted;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(E.x - 5, E.y + 0.5); ctx.lineTo(E.x + 5, E.y + 0.5); ctx.lineTo(E.endX, E.endY + 0.5);
        ctx.moveTo(E.endX - 6, E.endY + 0.5); ctx.lineTo(E.endX - 6, E.endY + 3.5);   // a post under the end of the ramp
        ctx.stroke();
        ctx.restore();
      }
    }
    var D = W.door;
    var exitAlpha = Math.max(scene, exitK);
    if (D && exitAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = exitAlpha;
      drawDoor(D.x, D.y, exitK, true, t);
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();                                    // door mat
      ctx.moveTo(D.x - 7, D.y + 0.5); ctx.lineTo(D.x + 7, D.y + 0.5);
      ctx.stroke();
      ctx.globalAlpha *= exitK > 0.5 && Math.random() < 0.07 ? 0.2 : 1;   // the sign flickers while it's open
      ctx.fillStyle = "#E5484D";
      ctx.shadowColor = "#E5484D";
      ctx.shadowBlur = exitK > 0.5 ? 3 : 0;
      ctx.font = "bold 5px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("EXIT", D.x, D.y - 16);
      ctx.restore();
    }
    drawStats(exitK);
  }

  // Dittos released / Dittos exited / Giants released, on a small card; gone when the exit shuts.
  var STATS_LABEL = "500 10.5px 'IBM Plex Sans', system-ui, sans-serif", STATS_NUM = "700 10.5px 'IBM Plex Sans', system-ui, sans-serif";
  function statsRows() {
    var rows = [["Dittos released:", stats.released], ["Dittos exited:", stats.exited]];
    if (dogsUnlocked()) rows.push(["Ditto dogs exited:", stats.dogsExited]);   // once the dogs are unlocked
    rows.push(["Giants released:", stats.giants]);
    return rows;
  }

  function statsSize() {
    var rows = statsRows(), lw = 0, nw = 0;
    if (!ctx) return { w: 130, h: rows.length * 13 + 9 };
    ctx.save();
    ctx.font = STATS_LABEL;
    rows.forEach(function (r) { lw = Math.max(lw, ctx.measureText(r[0]).width); });
    ctx.font = STATS_NUM;
    rows.forEach(function (r) { nw = Math.max(nw, ctx.measureText(String(r[1])).width); });
    ctx.restore();
    return { w: Math.ceil(lw + nw + 26), h: rows.length * 13 + 9 };
  }

  function drawStats(k) {
    var S = W.stats;
    if (!S || k < 0.01) return;
    var rows = statsRows(), label = STATS_LABEL, num = STATS_NUM, size = statsSize();
    ctx.save();
    var w = size.w, h = size.h, l = Math.max(4, S.r - w), t = S.b - h;
    ctx.globalAlpha = k;
    ctx.fillStyle = colors.card;
    ctx.shadowColor = "rgba(22, 38, 46, 0.16)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(l, t, w, h, 8); else ctx.rect(l, t, w, h);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.textBaseline = "middle";
    rows.forEach(function (r, i) {
      var y = t + 11 + i * 13;
      ctx.font = label; ctx.fillStyle = colors.muted; ctx.textAlign = "left";
      ctx.fillText(r[0], l + 9, y);
      ctx.font = num; ctx.fillStyle = colors.ink; ctx.textAlign = "right";
      ctx.fillText(String(r[1]), l + w - 9, y);
    });
    ctx.restore();
  }

  function drawEffects(dt, fade) {
    effects.forEach(function (e) {
      e.t += dt;
      if (e.type === "bark") {                      // a cartoon "Woof!" bubble
        var kb = e.t / 0.9;
        if (kb >= 1) { e.done = true; return; }
        ctx.save();
        ctx.globalAlpha = fade * (kb < 0.75 ? 1 : (1 - kb) / 0.25);
        var bx = e.x, by = e.y - 4 * Math.min(1, kb * 4);
        ctx.font = "800 7.5px -apple-system, system-ui, sans-serif";
        var bw = ctx.measureText("Woof!").width + 7;
        ctx.fillStyle = colors.card;
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx - bw / 2, by - 10, bw, 10, 4); else ctx.rect(bx - bw / 2, by - 10, bw, 10);
        ctx.moveTo(bx - 2, by); ctx.lineTo(bx - 4 * e.dir, by + 3.5); ctx.lineTo(bx + 1, by);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = colors.ink;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("Woof!", bx, by - 4.6);
        ctx.restore();
        return;
      }
      if (e.type === "pop") {
        var kp = e.t / 0.4;
        if (kp >= 1) { e.done = true; return; }
        ctx.save();
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1;
        ctx.globalAlpha = fade * (1 - kp);
        ctx.beginPath();
        for (var r = 0; r < 6; r++) {
          var ang = r / 6 * Math.PI * 2;
          ctx.moveTo(e.x + Math.cos(ang) * (3 + 5 * kp), e.y + Math.sin(ang) * (3 + 5 * kp));
          ctx.lineTo(e.x + Math.cos(ang) * (5 + 7 * kp), e.y + Math.sin(ang) * (5 + 7 * kp));
        }
        ctx.stroke();
        ctx.restore();
        return;
      }
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

  function draw(t, dt, scene) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.translate(-window.scrollX, -window.scrollY);
    drawDoors(t, scene);
    if (scene > 0.01) {
      ctx.globalAlpha = scene;
      drawLadders();
      var top = window.scrollY - 30, bottom = window.scrollY + ch + 30;
      figs.forEach(function (f) { if (f.y > top && f.y - H < bottom) drawFigure(f, t); });
      drawEffects(dt, scene);
      ctx.globalAlpha = 1;
      if (notes.length && enabled) drawAnnounce(dt);
    }
  }

  // "Easter egg unlocked: …" at the top of the screen for a few seconds, once.
  function drawAnnounce(dt) {
    var note = notes[0];
    note.t += dt;
    var k = note.t, alpha = k < 0.3 ? k / 0.3 : k < 5.5 ? 1 : 1 - (k - 5.5) / 0.6;
    if (alpha <= 0) { notes.shift(); return; }
    var pop = k < 0.3 ? 0.85 + 0.15 * (k / 0.3) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "700 13px 'IBM Plex Sans', system-ui, sans-serif";
    var text = note.text, w = ctx.measureText(text).width + 30, h = 30;
    var x = window.scrollX + cw / 2, y = window.scrollY + 46;
    ctx.translate(x, y); ctx.scale(pop, pop);
    ctx.fillStyle = colors.accent;
    ctx.shadowColor = "rgba(0, 0, 0, 0.25)"; ctx.shadowBlur = 10;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 15); else ctx.rect(-w / 2, -h / 2, w, h);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 1);
    ctx.restore();
  }

  /* ---------------- loop ---------------- */

  function frame(t) {
    raf = 0;
    var dt = last ? clamp((t - last) / 1000, 0, 0.05) * timeScale : 0;   // never backwards
    last = t;
    var de = document.documentElement;
    if (de.clientWidth !== cw || de.clientHeight !== ch) { resizeCanvas(); dirty = true; }
    if (dirty) computeWorld();
    var now = performance.now();
    // the doors swing toward open or shut; the scene fades in and out with the entrance
    var step = dt * 2.5 || 0.05;
    entryK = clamp(entryK + (entryOpen ? step : -step), 0, 1);
    exitK = clamp(exitK + (exitOpen ? step : -step), 0, 1);
    sceneK = clamp(sceneK + (enabled ? dt / 0.3 : -dt / 0.3), 0, 1);
    var doorsMoving = entryK !== (entryOpen ? 1 : 0) || exitK !== (exitOpen ? 1 : 0);
    if (!enabled && sceneK === 0 && (figs.length || effects.length || pending)) { figs = []; effects = []; pending = 0; }
    if (!enabled && sceneK === 0) {
      draw(t, dt, 0);                                  // shut: only the door to draw
      if (doorsMoving && !document.hidden) raf = requestAnimationFrame(frame); else last = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
    if (enabled && dogsUnlocked()) {
      if (!nextDogAt) { nextDogAt = now + (dogSoon ? 1500 : rand(DOG_GAP_MIN, DOG_GAP_MAX)) / timeScale; dogSoon = false; }   // just unlocked: one right away
      if (now >= nextDogAt) { arriveDog(); nextDogAt = now + rand(DOG_GAP_MIN, DOG_GAP_MAX) / timeScale; }
    }
    if (enabled && (pending > 0 || pendingDogs > 0) && entryK > 0.6 && now - lastArrival > ARRIVAL_GAP_MS / timeScale) admitOne(now);
    if (dbg) figs.forEach(function (f) { f._px = f.x; f._py = f.y; f._ps = f.state; });
    figs.forEach(function (f) {
      if (f.wave > 0) f.wave -= dt;
      if (f.bounce > 0) f.bounce -= dt;
      if (f.squash > 0) f.squash -= dt;
      if (f.grow > 0) f.grow -= dt;
      var moving = f.state === "climb" || f.state === "exit" || f.state === "crawl" || f.state === "pull" ||
        f.state === "ramp" || (f.state === "walk" && f.wave <= 0);
      // hands and knees step in time with the speed: crawling up a corner goes 1.4 times as fast
      if (moving) f.phase += dt * (f.dog ? (f.sprint || f.dash ? 17 * DOG_SPRINT : 17) : f.state === "climb" ? 9 : f.state === "crawl" ? 8 : f.state === "pull" ? 11.2 : 11);
      if (f.wag > 0) f.wag -= dt;
      if (f.bark > 0) f.bark -= dt;
      if (f.state === "walk") walk(f, dt);
      else if (f.state === "fall") fall(f, dt);
      else if (f.state === "slip") slipStep(f, dt);
      else if (f.state === "climb") climb(f, dt);
      else if (f.state === "hang") hang(f, dt);
      else if (f.state === "pull") pull(f, dt);
      else if (f.state === "crawl") crawl(f, dt);
      else if (f.state === "enter") enter(f, dt);
      else if (f.state === "ramp") rampWalk(f, dt);
      else if (f.state === "exit") exitStep(f, dt);
    });
    if (enabled) collide(now);
    figs.forEach(function (f) { settle(f, false); });
    figs.forEach(function (f) {
      var standing = f.state === "walk" || f.state === "crawl";
      var p = standing ? platformUnder(f.x, f.y) : null;
      f.onGround = standing && !p && onGround(f);
      f.onKey = p ? p.key : null;
      if (p) { f.onL = p.l; f.onT = p.t; }
    });
    if (dbg) figs.forEach(function (f) {
      if (f._px === undefined || f.dead) return;
      var dx = Math.abs(f.x - f._px), dy = Math.abs(f.y - f._py);
      var limit = (f._ps === "fall" || f.state === "fall") ? 30 : 6;
      if (dx > limit || dy > limit) dbg.push({ kind: "jump", id: f.id, from: [Math.round(f._px), Math.round(f._py), f._ps], to: [Math.round(f.x), Math.round(f.y), f.state] });
    });
    if (dbg && dbg.length > 300) dbg.splice(0, dbg.length - 300);
    figs = figs.filter(function (f) { return !f.dead; });
    if (enabled) {
      // the door: one more, at most every 10 s, only if the count is no higher than 10 s ago
      var span = STALL_MS / timeScale;
      var count0 = people().length;
      if (!history.length || now - history[history.length - 1].t > 250) history.push({ t: now, n: count0 });
      while (history.length > 1 && now - history[1].t >= span) history.shift();
      var then = history[0];
      if (now - then.t >= span && now - lastRelease >= span && count0 <= then.n && !pending && count0 < CAP) {
        arrive(1);
        lastRelease = now;
      }
    }
    draw(t, dt, sceneK);
  }

  // Draw again soon: a layout change, a scroll, a door click.
  function kick() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }

  /* ---------------- the doors are the controls ---------------- */

  function injectCss() {
    var css =
      ".sf-canvas{position:fixed;left:0;top:0;pointer-events:none;z-index:40}" +
      ".sf-ui{position:absolute;left:0;top:0;width:0;height:0;z-index:45}" +
      ".sf-door{position:absolute;padding:0;margin:0;border:0;border-radius:3px;background:transparent;cursor:pointer}" +
      ".sf-door:focus-visible{outline:2px solid var(--accent,#0E7C86);outline-offset:2px}" +
      ".sf-door[hidden]{display:none}" +
      ".sf-door::after{content:attr(data-tip);position:absolute;white-space:nowrap;background:#16262E;color:#fff;" +
      "font:500 12px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;padding:6px 8px;border-radius:7px;" +
      "opacity:0;transform:translateY(-3px);pointer-events:none;transition:opacity .15s,transform .15s}" +
      ".sf-door:hover::after,.sf-door:focus-visible::after{opacity:1;transform:none}" +
      ".sf-entry::after{left:0;top:calc(100% + 6px)}" +
      ".sf-exit::after{right:0;bottom:calc(100% + 6px)}" +
      "@media (prefers-reduced-motion:reduce){.sf-door::after{transition:none}}";
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
    entryBtn = document.createElement("button");
    entryBtn.type = "button";
    entryBtn.className = "sf-door sf-entry";
    exitBtn = document.createElement("button");
    exitBtn.type = "button";
    exitBtn.className = "sf-door sf-exit";
    ui.appendChild(entryBtn);
    ui.appendChild(exitBtn);
    document.body.appendChild(canvas);
    document.body.appendChild(ui);
    entryBtn.addEventListener("click", onEntryClick);
    exitBtn.addEventListener("click", onExitClick);
    resizeCanvas();
  }

  // Invisible buttons over the drawn doors: keyboard reachable, with a tooltip saying what a click does.
  function placeDoors() {
    if (!entryBtn) return;
    var E = W.entry, D = W.door;
    entryBtn.hidden = !E;
    if (E) {
      entryBtn.style.left = (E.x - 7) + "px"; entryBtn.style.top = (E.y - 17) + "px";
      entryBtn.style.width = "14px"; entryBtn.style.height = "19px";
    }
    exitBtn.hidden = !D || !enabled;
    if (D) {
      exitBtn.style.left = (D.x - 7) + "px"; exitBtn.style.top = (D.y - 23) + "px";
      exitBtn.style.width = "14px"; exitBtn.style.height = "25px";
    }
    var entryTip = !enabled ? "Open the door" : "Let one more out";
    entryBtn.setAttribute("data-tip", entryTip); entryBtn.setAttribute("aria-label", entryTip + " (stick figures)");
    exitBtn.setAttribute("data-tip", "Close the doors");
    exitBtn.setAttribute("aria-label", "Close the exit and the entrance (stick figures)");
  }

  // The entrance: shut, a click opens it (and the exit) and they start coming out; open, each
  // click lets one more out.
  function onEntryClick() {
    if (!enabled) openUp(true);
    else releaseOne();
    placeDoors();
    kick();
  }

  // The exit: a click shuts it, and the entrance shuts with it; they all go.
  function onExitClick() {
    if (!enabled) return;
    shutDown();
    placeDoors();
    kick();
  }

  function openUp(animate) {
    enabled = true; entryOpen = true; exitOpen = true;
    if (!animate) { entryK = exitK = sceneK = 1; }
    dirty = true;
    if (!figs.length && !pending) arrive(START);
    lastArrival = performance.now();
    lastRelease = performance.now();
    history = [];
    poofTimes = [];
  }

  function shutDown() {
    enabled = false; entryOpen = false; exitOpen = false;
    pending = 0; pendingDogs = 0; nextDogAt = 0;
  }

  function figureAt(clientX, clientY) {
    var x = clientX + window.scrollX, y = clientY + window.scrollY, pad = 5, best = null, bd = Infinity;
    figs.forEach(function (f) {
      if (f.dead || f.state === "exit" || f.state === "enter") return;
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

  // Clicking the entrance door lets one more through (the oldest goes poof at the cap).
  function releaseOne() {
    var alive = people();
    if (alive.length + pending >= CAP && alive.length) poofForRoom(alive);
    pending = Math.min(pending + 1, Math.max(1, CAP - alive.length + 1));
    lastArrival = 0;
    doorClicks++;
    if (dogsUnlocked() && doorClicks % DOG_CLICKS === 0) arriveDog();   // every 10th click brings a dog too
  }

  function onClick(e) {
    if (!enabled || isInteractive(e.target)) return;
    var f = figureAt(e.clientX, e.clientY);
    if (!f || (f.state !== "walk" && f.state !== "crawl")) return;
    if (f.dog) {                                    // a wag and a bark, then off he runs again
      f.wag = 1.4; f.bark = 0.55;
      effects.push({ type: "bark", x: f.x + f.dir * 6, y: f.y - DOG_H - 2, t: 0, dir: f.dir });
      return;
    }
    if (f.state === "crawl") { f.crawlLeft = 0; return; }   // a crawler stands up as soon as there's room
    if (Math.random() < 0.5) { f.state = "fall"; f.vy = -170; f.vx = 0; f.dismount = null; f.climbAfter = null; f.clearTo = null; }
    else f.wave = 1.2;
  }

  var cursorSet = false;
  function onPointerMove(e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    var over = enabled && !isInteractive(e.target) && figureAt(e.clientX, e.clientY);
    if (over && !cursorSet) { document.documentElement.style.cursor = "pointer"; cursorSet = true; }
    else if (!over && cursorSet) { document.documentElement.style.cursor = ""; cursorSet = false; }
  }

  /* ---------------- start ---------------- */

  function markDirty() { dirty = true; kick(); }

  function init() {
    injectCss();
    buildUi();
    loadStats();
    computeWorld();
    // every visit starts with the door shut (and forget the old on/off setting)
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    placeDoors();
    kick();

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
      if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } last = 0; }
      else kick();
    });
    document.addEventListener("click", onClick);
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    // test hook, only on a local preview
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      dbg = [];
      window.__dittoFigures = {
        log: function () { return dbg; },
        figs: function () { return figs; }, world: function () { return W; }, cap: CAP,
        arrive: arrive, releaseOne: releaseOne, pending: function () { return pending; },
        doors: function () { return { enabled: enabled, entryOpen: entryOpen, exitOpen: exitOpen, entryK: entryK, exitK: exitK, sceneK: sceneK }; }, setSpeed: function (k) { timeScale = k; },
        hitsBox: hitsBox, extents: extents, setGrabChance: function (p) { GRAB_CHANCE = p; },
        onCorner: onCorner, crawlerPoints: crawlerPoints, stats: function () { return stats; },
        arriveDog: arriveDog, dogs: dogs, people: people, announce: function () { return notes[0] || null; }, notes: function () { return notes; },
        setHatChance: function (p) { HAT_CHANCE = p; },
        step: function (n) {                     // run n frames by hand (a hidden preview gets no animation frames)
          for (var i = 0; i < n; i++) { if (raf) cancelAnimationFrame(raf); raf = 0; frame((last || performance.now()) + 1000 / 60); }
        },
        poofTimes: function () { return poofTimes; }
      };
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
