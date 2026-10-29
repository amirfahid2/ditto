// The shared-board page (dittotap.com/b/#d1=…): reads the board from the link, shows it in
// the Ditto look, and copies a square's text when it's tapped. Nothing is sent anywhere:
// the page's Content-Security-Policy allows no connections at all.
//
// Square names and texts only ever reach the page through textContent.

import { decodeBoardLink, BoardLinkError, ERRORS, countLine, labelFor, folderCaption, textStart, substituteTokens } from "./board.js";
import { qrEncode } from "../link/qr.js";

const $ = (id) => document.getElementById(id);
const grid = $("grid");
const titleEl = $("title"), countEl = $("count"), hintEl = $("hint"), noticeEl = $("notice"), errBody = $("errBody");
const openRow = $("openRow"), openBtn = $("openBtn");
const qrCard = $("qrCard"), qrBox = $("qr"), qrNote = $("qrNote"), copyLinkBtn = $("copyLinkBtn");
const toastEl = $("toast");

const SHARED_TITLE = "A Ditto board was shared with you";
const QR_NOTE = "Point your iPhone's camera at the code to open this board there.";
const QR_TOO_LONG = "This board is too big for a QR code. Copy the link and send it to yourself, then open it on your phone.";

let board = null;   // the normalized squares, or null while loading or after an error
let path = [];      // the open folders: path[0] indexes the board, path[1] that folder's items, …
let cols = 3;
let loadSeq = 0;
let status = "loading";   // "ok", or the error code

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

/* ---------- toast ---------- */

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.classList.remove("show"); }, 1800);
}

/* ---------- copy (the web app's way: the clipboard API, then the old text-box trick) ---------- */

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.className = "copy-box";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { ta.setSelectionRange(0, ta.value.length); } catch (e) { /* older browsers */ }
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

// Called straight from the tap, so the browser counts it as the person's own action.
function copyText(text, from) {
  const back = () => { if (from && document.contains(from)) from.focus({ preventScroll: true }); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true, () => {
      const ok = fallbackCopy(text);
      back();
      return ok;
    });
  }
  const ok = fallbackCopy(text);
  back();
  return Promise.resolve(ok);
}

function flash(el) {
  el.classList.remove("flash");
  void el.offsetWidth;   // restart the animation on a quick second tap
  el.classList.add("flash");
  setTimeout(() => { el.classList.remove("flash"); }, 650);
}

function copySquare(sq, el) {
  const label = textStart(labelFor(sq), 28);
  if (!sq.text) { showToast("“" + label + "” has no text to copy"); return; }
  copyText(substituteTokens(sq.text), el).then((ok) => {
    if (ok) { flash(el); showToast("Copied “" + label + "”"); }
    else showToast("Couldn't copy. Try tapping again.");
  });
}

/* ---------- squares ---------- */

function squareEl(sq, expanded) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sq";
  const label = labelFor(sq);
  if (sq.isFolder) b.classList.add("folder");
  if (sq.color) b.classList.add("colored", "c-" + sq.color);   // a whitelisted name (board.js)
  if (!sq.isFolder && !sq.text) b.classList.add("empty-text");

  // the automatic border is the ink-colored ring every filled square has on the iPhone
  const border = sq.border || "black";
  if (border !== "none") {
    const ring = document.createElement("span");
    ring.className = "ring ring-" + (border === "black" ? "ink" : border);
    b.appendChild(ring);
  }
  const emoji = sq.image ? sq.image.slice(6) : "";
  const showName = !(emoji && sq.showName === false);
  if (emoji) {
    const e = document.createElement("div");
    e.className = "emoji" + (showName ? "" : " big");
    e.setAttribute("aria-hidden", "true");
    e.textContent = emoji;
    b.appendChild(e);
  }
  if (showName) {
    const n = document.createElement("div");
    n.className = "name";
    n.dir = "auto";
    n.textContent = label;
    if (Array.from(label).length > 8) n.classList.add("long");
    b.appendChild(n);
  }
  if (sq.isFolder) {
    const cap = document.createElement("div");
    cap.className = "fcap";
    cap.setAttribute("aria-hidden", "true");
    cap.textContent = folderCaption(sq) + (expanded ? " ▴" : " ▾");
    b.appendChild(cap);
    b.setAttribute("aria-expanded", String(!!expanded));
    if (expanded) b.setAttribute("aria-controls", "folderPanel");
    b.setAttribute("aria-label", "Folder " + label + ", " + folderCaption(sq).toLowerCase());
  } else {
    b.setAttribute("aria-label", sq.text ? "Copy " + label : label + ", no text to copy");
  }
  return b;
}

