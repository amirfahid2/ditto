// "Use my iPhone's squares" for the web app at dittotap.com: when this browser is linked
// (dittotap.com/link) and the option is on, the web app shows the iPhone's board instead of
// its own. Taps copy, as on the phone; edits go back to the phone through the relay
// (ditto-relay/PROTOCOL.md v1), sealed with the same key as the /link editor.
import { LinkClient, deriveLink, unb64url, pictureNames } from "./link-core.js";

const RELAY = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://localhost:8672" : "https://ditto-relay.ditto-relay.workers.dev";
export const LINK_KEY = "ditto.link.v1";
export const USE_KEY = "ditto.link.useOnSite";
const POLL_MS = 10000, SAVE_DELAY_MS = 800, RETRY_MS = 8000;
const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

export function deviceLabel() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "a browser";
  const os = /iPad/.test(ua) ? "iPad" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function savedLink() {
  try {
    const saved = JSON.parse(localStorage.getItem(LINK_KEY) || "null");
    return saved && saved.secret ? saved : null;
  } catch (e) { return null; }
}

// linked = the iPhone has connected at least once (opening /link saves a code before any scan)
export const isLinked = () => { const s = savedLink(); return !!(s && s.rev > 0); };

const clone = (o) => JSON.parse(JSON.stringify(o));
const phoneBlank = (sq) => !sq.isFolder && !sq.name && !sq.text;

// ---------- the iPhone board <-> the web app's squares ----------
// The web app knows text squares, "…" blanks and folders of texts one level deep, each with the
// same looks as on the phone (color, border, emoji or picture, name shown or not). What it
// doesn't show (folders inside folders, blanks inside folders) is kept from the phone's copy,
// matched by id, when the board goes back.
export const LOOKS = ["color", "border", "image", "showName"];

function withLooks(out, sq) {
  LOOKS.forEach((k) => { if (sq[k] != null) out[k] = sq[k]; });
  return out;
}

function webSquare(sq) {
  if (sq.isFolder) {
    return withLooks({ id: sq.id, type: "folder", name: sq.name || "", items: (sq.items || []).filter(shownInFolder).map(webSquare) }, sq);
  }
  if (phoneBlank(sq)) return { id: sq.id };
  return withLooks({ id: sq.id, name: sq.name || "", text: sq.text || "" }, sq);
}

// A folder on the web app holds texts only: blanks and folders inside it stay on the phone.
const shownInFolder = (sq) => !sq.isFolder && !phoneBlank(sq);

export function toWeb(board) {
  const originals = new Map();
  (function index(list) {
    for (const sq of list || []) { originals.set(sq.id, sq); if (sq.isFolder) index(sq.items); }
  })(board);
  return { squares: (board || []).map(webSquare), originals };
}

export function toPhone(squares, originals) {
  return squares.map((sq) => phoneSquare(sq, originals));
}

function phoneSquare(sq, originals) {
  const orig = originals.get(sq.id);
  const out = orig ? clone(orig) : { id: sq.id, name: "", text: "", isFolder: false, items: [] };
  if (!UUID.test(out.id)) out.id = crypto.randomUUID().toUpperCase();   // the phone only reads UUIDs
  const looks = () => LOOKS.forEach((k) => { if (sq[k] != null) out[k] = sq[k]; else delete out[k]; });
  if (sq.type === "folder") {
    out.isFolder = true;
    out.name = sq.name || "";
    out.text = out.text || "";
    out.items = mergeItems(sq.items.map((it) => phoneSquare(it, originals)), orig && orig.isFolder ? orig.items || [] : []);
    looks();
  } else if (sq.name || sq.text) {
    out.isFolder = false;
    out.name = sq.name || "";
    out.text = sq.text || "";
    if (!orig || orig.isFolder) out.items = [];
    looks();
  } else if (!orig || !phoneBlank(orig)) {
    // cleared to "…" here: the same as Clear on the phone
    Object.assign(out, { name: "", text: "", isFolder: false, items: [] });
    delete out.color; delete out.border; delete out.image; delete out.showName;
  }
  return out;
}

// The folder's texts in the web app's order, with what it doesn't show (blanks, folders inside
// the folder) left where they were.
function mergeItems(shown, before) {
  const out = [], queue = shown.slice();
  for (const sq of before) {
    if (!shownInFolder(sq)) out.push(sq);
    else if (queue.length) out.push(queue.shift());
  }
  return out.concat(queue);
}

