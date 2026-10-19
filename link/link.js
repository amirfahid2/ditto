// Ditto web editor — pairs with the iPhone app by QR code and edits its board
// through the zero-knowledge relay. Protocol: ditto-relay/PROTOCOL.md (v1).
import { LinkClient, RelayError, deriveLink, newSecret, pairUrl, b64url, unb64url, pictureNames, PICTURE_NAME } from "./link-core.js";
import { qrSvg } from "./qr.js";

const RELAY = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://localhost:8672" : "https://ditto-relay.ditto-relay.workers.dev";
const STORE_KEY = "ditto.link.v1";
const PAIR_POLL_MS = 2000, PAIR_POLL_LIMIT_MS = 10 * 60 * 1000;
const EDIT_POLL_MS = 10000, SAVE_DELAY_MS = 1500;
const COLORS = ["navy", "teal", "green", "amber", "rose", "purple", "slate"];
const COLOR_NAMES = { navy: "Dark blue", teal: "Teal", green: "Green", amber: "Amber", rose: "Rose", purple: "Purple", slate: "Slate" };

const $ = (id) => document.getElementById(id);
const S = {
  secret: null, link: null, client: null,
  rev: 0, board: [], path: [], selectedId: null,
  dirty: false, saving: false, saveAgain: false, conflict: null,
  last: null, pictures: new Map(), loadingPictures: new Set(),
};
let saveTimer = 0, pollTimer = 0, pairStarted = 0;

// ---------- small helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

let toastTimer = 0;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function setStatus(kind, text) {
  const el = $("status");
  el.hidden = false;
  el.dataset.kind = kind;
  el.textContent = text;
}

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ secret: b64url(S.secret), rev: S.rev })); } catch (e) {}
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "a browser";
  const os = /iPad/.test(ua) ? "iPad" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

const uuid = () => crypto.randomUUID().toUpperCase();
const isBlank = (sq) => !sq.isFolder && !sq.name && !sq.text;
const textCount = (sq) => (sq.items || []).reduce((n, c) => n + (c.isFolder ? textCount(c) : 1), 0);

// Locate a square anywhere in the board -> { sq, list, index, parents }
function find(id, list = S.board, parents = []) {
  for (let i = 0; i < list.length; i++) {
    const sq = list[i];
    if (sq.id === id) return { sq, list, index: i, parents };
    if (sq.isFolder && sq.items) {
      const hit = find(id, sq.items, parents.concat(sq));
      if (hit) return hit;
    }
  }
  return null;
}

function currentFolder() {
  // drop path entries that no longer exist (e.g. deleted on the phone)
  let list = S.board, folder = null;
  const kept = [];
  for (const id of S.path) {
    const next = list.find((sq) => sq.id === id && sq.isFolder);
    if (!next) break;
    kept.push(id);
    folder = next;
    if (!next.items) next.items = [];
    list = next.items;
  }
  S.path = kept;
  return { folder, list };
}

// ---------- pairing ----------
// For a phone whose camera can't scan: Ditto has a Paste button for the same link.
async function copyPairLink() {
  const text = pairUrl(S.secret);
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (e) {
    // older browsers, or a page without clipboard permission
    const area = h("textarea", { readonly: true, style: "position:fixed; opacity:0; top:0; left:0" });
    area.value = text;
    document.body.append(area);
    area.select();
    try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
    area.remove();
  }
  toast(ok ? "Link copied. Paste it in Ditto ▸ Settings ▸ Link to the web." : "Couldn't copy. Scan the code instead.");
}