function currentCols() {
  return parseInt(getComputedStyle(grid).getPropertyValue("--cols"), 10) || 3;
}

// The folders along `path`, outermost first.
function openChain() {
  const chain = [];
  let list = board;
  for (const i of path) {
    const f = list[i];
    if (!f || !f.isFolder) break;
    chain.push(f);
    list = f.items || [];
  }
  return chain;
}

// focus: { top: i } | { item: j } | { panel: "first" | "back" } | undefined
function render(focus) {
  grid.textContent = "";
  cols = currentCols();
  const chain = openChain();
  if (chain.length !== path.length) path = path.slice(0, chain.length);

  board.forEach((sq, i) => {
    const el = squareEl(sq, sq.isFolder && path[0] === i);
    el.addEventListener("click", () => onTopTap(i, el));
    grid.appendChild(el);
  });

  let panel = null;
  if (chain.length) {
    panel = buildPanel(chain);
    const after = grid.children[Math.floor(path[0] / cols) * cols + cols] || null;   // after the folder's row
    grid.insertBefore(panel, after);
  }

  let target = null;
  if (focus && focus.top != null) target = grid.children[focus.top] || null;
  if (focus && panel && focus.item != null) target = panel.querySelectorAll(".folder-grid > .sq")[focus.item] || null;
  if (focus && panel && focus.panel) {
    target = focus.panel === "first" ? panel.querySelector(".folder-grid > .sq") : null;
    if (!target) target = panel.querySelector(".panel-btn");
  }
  if (target) target.focus({ preventScroll: true });
  if (panel && focus && focus.reveal) {
    panel.scrollIntoView({ block: "nearest", behavior: reduceMotion.matches ? "auto" : "smooth" });
  }
}

function buildPanel(chain) {
  const folder = chain[chain.length - 1];
  const label = labelFor(folder);
  const panel = document.createElement("div");
  panel.className = "folder-panel";
  panel.id = "folderPanel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Folder " + label);

  const head = document.createElement("div");
  head.className = "panel-head";
  if (chain.length > 1) {
    const parent = labelFor(chain[chain.length - 2]);
    const back = document.createElement("button");
    back.type = "button";
    back.className = "panel-btn";
    back.dir = "auto";
    back.textContent = "‹ " + textStart(parent, 18);
    back.setAttribute("aria-label", "Back to " + parent);
    back.addEventListener("click", () => {
      const from = path.pop();
      render({ item: from });
    });
    head.appendChild(back);
  }
  const title = document.createElement("div");
  title.className = "panel-title";
  title.dir = "auto";
  title.textContent = label;
  head.appendChild(title);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "panel-btn close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close folder");
  close.addEventListener("click", () => {
    const top = path[0];
    path = [];
    render({ top });
  });
  head.appendChild(close);
  panel.appendChild(head);

  const items = folder.items || [];
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "folder-empty";
    p.textContent = "This folder is empty.";
    panel.appendChild(p);
    return panel;
  }
  const inner = document.createElement("div");
  inner.className = "folder-grid";
  items.forEach((sq, j) => {
    const el = squareEl(sq, false);
    el.addEventListener("click", () => {
      if (sq.isFolder) {
        path.push(j);
        render({ panel: "first", reveal: true });
      } else {
        copySquare(sq, el);
      }
    });
    inner.appendChild(el);
  });
  panel.appendChild(inner);
  return panel;
}

// Escape goes back out of a folder, one level at a time.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !board || !path.length) return;
  e.preventDefault();
  const from = path.pop();
  render(path.length ? { item: from } : { top: from });
});