// [TODAY], [TOMORROW] and [TIME] become the real date or time when copied, as on the iPhone.
export function substituteTokens(text) {
  if (!text || text.indexOf("[") < 0) return text;
  const now = new Date(), tomorrow = new Date(now.getTime() + 864e5);
  const day = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return text.split("[TODAY]").join(day(now)).split("[TOMORROW]").join(day(tomorrow))
    .split("[TIME]").join(now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
}

// ---------- the live connection ----------
// hooks: busy() -> true while the web app is mid-edit (a sheet open, a drag); remote(squares,
// device) when the phone's board changed; status(kind, text); conflict(device); unlinked();
// pictures() when pictures have loaded.
export async function openPhoneBoard(hooks) {
  const saved = savedLink();
  if (!saved) return { error: "unlinked" };
  const link = await deriveLink(unb64url(saved.secret));
  const client = new LinkClient(RELAY, link);
  let first;
  try {
    first = await client.getBoard();
  } catch (e) {
    return { error: e.name === "OperationError" ? "unlinked" : "offline" };
  }
  if (first.status !== "board") return { error: "unlinked" };

  const P = {
    rev: first.rev, board: first.envelope.board, originals: null, squares: null,
    pending: null, saving: false, conflict: null, pictures: new Map(), loading: new Set(),
  };
  let saveTimer = 0, pollTimer = 0, stopped = false;
  ({ squares: P.squares, originals: P.originals } = toWeb(P.board));

  function persist() {
    try { localStorage.setItem(LINK_KEY, JSON.stringify(Object.assign(savedLink() || {}, { rev: P.rev }))); } catch (e) {}
  }

  function adopt(r) {
    P.rev = r.rev;
    P.board = r.envelope.board;
    ({ squares: P.squares, originals: P.originals } = toWeb(P.board));
    persist();
    loadPictures();
  }

  async function loadPictures() {
    const want = [...pictureNames(P.board)].filter((n) => !P.pictures.has(n) && !P.loading.has(n));
    for (const name of want) {
      P.loading.add(name);
      try {
        const bytes = await client.getPicture(name);
        if (bytes) P.pictures.set(name, URL.createObjectURL(new Blob([bytes], { type: name.endsWith(".png") ? "image/png" : "image/jpeg" })));
      } catch (e) { /* shown without its picture */ }
      P.loading.delete(name);
    }
    if (want.length && !stopped) hooks.pictures();
  }

  async function poll() {
    clearTimeout(pollTimer);
    if (stopped) return;
    if (!document.hidden && !P.pending && !P.saving && !P.conflict && !hooks.busy()) {
      try {
        const r = await client.getBoard(P.rev);
        if (r.status === "none") return gone();
        if (r.status === "board" && !P.pending && !P.saving && !hooks.busy()) {
          adopt(r);
          hooks.remote(P.squares, r.envelope.device || "your iPhone");
        }
        hooks.status("ok", "");
      } catch (e) {
        hooks.status("error", "Can't reach your iPhone's squares right now.");
      }
    }
    pollTimer = setTimeout(poll, POLL_MS);
  }

  function gone() {
    stop();
    try { localStorage.removeItem(USE_KEY); } catch (e) {}
    hooks.unlinked();
  }

  async function save() {
    clearTimeout(saveTimer);
    if (stopped || P.conflict || !P.pending) return;
    if (P.saving) { saveTimer = setTimeout(save, 300); return; }
    const board = toPhone(P.pending, P.originals);
    P.pending = null;
    P.saving = true;
    hooks.status("saving", "Saving to your iPhone's squares…");
    try {
      const r = await client.putBoard(P.rev, board, "web", deviceLabel());
      if (r.ok) {
        P.rev = r.rev;
        P.board = board;
        P.originals = toWeb(board).originals;
        persist();
        hooks.status("ok", "Saved. Your iPhone picks it up the next time you open Ditto.");
      } else {
        P.pending = P.pending || P.squares;
        const latest = await client.getBoard();
        if (latest.status !== "board") return gone();
        P.conflict = latest;
        hooks.conflict(latest.envelope.device || "Your iPhone");
      }
    } catch (e) {
      P.pending = P.pending || P.squares;
      hooks.status("error", e.status === 413 ? e.message : "Not saved yet: can't reach the relay. Trying again…");
      saveTimer = setTimeout(save, RETRY_MS);
    } finally {
      P.saving = false;
    }
  }

  function stop() {
    stopped = true;
    clearTimeout(saveTimer);
    clearTimeout(pollTimer);
    document.removeEventListener("visibilitychange", onVisible);
  }

  function onVisible() { if (!document.hidden) poll(); }
  document.addEventListener("visibilitychange", onVisible);
  pollTimer = setTimeout(poll, POLL_MS);
  loadPictures();

  return {
    get squares() { return P.squares; },

    // The web app changed the board (it calls this from its own save).
    changed(squares) {
      P.squares = squares;
      P.pending = squares;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, SAVE_DELAY_MS);
    },

    // After a conflict: keep this page's version (written over the phone's), or take the phone's.
    resolve(keepMine) {
      const latest = P.conflict;
      P.conflict = null;
      if (!latest) return;
      if (keepMine) {
        P.rev = latest.rev;
        // squares that only the phone knows about (added there meanwhile) keep their looks
        for (const [id, sq] of toWeb(latest.envelope.board).originals) if (!P.originals.has(id)) P.originals.set(id, sq);
        P.pending = P.squares;
        save();
      } else {
        P.pending = null;
        adopt(latest);
        hooks.remote(P.squares, latest.envelope.device || "your iPhone");
        hooks.status("ok", "");
      }
    },

    // Turning the option off: send what is still waiting, then stop.
    async finish() {
      clearTimeout(saveTimer);
      while (P.saving) await new Promise((r) => setTimeout(r, 100));
      if (P.pending && !P.conflict) await save();
      stop();
    },

    unsaved() { return !!(P.pending || P.saving); },

    // A picture on the phone's board ("file:NAME"), decrypted: an object URL, or null while loading.
    pictureUrl(name) { return P.pictures.get(name) || null; },

    // A new picture for a square: sealed and uploaded first, like the /link editor does.
    async addPicture(bytes, ext) {
      const name = `${crypto.randomUUID().toUpperCase()}.${ext}`;
      await client.putPicture(name, bytes);
      P.pictures.set(name, URL.createObjectURL(new Blob([bytes], { type: ext === "png" ? "image/png" : "image/jpeg" })));
      return "file:" + name;
    },

    stop,
  };
}