async function startPairing(fresh) {
  stopPolling();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) {}
  if (!fresh && saved && saved.secret) {
    S.secret = unb64url(saved.secret);
    S.rev = saved.rev || 0;
  } else {
    S.secret = newSecret();
    S.rev = 0;
  }
  S.link = await deriveLink(S.secret);
  S.client = new LinkClient(RELAY, S.link);
  persist();

  // already linked? go straight to the editor
  try {
    const r = await S.client.getBoard();
    if (r.status === "board") return enterEditor(r);
  } catch (e) {
    // a board that will not open was not sealed with this secret: start over.
    // (A network error keeps the saved secret; the QR below then waits for the relay.)
    const unreadable = e.name === "OperationError" || (e instanceof RelayError && e.status === 0);
    if (unreadable && !fresh) return startPairing(true);
  }

  $("editorView").hidden = true;
  $("pairView").hidden = false;
  $("unlinkBtn").hidden = true;
  $("status").hidden = true;
  $("qr").innerHTML = qrSvg(pairUrl(S.secret), { ecl: "M", border: 3, dark: "#16262E" });
  showWaiting(true);
  pairStarted = Date.now();
  pollPairing();
}

function showWaiting(on) {
  $("qrWait").innerHTML = "";
  if (on) {
    $("qrWait").append(h("span", { class: "spinner", "aria-hidden": "true" }), "Waiting for your iPhone…");
  } else {
    $("qrWait").append("Still there? ", h("button", { type: "button", class: "btn-quiet", onclick: () => { pairStarted = Date.now(); showWaiting(true); pollPairing(); } }, "Keep waiting"));
  }
}

async function pollPairing() {
  stopPolling();
  if (Date.now() - pairStarted > PAIR_POLL_LIMIT_MS) return showWaiting(false);
  try {
    const r = await S.client.getBoard();
    if (r.status === "board") return enterEditor(r);
  } catch (e) { /* keep waiting; the relay may be briefly unreachable */ }
  pollTimer = setTimeout(pollPairing, PAIR_POLL_MS);
}

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = 0;
}

// ---------- editor ----------
function enterEditor(remote) {
  applyRemote(remote);
  $("pairView").hidden = true;
  $("editorView").hidden = false;
  $("unlinkBtn").hidden = false;
  setStatus("saved", "Up to date");
  render();
  schedulePoll();
}

function applyRemote(remote) {
  S.board = remote.envelope.board;
  S.rev = remote.rev;
  S.last = { from: remote.envelope.from, device: remote.envelope.device, at: remote.envelope.at };
  S.dirty = false;
  persist();
  if (S.selectedId && !find(S.selectedId)) S.selectedId = null;
  loadPictures();
}

