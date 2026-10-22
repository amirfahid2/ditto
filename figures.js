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
 *   data-cap          population cap (default 50; 5 on small screens)
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

  var H = 14.6, HALF_W = 3;      // standing: feet to top of head, half the body width
  var HC = 8.4, HALF_WC = 5;     // crawling on hands and knees
  var SHOULDER = 10.4;           // feet to shoulders
  var GRAVITY = 700, CLIMB = 26, WALK_MIN = 15, WALK_MAX = 24, CRAWL_MIN = 8, CRAWL_MAX = 12;
  var START = 2, COOLDOWN = 2000, EXIT_CHANCE = 0.3, GRAB_CHANCE = 0.35;
  var STALL_MS = 10000, ARRIVAL_GAP_MS = 900;   // the door: one more only if the count hasn't grown in 10 s
  var CRUSH_POOFS = 15, CRUSH_MS = 10000, CRUSH_CLEAR = 30, CRUSH_NEAR = 40;   // breaking up a crowd
  // a phone (by its screen, so a narrow window on a computer still gets the full cast)
  var SMALL = Math.min(screen.width || 9999, screen.height || 9999) < 500;
  var CAP = SMALL ? 5 : (parseInt(ds.cap, 10) || 50);

  var W = { width: 0, height: 0, ground: 0, boxes: [], ladders: [], door: null, entry: null };
  var figs = [], effects = [];
  var enabled = false, dirty = true, raf = 0, last = 0, nextId = 1;
  var pending = 0, lastArrival = 0, lastRelease = 0, history = [], poofTimes = [];
  var colors = { ink: "#16262E", muted: "#64808B", accent: "#0E7C86" };
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
    rideAlong();
    buildEntry();
    buildLadders();
    buildDoor();
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

  function extents(f) {
    if (f.state === "crawl" || (f.state === "pull" && f.grab && f.grab.k > 0.6)) return [HALF_WC, HC];
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
      climbAfter: null, ladder: null, grab: null, clearTo: null, crawlLeft: 0, tried: {},
      alpha: 1, scale: 1, dead: false
    };
    figs.push(f);
    return f;
  }

  // New figures come in through the door, one at a time.
  function arrive(n) {
    pending = Math.min(pending + n, Math.max(0, CAP - figs.length));
  }

  function admitOne(now) {
    lastArrival = now;
    pending--;
    if (!W.entry) {                                   // no room for the door: drop from just above the title
      var anchor = ds.sky && document.querySelector(ds.sky);
      var a = anchor ? docRect(anchor) : (W.boxes[0] || { l: W.width / 2 - 20, r: W.width / 2 + 20 });
      var s = makeFig(rand(a.l + 4, Math.max(a.l + 5, a.r - 4)), -rand(20, 50));
      s.state = "fall";
      return;
    }
    var f = makeFig(W.entry.x, W.entry.y);
    f.state = "enter"; f.enterT = 0; f.dir = 1; f.alpha = 0; f.scale = 0.2;
  }

  function onGround(f) { return Math.abs(f.y - W.ground) < 0.75; }

  function chooseGoal(f) {
    var ladders = W.ladders.filter(function (L) { return Math.abs(L.bottom - W.ground) < 2; });
    if (W.door && exitOpen && (Math.random() < EXIT_CHANCE || !ladders.length)) return { exit: true };
    if (!ladders.length) return { wander: true };
    var best = ladders[0];
    ladders.forEach(function (L) { if (Math.abs(L.x - f.x) < Math.abs(best.x - f.x)) best = L; });
    return { ladder: best };
  }

  function touchDown(f, vy) {
    f.state = "walk"; f.vx = 0; f.vy = 0; f.goal = null; f.tried = {}; f.clearTo = null; f.slip = false; f.lowSlip = false;
    if (vy > 140) f.squash = 0.22;
  }

  function startCrawl(f, distance) {
    f.state = "crawl";
    f.crawlLeft = distance;
  }

  function boxKey(b) { return Math.round(b.l) + ":" + Math.round(b.t); }

  // Where would a figure dropping straight down at x from y end up? null if onto a box
  // with no room even to crawl.
  function dropTarget(x, y) {
    var land = null;
    W.boxes.forEach(function (b) {
      if (x + HALF_W > b.l && x - HALF_W < b.r && b.t >= y && (!land || b.t < land.t)) land = b;
    });
    if (!land || land.t > W.ground) return hitsBox(x, W.ground) ? null : W.ground;
    if (x < land.sl || x > land.sr) return W.ground;   // beside its rounded corner: slides past it
    return (hitsBox(x, land.t) && hitsBox(x, land.t, HALF_WC, HC)) ? null : land.t;
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
    if (!crawling && neighbour && !hitsBox(landX, neighbour.t)) options.push("jump");
    var nearX = clearDrop(edge + f.dir * (HALF_W + 0.5), f.y, f.dir);
    if (!hitsBox(nearX, f.y + 1) && dropTarget(nearX, f.y) !== null) options.push("near");
    var farX = null;
    if (neighbour && gap >= 2 * HALF_W + 1.5) {
      farX = (f.dir > 0 ? neighbour.l : neighbour.r) - f.dir * (HALF_W + 0.5);
      if (!hitsBox(farX, f.y + 1) && dropTarget(farX, f.y) !== null) options.push("far");
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
    f.slipG = { key: p.key, edge: edge, t: p.t, r: f.dir > 0 ? p.rtr : p.rtl, dir: f.dir, to: pick === "near" ? nearX : farX };
  }

  // Following the curve of the corner: the body just touches it until it's clear of the box.
  function slipStep(f, dt) {
    var S = f.slipG, e = extents(f);
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
    if (px >= p.sl && px <= p.sr) {
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
      if (nx < p.sl || nx > p.sr) { stepOffEdge(f, p, true); return; }   // crawl off the edge into the gap
      if (hitsBox(nx, f.y, HALF_WC, HC)) { f.dir = -f.dir; return; }
      f.x = nx;
    }
    f.crawlLeft -= step;
    if (f.crawlLeft <= 0 && !hitsBox(f.x, f.y)) f.state = "walk";   // room to stand: up and walking
  }

  function fall(f, dt) {
    f.vy = Math.min(f.vy + GRAVITY * dt, 420);
    var nx = f.x + f.vx * dt, e = extents(f);
    if (f.clearTo !== null && (f.vx > 0 ? nx >= f.clearTo : nx <= f.clearTo)) { nx = f.clearTo; f.vx = 0; f.clearTo = null; f.lowSlip = false; }
    if (f.vx && (nx < 4 || nx > W.width - 4 || hitsBox(nx, f.y, e[0], e[1]))) { f.vx = 0; nx = f.x; f.clearTo = null; }
    var ny = f.y + f.vy * dt;
    if (f.vy < 0) {
      if (hitsBox(nx, ny, e[0], e[1])) { f.vy = 0; ny = f.y; }       // bonk: never rise into a box
      f.x = nx; f.y = ny;
      return;
    }
    if (f.clearTo === null && tryGrab(f, nx, ny)) return;
    var land = null;
    W.boxes.forEach(function (b) {
      if (nx >= b.sl - 0.5 && nx <= b.sr + 0.5 && b.t >= f.y - 0.01 && b.t <= ny && (!land || b.t < land.t)) land = b;
    });
    if (land && land.t <= W.ground) {
      var lx = clamp(nx, land.sl, land.sr);
      if (!hitsBox(lx, land.t)) { f.x = lx; f.y = land.t; touchDown(f, f.vy); return; }
      if (!hitsBox(lx, land.t, HALF_WC, HC)) {          // too low to stand: land crouched and crawl
        f.x = lx; f.y = land.t; touchDown(f, 0); startCrawl(f, 12);
        return;
      }
    }
    if (ny >= W.ground && !hitsBox(nx, W.ground)) { f.x = nx; f.y = W.ground; touchDown(f, f.vy); return; }
    var hit = hitsBox(nx, ny, extents(f)[0], extents(f)[1]);
    if (hit) {
      // brushing a box's side or rounded corner: slide out beside it and keep dropping; anything
      // more than a nudge (a box appeared around the figure) takes the smallest legal move instead
      var sideX = nx < (hit.l + hit.r) / 2 ? hit.l - HALF_W - 0.5 : hit.r + HALF_W + 0.5;
      if (Math.abs(sideX - nx) > 6) { f.x = nx; f.y = ny; settle(f, true); return; }
      if (dbg && Math.abs(sideX - nx) > 4) dbg.push({ kind: "pushout", id: f.id, prev: f._ps, vx: Math.round(f.vx), clearTo: f.clearTo, from: [Math.round(nx), Math.round(ny)], to: [Math.round(sideX), Math.round(ny)] });
      if (!hitsBox(sideX, ny)) { nx = sideX; f.vx = 0; f.clearTo = null; }
      else { settle(f, true); return; }
    }
    f.x = nx; f.y = ny;
  }

  // Where the hands go: on the curve of the rounded top corner, 35 degrees up from the side
  // (a square corner is simply the corner). side -1 = the box's left corner, +1 = its right.
  function gripPoint(b, side, rad) {
    var bx = side < 0 ? b.l : b.r;
    if (rad < 1.5) return { x: bx, y: b.t };
    var a = 35 * Math.PI / 180, inset = rad * (1 - Math.cos(a));
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
      var grip = gripPoint(b, side, rad);
      var shoulderY = grip.y + (rad < 1.5 ? 4.6 : 3.5);    // hang with the hands just above the head
      if (!(f.y - SHOULDER < shoulderY && ny - SHOULDER >= shoulderY)) continue;
      var key = boxKey(b);
      if (f.tried[key]) continue;
      f.tried[key] = true;
      var chance = f.slip ? 0.55 : GRAB_CHANCE;
      f.slip = false;
      if (Math.random() > chance) continue;
      var hx = side < 0 ? b.l - HALF_W - 0.5 : b.r + HALF_W + 0.5, hy = shoulderY + SHOULDER;
      var topX = side < 0 ? b.sl + HALF_WC : b.sr - HALF_WC;
      if (b.sr - b.sl < 2 * HALF_WC + 4 || hitsBox(topX, b.t, HALF_WC, HC)) continue;
      var clear = true;                                   // hanging and rising beside the box stay in the gap
      for (var y = hy; y >= b.t - 0.01 && clear; y -= 3) if (hitsBox(hx, y)) clear = false;
      if (!clear || hitsBox(hx, b.t)) continue;
      f.state = "hang"; f.x = hx; f.y = hy; f.vx = 0; f.vy = 0;
      var room = Infinity;
      W.boxes.forEach(function (o) {
        if (o.b <= b.t && topX + HALF_WC > o.l && topX - HALF_WC < o.r) room = Math.min(room, b.t - o.b);
      });
      f.grab = { key: b.key, l: b.l, r: b.r, t: b.t, side: side, px: grip.x, py: grip.y, hx: hx, hy: hy, topX: topX,
        lift: clamp(room - HC - 0.6, 0, 2.5), time: 0, k: 0, hold: rand(0.5, 0.9) };
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
      dbg.push({ kind: "griplost", id: f.id, where: where, k: g && +g.k.toFixed(2), key: g && String(g.key),
        box: !!b, dt: b ? [Math.round(b.t - g.t), Math.round((g.side < 0 ? b.l : b.r) - (g.side < 0 ? g.l : g.r))] : null });
    }
    f.state = "fall"; f.vy = 0; f.grab = null;
  }

  function hang(f, dt) {
    if (!grabStillValid(f)) { lostGrip(f, "hang"); return; }
    f.grab.time += dt;
    if (f.grab.time >= f.grab.hold) { f.state = "pull"; f.grab.time = 0; }
  }

  // Pull-up: rise beside the box until the feet reach its top, then roll onto the edge on hands and knees.
  function pull(f, dt) {
    if (!grabStillValid(f)) { lostGrip(f, "pull"); return; }
    var g = f.grab;
    g.time += dt;
    g.k = Math.min(1, g.time / 1.0);
    if (g.k < 0.6) {
      f.x = g.hx;
      f.y = g.hy + (g.t - g.hy) * ease(g.k / 0.6);
    } else {
      var k2 = (g.k - 0.6) / 0.4;
      f.x = g.hx + (g.topX - g.hx) * ease(k2);
      f.y = g.t - g.lift * Math.sin(Math.PI * k2);         // up and over the edge
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
    if (k >= 1) { f.dead = true; if (dbg) dbg.push({ kind: "gone", why: "exit", id: f.id }); }
  }

  // Strict rule: never inside a box. Anything that ends up there (layout change, resize)
  // moves to the nearest legal top edge or the ground.
  function settle(f, force) {
    if (f.dead || f.state === "exit" || f.state === "enter" || f.state === "ramp") return;
    if (f.state === "climb") {
      if (f.ladder && W.ladders.indexOf(f.ladder) >= 0) return;
      f.state = "fall"; f.vy = 0; f.vx = 0; f.ladder = null;
    }
    var e = extents(f);
    var inside = hitsBox(f.x, f.y, e[0], e[1]);
    if (!force && !inside) return;
    var best = null, bd = Infinity;
    function consider(x, y, state, d) { if (d < bd) { bd = d; best = { x: x, y: y, state: state }; } }
    if (inside) {
      // step out sideways into the gap and keep falling: the smallest, most natural move
      [inside.l - HALF_W - 0.5, inside.r + HALF_W + 0.5].forEach(function (x) {
        if (x > 4 && x < W.width - 4 && !hitsBox(x, f.y)) consider(x, f.y, "fall", Math.abs(x - f.x) * 0.8);
      });
    }
    W.boxes.forEach(function (b) {
      if (b.sr - b.sl < 2) return;
      var x = clamp(f.x, b.sl, b.sr), d = Math.abs(x - f.x) + Math.abs(b.t - f.y);
      if (!hitsBox(x, b.t)) consider(x, b.t, "walk", d);
      else if (!hitsBox(x, b.t, HALF_WC, HC)) consider(x, b.t, "crawl", d);
    });
    var gx = clamp(f.x, 6, W.width - 6);
    if (!hitsBox(gx, W.ground)) consider(gx, W.ground, "walk", Math.abs(gx - f.x) + Math.abs(W.ground - f.y));
    if (!best) { if (dbg) dbg.push({ kind: "gone", why: "nowhere", id: f.id }); f.dead = true; return; }
    if (dbg) dbg.push({ kind: "settle", id: f.id, state: f.state, from: [Math.round(f.x), Math.round(f.y)], to: [Math.round(best.x), Math.round(best.y)], force: !!force });
    f.x = best.x; f.y = best.y; f.state = best.state; f.vx = 0; f.vy = 0;
    if (best.state === "crawl") f.crawlLeft = 10;
    f.dismount = null; f.climbAfter = null; f.goal = null; f.grab = null; f.clearTo = null; f.lowSlip = false; f.slip = false; f.slipG = null;
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
          replicate((a.x + b.x) / 2, a.y, now);
        }
      }
    }
  }

  // A collision doubles them: a new figure pops up right there and walks off its own way.
  function replicate(x, y, now) {
    var alive = figs.filter(function (f) { return !f.dead; });
    if (alive.length >= CAP) poofForRoom(alive);
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
    poof(alive.reduce(function (o, f) { return f.born < o.born ? f : o; }));
    var now = performance.now();
    poofTimes.push(now);
    while (poofTimes.length && now - poofTimes[0] > CRUSH_MS / timeScale) poofTimes.shift();
    if (poofTimes.length >= CRUSH_POOFS) breakUpCrowd();
  }

  function breakUpCrowd() {
    poofTimes = [];
    var alive = figs.filter(function (f) { return !f.dead && f.state !== "exit"; });
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

  // Hanging from a rounded corner or pulling up: both hands on the curve, body beside the box.
  function drawHanger(f, t) {
    var g = f.grab;
    var sx = f.x, sy = f.y - SHOULDER;
    var p = { x: g.px, y: g.py };                       // the hands stay on the corner while the body moves
    var kick = f.state === "pull" ? 0.55 * Math.sin(t / 60) : 0.32 * Math.sin(t / 210 + f.id);
    ctx.save();
    pen();
    ctx.beginPath();
    ctx.moveTo(sx, sy); ctx.lineTo(p.x, p.y);
    ctx.moveTo(sx, sy); ctx.lineTo(p.x + g.side * 1.1, p.y + 1.1);
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
    if (f.state === "crawl" || (f.state === "pull" && f.grab && f.grab.k > 0.6) || ((f.state === "fall" || f.state === "slip") && f.lowSlip)) { drawCrawler(f); return; }
    if ((f.state === "hang" || f.state === "pull") && f.grab) { drawHanger(f, t); return; }
    ctx.save();
    ctx.translate(f.x, f.y);
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
  }

  function drawEffects(dt, fade) {
    effects.forEach(function (e) {
      e.t += dt;
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
    }
  }

  /* ---------------- loop ---------------- */

  function frame(t) {
    raf = 0;
    var dt = last ? Math.min(0.05, (t - last) / 1000) * timeScale : 0;
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
    if (enabled && pending > 0 && entryK > 0.6 && now - lastArrival > ARRIVAL_GAP_MS / timeScale) admitOne(now);
    if (dbg) figs.forEach(function (f) { f._px = f.x; f._py = f.y; f._ps = f.state; });
    figs.forEach(function (f) {
      if (f.wave > 0) f.wave -= dt;
      if (f.bounce > 0) f.bounce -= dt;
      if (f.squash > 0) f.squash -= dt;
      if (f.grow > 0) f.grow -= dt;
      var moving = f.state === "climb" || f.state === "exit" || f.state === "crawl" || f.state === "ramp" ||
        (f.state === "walk" && f.wave <= 0);
      if (moving) f.phase += dt * (f.state === "climb" ? 9 : f.state === "crawl" ? 8 : 11);
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
      if (!history.length || now - history[history.length - 1].t > 250) history.push({ t: now, n: figs.length });
      while (history.length > 1 && now - history[1].t >= span) history.shift();
      var then = history[0];
      if (now - then.t >= span && now - lastRelease >= span && figs.length <= then.n && !pending && figs.length < CAP) {
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
    pending = 0;
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
    var alive = figs.filter(function (f) { return !f.dead; });
    if (alive.length + pending >= CAP && alive.length) poofForRoom(alive);
    pending = Math.min(pending + 1, Math.max(1, CAP - alive.length + 1));
    lastArrival = 0;
  }

  function onClick(e) {
    if (!enabled || isInteractive(e.target)) return;
    var f = figureAt(e.clientX, e.clientY);
    if (!f || (f.state !== "walk" && f.state !== "crawl")) return;
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
        poofTimes: function () { return poofTimes; }
      };
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