function onTopTap(i, el) {
  const sq = board[i];
  if (!sq.isFolder) { copySquare(sq, el); return; }
  const opening = path[0] !== i;
  path = opening ? [i] : [];
  render({ top: i, reveal: opening });
}

/* ---------- open it elsewhere ---------- */

function onComputer() {
  return !matchMedia("(pointer: coarse)").matches || matchMedia("(min-width: 900px)").matches;
}

function qrSvg(text) {
  let q;
  try { q = qrEncode(text, "M"); } catch (e) { q = qrEncode(text, "L"); }   // throws when too long
  const border = 4, n = q.size + border * 2;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + n + " " + n);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", String(n));
  bg.setAttribute("height", String(n));
  bg.setAttribute("fill", "#FFFFFF");
  svg.appendChild(bg);
  let d = "";
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) {
    if (q.dark(x, y)) d += "M" + (x + border) + "," + (y + border) + "h1v1h-1z";
  }
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "#000000");
  svg.appendChild(p);
  return { svg, size: q.size };
}

let qrFor = null;
function updateQr() {
  const show = (status === "ok" || status === "newer" || status === "unsupported") && onComputer();
  qrCard.hidden = !show;
  if (!show || qrFor === location.href) return;
  qrFor = location.href;
  qrBox.textContent = "";
  qrBox.classList.remove("big");
  try {
    const { svg, size } = qrSvg(location.href);
    qrBox.appendChild(svg);
    if (size > 90) qrBox.classList.add("big");
    qrBox.hidden = false;
    qrNote.textContent = QR_NOTE;
  } catch (e) {
    qrBox.hidden = true;
    qrNote.textContent = QR_TOO_LONG;
  }
}

function updateActions() {
  // The app reads the same link; worth a try even when this page can't open it.
  const canOpen = status === "ok" || status === "newer" || status === "unsupported";
  openRow.hidden = !canOpen;
  openBtn.href = "dittotap://b" + location.hash;
  updateQr();
}

copyLinkBtn.addEventListener("click", () => {
  copyText(location.href, copyLinkBtn).then((ok) => {
    showToast(ok ? "Link copied" : "Couldn't copy. Try again.");
  });
});

/* ---------- loading the board from the link ---------- */

function showBoard(res) {
  board = res.board;
  path = [];
  status = "ok";
  titleEl.textContent = SHARED_TITLE;
  countEl.textContent = countLine(res.squares, res.folders);
  countEl.hidden = false;
  hintEl.hidden = false;
  errBody.hidden = true;
  const notes = [];
  if (res.truncated.count) notes.push("This board is very big, so only its first 5,000 squares are here.");
  if (res.truncated.depth) notes.push("Folders nested more than 16 deep were left out.");
  noticeEl.textContent = notes.join(" ");
  noticeEl.hidden = !notes.length;
  render();
}

function showError(code) {
  const msg = ERRORS[code] || ERRORS.broken;
  board = null;
  path = [];
  status = code;
  grid.textContent = "";
  titleEl.textContent = msg.title;
  errBody.textContent = msg.body;
  errBody.hidden = false;
  countEl.hidden = true;
  hintEl.hidden = true;
  noticeEl.hidden = true;
}

async function load() {
  const seq = ++loadSeq;
  board = null;
  path = [];
  status = "loading";
  grid.textContent = "";
  titleEl.textContent = SHARED_TITLE;
  countEl.textContent = "Opening the board…";
  countEl.hidden = false;
  hintEl.hidden = true;
  noticeEl.hidden = true;
  errBody.hidden = true;
  updateActions();
  let res = null, code = null;
  try {
    res = await decodeBoardLink(location.hash);
  } catch (e) {
    code = e instanceof BoardLinkError ? e.code : "broken";
  }
  if (seq !== loadSeq) return;   // a newer link arrived meanwhile
  if (res) showBoard(res);
  else showError(code);
  updateActions();
}

window.addEventListener("hashchange", () => {
  window.scrollTo(0, 0);
  load();
});

let resizeQueued = false;
window.addEventListener("resize", () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    if (board && path.length && currentCols() !== cols) render();
    updateQr();
  });
});

load();