async function loadPictures() {
  const want = [...pictureNames(S.board)].filter((n) => !S.pictures.has(n) && !S.loadingPictures.has(n));
  const queue = want.slice();
  want.forEach((n) => S.loadingPictures.add(n));
  const worker = async () => {
    while (queue.length) {
      const name = queue.shift();
      try {
        const bytes = await S.client.getPicture(name);
        if (bytes) S.pictures.set(name, URL.createObjectURL(new Blob([bytes], { type: name.endsWith(".png") ? "image/png" : "image/jpeg" })));
      } catch (e) { /* shown as a picture-less tile */ }
      S.loadingPictures.delete(name);
      renderGrid();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

function schedulePoll() {
  stopPolling();
  pollTimer = setTimeout(pollEditor, EDIT_POLL_MS);
}

async function pollEditor() {
  if (!document.hidden && !S.dirty && !S.saving && !S.conflict) {
    try {
      const r = await S.client.getBoard(S.rev);
      if (r.status === "board" && !S.dirty && !S.saving) {
        applyRemote(r);
        render();
        toast(`Updated from ${r.envelope.device || "your iPhone"}`);
      } else if (r.status === "none") {
        // the room is gone: unlinked on the phone, or expired
        return unlinked("This browser was unlinked from your iPhone.");
      }
      if (!S.dirty) setStatus("saved", "Up to date");
    } catch (e) {
      setStatus("error", "Can't reach the relay");
    }
  }
  schedulePoll();
}

function markDirty() {
  S.dirty = true;
  setStatus("unsaved", "Not saved yet");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

async function save() {
  if (S.conflict) return;
  if (S.saving) { S.saveAgain = true; return; }
  if (!S.dirty) return;
  S.saving = true;
  S.dirty = false;
  setStatus("saving", "Saving…");
  const snapshot = JSON.parse(JSON.stringify(S.board));
  try {
    const r = await S.client.putBoard(S.rev, snapshot, "web", deviceLabel());
    if (r.ok) {
      S.rev = r.rev;
      S.last = { from: "web", device: deviceLabel(), at: new Date().toISOString() };
      persist();
      if (!S.dirty) setStatus("saved", "Saved");
      renderLastChange();
    } else {
      S.dirty = true;
      await showConflict();
    }
  } catch (e) {
    S.dirty = true;
    setStatus("error", e.status === 413 ? e.message : "Not saved — retrying");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 8000);
  } finally {
    S.saving = false;
    if (S.saveAgain) { S.saveAgain = false; save(); }
  }
}

async function showConflict() {
  try {
    const r = await S.client.getBoard();
    if (r.status !== "board") return unlinked("This browser was unlinked from your iPhone.");
    S.conflict = r;
    $("conflictText").textContent = `${r.envelope.device || "Your iPhone"} changed the board while you were editing.`;
    $("conflict").hidden = false;
    setStatus("unsaved", "Not saved — choose a version");
  } catch (e) {
    setStatus("error", "Can't reach the relay");
    saveTimer = setTimeout(save, 8000);
  }
}

function resolveConflict(keepMine) {
  const remote = S.conflict;
  S.conflict = null;
  $("conflict").hidden = true;
  if (keepMine) {
    S.rev = remote.rev;
    persist();
    markDirty();
    save();
  } else {
    applyRemote(remote);
    setStatus("saved", "Up to date");
    render();
  }
}

function unlinked(message) {
  stopPolling();
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  S.board = []; S.path = []; S.selectedId = null; S.dirty = false;
  toast(message);
  startPairing(true);
}

async function unlink() {
  if (!confirm("Unlink this browser? The copy on our relay is erased. The board on your iPhone stays as it is.")) return;
  try { await S.client.unlink(); } catch (e) { /* the room may already be gone */ }
  unlinked("Unlinked. Your board is still on your iPhone.");
}

// ---------- rendering ----------
function render() {
  // keep the caret in the panel field being typed in when a phone update redraws it
  const active = document.activeElement;
  const focusName = active && active.closest && active.closest("#panel") ? active.getAttribute("name") : null;
  const caret = focusName && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;
  renderCrumbs();
  renderGrid();
  renderPanel();
  renderLastChange();
  const again = focusName && document.querySelector(`#panel [name="${focusName}"]`);
  if (again) {
    again.focus();
    if (caret) try { again.setSelectionRange(...caret); } catch (e) {}
  }
}

function renderLastChange() {
  const el = $("lastChange");
  if (!S.last) { el.textContent = ""; return; }
  const when = S.last.at ? new Date(S.last.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  el.textContent = `Last change from ${S.last.device || (S.last.from === "web" ? "the web" : "your iPhone")}${when ? ", " + when : ""}. Your iPhone picks up changes the next time you open Ditto.`;
}

function renderCrumbs() {
  const nav = $("crumbs");
  nav.textContent = "";
  currentFolder();
  const levels = [{ id: null, name: "Board" }].concat(S.path.map((id) => ({ id, name: find(id).sq.name || "Folder" })));
  levels.forEach((lv, i) => {
    if (i) nav.append(h("span", { class: "sep", "aria-hidden": "true" }, "›"));
    const isLast = i === levels.length - 1;
    const b = h("button", { type: "button", "aria-current": isLast ? "page" : null }, lv.name);
    b.addEventListener("click", () => {
      if (isLast) return;
      S.path = S.path.slice(0, i);
      S.selectedId = lv.id;
      render();
    });
    // drop a square here to move it to this level
    b.addEventListener("dragover", (e) => { if (S.dragId && !isLast) { e.preventDefault(); b.classList.add("drop"); } });
    b.addEventListener("dragleave", () => b.classList.remove("drop"));
    b.addEventListener("drop", (e) => {
      e.preventDefault();
      b.classList.remove("drop");
      if (S.dragId && !isLast) moveTo(S.dragId, lv.id, null);
    });
    nav.append(b);
  });
}

function colorVar(name) {
  return COLORS.includes(name) ? `var(--c-${name})` : null;
}

// Automatic (no "border" key) = the ink-colored ring on every filled square, as on iOS
// (build 46+); empty "…" slots never get one.
function borderColor(sq) {
  if (isBlank(sq)) return null;
  const raw = sq.border == null ? "black" : sq.border;
  if (raw === "none") return null;
  if (raw === "black") return "var(--ink)";
  return colorVar(raw);
}

function tile(sq) {
  const color = colorVar(sq.color);
  const img = typeof sq.image === "string" ? sq.image : "";
  const emoji = img.startsWith("emoji:") ? img.slice(6) : null;
  const file = img.startsWith("file:") ? img.slice(5) : null;
  const showName = sq.showName !== false;
  const label = sq.name || (sq.text || "").slice(0, 12);
  const cls = ["tile"];
  if (sq.isFolder) cls.push("folder");
  if (color) cls.push("colored");
  if (isBlank(sq)) cls.push("blank");
  if (file) cls.push("pic");
  if (S.selectedId === sq.id) cls.push("selected");

  const el = h("button", { type: "button", class: cls.join(" "), draggable: "true", "data-id": sq.id,
    "aria-label": isBlank(sq) ? "Empty square" : (sq.isFolder ? `Folder ${label}` : label) });
  if (color) el.style.background = color;
  const ring = borderColor(sq);
  if (ring) el.append(h("span", { class: "ring", style: `box-shadow: inset 0 0 0 1.5px ${ring}` }));

  if (isBlank(sq)) {
    el.append(h("span", { class: "nm" }, "…"));
  } else if (file) {
    const url = S.pictures.get(file);
    if (url) el.append(h("img", { src: url, alt: "" }));
    else el.append(h("span", { class: "sub" }, S.loadingPictures.has(file) ? "Loading picture…" : "Picture not found"));
    if (showName) el.append(h("span", { class: "cap" }, label + (sq.isFolder ? " ▾" : "")));
  } else {
    if (emoji) el.append(h("span", { class: "emoji" + (showName ? "" : " big") }, emoji));
    if (!emoji || showName) el.append(h("span", { class: "nm" + (label.length > 8 ? " long" : "") }, label));
    if (sq.isFolder) el.append(h("span", { class: "sub" }, `${textCount(sq)} texts ▾`));
  }

  el.addEventListener("click", () => {
    if (sq.isFolder) { S.path.push(sq.id); }
    S.selectedId = sq.id;
    render();
  });

  // drag to rearrange; drop on the middle of a folder to move inside it
  el.addEventListener("dragstart", (e) => {
    S.dragId = sq.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sq.id);
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => { S.dragId = null; renderGrid(); });
  el.addEventListener("dragover", (e) => {
    if (!S.dragId || S.dragId === sq.id) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const mode = sq.isFolder && fx > 0.25 && fx < 0.75 ? "into" : fx < 0.5 ? "before" : "after";
    el.classList.toggle("drag-into", mode === "into");
    el.classList.toggle("drag-before", mode === "before");
    el.classList.toggle("drag-after", mode === "after");
    el.dataset.mode = mode;
  });
  el.addEventListener("dragleave", () => el.classList.remove("drag-into", "drag-before", "drag-after"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    const mode = el.dataset.mode;
    el.classList.remove("drag-into", "drag-before", "drag-after");
    if (!S.dragId || S.dragId === sq.id) return;
    if (mode === "into") return moveTo(S.dragId, sq.id, null);
    const { folder } = currentFolder();
    moveTo(S.dragId, folder ? folder.id : null, { id: sq.id, after: mode === "after" });
  });
  return el;
}

function renderGrid() {
  const grid = $("grid");
  if (!grid) return;
  grid.textContent = "";
  const { list } = currentFolder();
  list.forEach((sq) => grid.append(tile(sq)));
  grid.append(h("button", { type: "button", class: "tile add", onclick: () => addSquare(false) }, "Add square"));
}

// ---------- edits ----------
function addSquare(folder) {
  const { list } = currentFolder();
  const sq = folder
    ? { id: uuid(), name: "New folder", text: "", isFolder: true, items: [] }
    : { id: uuid(), name: "", text: "", isFolder: false, items: [] };
  list.push(sq);
  S.selectedId = sq.id;
  markDirty();
  render();
  const name = document.querySelector("#panel input[name=name]");
  if (name) { name.focus(); name.select(); }
}

// Move a square into folder `folderId` (null = top of the board), next to the square
// `anchor` = { id, after } or, without an anchor, at the end.
function moveTo(id, folderId, anchor) {
  const from = find(id);
  if (!from) return;
  if (folderId && (folderId === id || find(folderId).parents.some((p) => p.id === id))) {
    return toast("A folder can't go inside itself.");
  }
  const destFolder = folderId ? find(folderId).sq : null;
  const dest = destFolder ? (destFolder.items = destFolder.items || []) : S.board;
  from.list.splice(from.index, 1);
  let at = dest.length;
  if (anchor) {
    const i = dest.findIndex((sq) => sq.id === anchor.id);
    if (i >= 0) at = i + (anchor.after ? 1 : 0);
  }
  dest.splice(at, 0, from.sq);
  markDirty();
  render();
  if (!anchor) toast(`Moved to ${destFolder ? destFolder.name || "the folder" : "the board"}`);
}

function setField(sq, key, value) {
  if (value == null || value === "") delete sq[key];
  else sq[key] = value;
  markDirty();
  renderGrid();
  renderCrumbs();
}

async function pickPicture(sq, file) {
  if (!file) return;
  setStatus("saving", "Adding picture…");
  try {
    const { bytes, ext } = await shrinkPicture(file);
    const name = `${uuid()}.${ext}`;
    if (!PICTURE_NAME.test(name)) throw new Error("bad picture name");
    await S.client.putPicture(name, bytes);
    S.pictures.set(name, URL.createObjectURL(new Blob([bytes], { type: ext === "png" ? "image/png" : "image/jpeg" })));
    sq.image = "file:" + name;
    markDirty();
    render();
  } catch (e) {
    setStatus("error", "Picture not added");
    toast(e.status === 413 ? e.message : "That picture couldn't be added.");
  }
}

// Same as the iPhone: at most 400 px on the long side, JPEG 0.85, PNG if it has transparency.
async function shrinkPicture(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 400 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), hgt = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = hgt;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0, w, hgt);
  let alpha = false;
  if (/png|webp|gif|avif/.test(file.type)) {
    const px = ctx.getImageData(0, 0, w, hgt).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { alpha = true; break; }
  }
  const blob = await new Promise((res) => canvas.toBlob(res, alpha ? "image/png" : "image/jpeg", 0.85));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: alpha ? "png" : "jpg" };
}

function firstGrapheme(text) {
  const t = text.trim();
  if (!t) return "";
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    for (const s of new Intl.Segmenter().segment(t)) return s.segment;
  }
  return Array.from(t)[0];
}

// ---------- side panel ----------
function renderPanel() {
  const panel = $("panel");
  panel.textContent = "";
  const hit = S.selectedId ? find(S.selectedId) : null;
  if (!hit) {
    panel.append(
      h("h2", {}, "Edit your board"),
      h("p", { class: "empty" }, "Click a square to change it. Drag squares to rearrange them; drop one on the middle of a folder to put it inside. Changes save by themselves."),
    );
    return;
  }
  const sq = hit.sq;
  const title = sq.isFolder ? "Folder" : isBlank(sq) ? "Empty square" : "Square";
  panel.append(h("h2", {}, title));

  // name
  const name = h("input", { type: "text", name: "name", value: sq.name || "", maxlength: "80", placeholder: sq.isFolder ? "Folder name" : "Shown on the square" });
  name.addEventListener("input", () => { sq.name = name.value; markDirty(); renderGrid(); renderCrumbs(); });
  panel.append(h("label", { class: "field" }, h("span", {}, "Name"), name));

  // text
  if (!sq.isFolder) {
    const text = h("textarea", { name: "text", placeholder: "The text this square copies" });
    text.value = sq.text || "";
    text.addEventListener("input", () => { sq.text = text.value; markDirty(); renderGrid(); });
    panel.append(h("label", { class: "field" }, h("span", {}, "Text"), text,
      h("p", { class: "small" }, "[TODAY], [TOMORROW] and [TIME] become the real date or time when copied.")));
  } else {
    panel.append(h("p", { class: "small" }, `${textCount(sq)} texts inside.`));
    panel.append(h("hr", { class: "divider" }));
  }

  // color
  const colors = h("div", { class: "swatches", role: "group", "aria-label": "Color" });
  const colorBtn = (value, label, style, cls) => h("button", {
    type: "button", class: "sw " + (cls || ""), title: label, "aria-label": label, style,
    "aria-pressed": String((sq.color || null) === value),
    onclick: () => { setField(sq, "color", value); renderPanel(); },
  });
  colors.append(colorBtn(null, sq.isFolder ? "Folder blue" : "Plain", sq.isFolder ? "background: var(--folder)" : null, "plain"));
  COLORS.forEach((c) => colors.append(colorBtn(c, COLOR_NAMES[c], `background: var(--c-${c})`)));
  panel.append(h("div", { class: "field" }, h("span", { class: "label" }, "Color"), colors));

  // border
  const borders = h("div", { class: "swatches", role: "group", "aria-label": "Border" });
  const borderBtn = (value, label, style, cls, content) => h("button", {
    type: "button", class: "sw " + (cls || ""), title: label, "aria-label": label, style,
    "aria-pressed": String((sq.border == null ? null : sq.border) === value),
    onclick: () => { setField(sq, "border", value); renderPanel(); },
  }, content || null);
  borders.append(borderBtn(null, "Automatic", null, "txt", "Auto"));
  borders.append(borderBtn("none", "No border", null, "txt", "None"));
  borders.append(borderBtn("black", "Black", "box-shadow: inset 0 0 0 3px var(--ink)", "ring"));
  COLORS.forEach((c) => borders.append(borderBtn(c, COLOR_NAMES[c] + " border", `box-shadow: inset 0 0 0 3px var(--c-${c})`, "ring")));
  panel.append(h("div", { class: "field" }, h("span", { class: "label" }, "Border"), borders));

  // picture: emoji or photo
  const img = typeof sq.image === "string" ? sq.image : "";
  const emoji = h("input", { type: "text", value: img.startsWith("emoji:") ? img.slice(6) : "", placeholder: "🙂", "aria-label": "Emoji" });
  emoji.addEventListener("change", () => {
    const g = firstGrapheme(emoji.value);
    emoji.value = g;
    setField(sq, "image", g ? "emoji:" + g : (img.startsWith("emoji:") ? null : sq.image));
    renderPanel();
  });
  const fileInput = h("input", { type: "file", accept: "image/*", hidden: true });
  fileInput.addEventListener("change", () => pickPicture(sq, fileInput.files[0]));
  const row = h("div", { class: "row" }, emoji,
    h("button", { type: "button", class: "btn-quiet", onclick: () => fileInput.click() }, img.startsWith("file:") ? "Change photo" : "Add photo"),
    img ? h("button", { type: "button", class: "btn-quiet", onclick: () => { setField(sq, "image", null); delete sq.showName; renderPanel(); } }, "Remove") : null,
    fileInput);
  const pictureField = h("div", { class: "field" }, h("span", { class: "label" }, "Picture"), row);
  if (img) {
    const cb = h("input", { type: "checkbox" });
    cb.checked = sq.showName !== false;
    cb.addEventListener("change", () => { setField(sq, "showName", cb.checked ? null : false); });
    pictureField.append(h("label", { class: "check" }, cb, "Show the name with the picture"));
  }
  panel.append(pictureField);

  // arrange
  const { list, index } = hit;
  const folders = [{ id: "", name: "Board (top level)" }];
  (function collect(items, depth) {
    for (const f of items) {
      if (!f.isFolder || f.id === sq.id) continue;
      folders.push({ id: f.id, name: "  ".repeat(depth) + "› " + (f.name || "Folder") });
      collect(f.items || [], depth + 1);
    }
  })(S.board, 1);
  const here = hit.parents.length ? hit.parents[hit.parents.length - 1].id : "";
  const move = h("select", { "aria-label": "Move to folder" }, folders.map((f) => {
    const o = h("option", { value: f.id }, f.name);
    if (f.id === here) o.selected = true;
    return o;
  }));
  move.addEventListener("change", () => {
    moveTo(sq.id, move.value || null, null);
    S.path = find(sq.id).parents.map((p) => p.id);
    render();
  });
  panel.append(h("div", { class: "field" }, h("span", { class: "label" }, "Arrange"),
    h("div", { class: "row" },
      h("button", { type: "button", class: "btn-quiet", disabled: index === 0, onclick: () => { list.splice(index, 1); list.splice(index - 1, 0, sq); markDirty(); render(); } }, "← Earlier"),
      h("button", { type: "button", class: "btn-quiet", disabled: index === list.length - 1, onclick: () => { list.splice(index, 1); list.splice(index + 1, 0, sq); markDirty(); render(); } }, "Later →")),
    h("label", { class: "field", style: "margin: 10px 0 0" }, h("span", {}, "Move to"), move)));

  // clear / delete
  panel.append(h("hr", { class: "divider" }));
  const danger = h("div", { class: "row" });
  if (!sq.isFolder && !isBlank(sq)) {
    danger.append(h("button", { type: "button", class: "btn-quiet", onclick: () => {
      sq.name = ""; sq.text = ""; delete sq.color; delete sq.border; delete sq.image; delete sq.showName;
      markDirty(); render();
    } }, "Clear to “…”"));
  }
  danger.append(h("button", { type: "button", class: "btn-quiet btn-danger", onclick: () => {
    const n = sq.isFolder ? textCount(sq) : 0;
    const msg = sq.isFolder ? `Delete the folder “${sq.name || "Folder"}”${n ? ` and the ${n} texts inside it` : ""}?` : "Delete this square?";
    if (!confirm(msg)) return;
    list.splice(index, 1);
    if (S.path.includes(sq.id)) S.path = S.path.slice(0, S.path.indexOf(sq.id));
    S.selectedId = null;
    markDirty();
    render();
  } }, sq.isFolder ? "Delete folder" : "Delete"));
  panel.append(danger);
}

// ---------- start ----------
$("newCodeBtn").addEventListener("click", () => startPairing(true));
$("copyLinkBtn").addEventListener("click", copyPairLink);
$("unlinkBtn").addEventListener("click", unlink);
$("addSquareBtn").addEventListener("click", () => addSquare(false));
$("addFolderBtn").addEventListener("click", () => addSquare(true));
$("useRemoteBtn").addEventListener("click", () => resolveConflict(false));
$("keepMineBtn").addEventListener("click", () => resolveConflict(true));
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("editorView").hidden) pollEditor(); });
window.addEventListener("beforeunload", (e) => { if (S.dirty || S.saving) { e.preventDefault(); e.returnValue = ""; } });

startPairing(false);
