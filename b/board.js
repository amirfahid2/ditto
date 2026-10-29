// Shared-board links (BOARD-LINK.md in the iPhone app's repo).
//
//   dittotap.com/b/#d1=<payload>
//   payload = base64url (no "=") of raw DEFLATE of {"v":1,"board":[ <square>, ... ]}
//
// Pure functions only: no DOM and no network, so Node can test them (board.test.mjs).
// The board never leaves the page: it is read from location.hash, which browsers never send.

export const LIMITS = Object.freeze({
  payloadChars: 200000,   // the "d1=" value, in characters
  jsonBytes: 2000000,     // inflated JSON; inflating stops past this (no zip bombs)
  squares: 5000,          // every kept entry, folders included, in the order they appear
  depth: 16,              // a top-level folder is depth 1; a folder at depth 16 is kept, but empty
});

// Room for what messengers add at the end of a link (see parseHash), on top of the payload.
const HASH_SLACK = 64;

export const COLORS = Object.freeze(["navy", "teal", "green", "amber", "rose", "purple", "slate"]);
const BORDERS = ["none", "black"].concat(COLORS);

// What the page says for each way a link can fail.
export const ERRORS = Object.freeze({
  none: {
    title: "There's no board in this link",
    body: "Ask the person who shared it to send the whole link again.",
  },
  broken: {
    title: "This link looks cut off. Ask for it again.",
    body: "Part of the board is missing, so it can't be opened. Some apps shorten long links; the person who shared it can send it again, or send the board as a file.",
  },
  newer: {
    title: "This board needs a newer Ditto",
    body: "It was shared from a newer version of Ditto. Reload this page, or open the board in the latest Ditto app.",
  },
  "too-big": {
    title: "This board is too big to open here",
    body: "Ask the person who shared it to uncheck some folders and share it again, or to send the board as a file.",
  },
  unsupported: {
    title: "Update your browser to open this board",
    body: "This browser can't unpack shared boards. Update it, or open the link in a current Safari, Chrome or Firefox.",
  },
  empty: {
    title: "This shared board is empty",
    body: "There are no squares in it. Ask the person who shared it to check what they picked.",
  },
});

export class BoardLinkError extends Error {
  constructor(code, cause) {
    super((ERRORS[code] && ERRORS[code].title) || code);
    this.name = "BoardLinkError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

// ---------- the link ----------

const B64 = new Int16Array(128).fill(-1);
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".split("").forEach((c, i) => { B64[c.charCodeAt(0)] = i; });

// "#d1=…" -> { version: "1", payload: "…" }, or null when there is no board in it.
// Linear time on any input (no backtracking regex over the payload).
export function parseHash(hash) {
  let frag = String(hash == null ? "" : hash);
  if (frag.charAt(0) === "#") frag = frag.slice(1);
  try { frag = decodeURIComponent(frag); } catch (e) { /* a stray "%" is caught below */ }
  const m = /^d(\d{1,6})=/.exec(frag);
  if (!m) return null;
  // Tolerate what messengers sometimes add at the very end (a period, "=" padding, a space,
  // an "&…" of their own).
  let p = frag.slice(m[0].length);
  const amp = p.indexOf("&");
  if (amp >= 0) p = p.slice(0, amp);
  let end = p.length;
  while (end > 0) {
    const c = p.charCodeAt(end - 1);
    if (c < 128 && B64[c] >= 0) break;
    end--;
  }
  return { version: m[1], payload: p.slice(0, end) };
}

// Longer than any link this page would read: refused before anything else looks at it.
export function hashTooLong(hash, limits = LIMITS) {
  return String(hash == null ? "" : hash).length > limits.payloadChars + HASH_SLACK;
}

// The link as the app reads it: "#d1=<payload>" without what parseHash ignores, or "" when
// there is no board in it. Open in Ditto, the QR code and Copy link use this (the app refuses
// anything outside the base64url alphabet). banner.js has its own copy for the Smart App Banner.
export function cleanHash(hash, limits = LIMITS) {
  if (hashTooLong(hash, limits)) return "";
  const link = parseHash(hash);
  return link ? "#d" + link.version + "=" + link.payload : "";
}

// base64url (no padding) -> bytes. Anything outside the alphabet means a broken link.
export function base64urlToBytes(s) {
  const n = s.length;
  if (n === 0 || n % 4 === 1) throw new BoardLinkError("broken");
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0, acc = 0, bits = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64[c] : -1;
    if (v < 0) throw new BoardLinkError("broken");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

// Raw DEFLATE -> bytes, read chunk by chunk, giving up as soon as the output passes maxBytes.
// The input goes in 1 KB at a time. A browser's DecompressionStream only takes the next piece
// once its output has been read, so even a zip bomb (DEFLATE grows 1 KB into about 1 MB)
// never has more than about a megabyte waiting; Node's inflates only as it's read.
const SLICE = 1024;

export async function inflateRawLimited(bytes, maxBytes = LIMITS.jsonBytes, DS = globalThis.DecompressionStream) {
  if (typeof DS !== "function") throw new BoardLinkError("unsupported");
  let ds;
  try { ds = new DS("deflate-raw"); } catch (e) { throw new BoardLinkError("unsupported", e); }
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  let stopped = false;
  const feed = (async () => {
    for (let i = 0; i < bytes.length && !stopped; i += SLICE) {
      await writer.write(bytes.slice(i, i + SLICE));   // a copy: a stream may take ownership of it
    }
    if (!stopped) await writer.close();
  })();
  feed.catch(() => {});   // a failed write also fails the reader, which is where it's reported

  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      let r;
      try { r = await reader.read(); } catch (e) { throw new BoardLinkError("broken", e); }
      if (r.done) break;
      total += r.value.byteLength;
      if (total > maxBytes) {
        const err = new BoardLinkError("too-big");
        err.inflated = total;
        throw err;
      }
      chunks.push(r.value);
    }
  } catch (e) {
    stopped = true;
    reader.cancel().catch(() => {});
    writer.abort().catch(() => {});
    throw e;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

// ---------- the board ----------

const EMOJI_CHARS = /^[\p{Emoji}\p{Emoji_Component}\p{Extended_Pictographic}‍︎️⃣]+$/u;
const EMOJI_CORE = /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;
let segmenter = null;
try { segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" }); } catch (e) { segmenter = null; }

// Only "emoji:<one emoji>". Pictures ("file:…") never travel in links.
export function isEmojiImage(image) {
  if (typeof image !== "string" || image.indexOf("emoji:") !== 0) return false;
  const e = image.slice(6);
  if (e.length === 0 || e.length > 32) return false;
  if (!EMOJI_CHARS.test(e) || !EMOJI_CORE.test(e)) return false;
  if (segmenter) {
    let n = 0;
    for (const _ of segmenter.segment(e)) { if (++n > 1) return false; }
  }
  return true;
}

function str(v) { return typeof v === "string" ? v : ""; }

// A square worth keeping: an object that is a folder, or has a name or a text.
function isEntry(it) {
  if (!it || typeof it !== "object" || Array.isArray(it)) return false;
  return it.isFolder === true || !!str(it.name) || !!str(it.text);
}

// The link's squares -> clean squares in the link's own shape (only known keys, defaults left
// out). Blank "…" slots are dropped, unknown colors and borders become the default and at most
// LIMITS.squares entries are kept (in the order they appear). As on the iPhone
// (BoardLink.swift), a folder at depth LIMITS.depth is kept but empty: nothing inside it stays.
export function normalizeBoard(list, limits = LIMITS) {
  const res = { board: [], squares: 0, folders: 0, truncated: { count: false, depth: false } };
  let kept = 0;

  function walk(items, level) {   // level = how many folders hold this list (0 = the board)
    const out = [];
    if (!Array.isArray(items)) return out;
    if (level >= limits.depth) {
      if (items.some(isEntry)) res.truncated.depth = true;
      return out;
    }
    for (const it of items) {
      if (!isEntry(it)) continue;   // not a square, or a blank slot
      const folder = it.isFolder === true;
      const name = str(it.name), text = folder ? "" : str(it.text);
      if (kept >= limits.squares) { res.truncated.count = true; break; }
      kept++;
      const sq = {};
      if (name) sq.name = name;
      if (text) sq.text = text;
      if (folder) {
        sq.isFolder = true;
        res.folders++;
        const inner = walk(it.items, level + 1);
        if (inner.length) sq.items = inner;
      } else {
        res.squares++;
      }
      if (COLORS.indexOf(it.color) >= 0) sq.color = it.color;
      if (BORDERS.indexOf(it.border) >= 0) sq.border = it.border;
      if (isEmojiImage(it.image)) {
        sq.image = it.image;
        if (it.showName === false) sq.showName = false;
      }
      out.push(sq);
    }
    return out;
  }

  res.board = walk(list, 0);
  return res;
}

// Inflated bytes -> the board list, checking the JSON's own version.
export function parsePayload(bytes) {
  let text, data;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (e) { throw new BoardLinkError("broken", e); }
  try { data = JSON.parse(text); } catch (e) { throw new BoardLinkError("broken", e); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new BoardLinkError("broken");
  if (typeof data.v === "number" && data.v > 1) throw new BoardLinkError("newer");
  if (data.v !== 1 || !Array.isArray(data.board)) throw new BoardLinkError("broken");
  return data.board;
}

// location.hash -> { board, squares, folders, truncated }; throws a BoardLinkError.
export async function decodeBoardLink(hash, { DecompressionStream: DS = globalThis.DecompressionStream, limits = LIMITS } = {}) {
  if (hashTooLong(hash, limits)) throw new BoardLinkError("too-big");
  const link = parseHash(hash);
  if (!link) throw new BoardLinkError("none");
  if (link.version !== "1") throw new BoardLinkError("newer");
  if (link.payload.length > limits.payloadChars) throw new BoardLinkError("too-big");
  const packed = base64urlToBytes(link.payload);
  const raw = await inflateRawLimited(packed, limits.jsonBytes, DS);
  const result = normalizeBoard(parsePayload(raw), limits);
  if (!result.board.length) throw new BoardLinkError("empty");
  return result;
}

// ---------- words on the page ----------

function plural(n, one, many) { return n.toLocaleString("en-US") + " " + (n === 1 ? one : many); }

// "12 squares · 3 folders" (folders left out when there are none)
export function countLine(squares, folders) {
  const parts = [plural(squares, "square", "squares")];
  if (folders) parts.push(plural(folders, "folder", "folders"));
  return parts.join(" · ");
}

// Bidi embedding, override and isolate controls: invisible, and they can make shown text read
// differently from what it is. Taken out of everything the page shows (never out of what a tap
// copies).
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
// Something you can see: not a space, a line break or an invisible formatting character.
const VISIBLE = /[^\s\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/u;

export function plainText(s) { return str(s).replace(BIDI_CONTROLS, ""); }
function hasVisible(s) { return VISIBLE.test(s); }

function cut(s, max, ellipsis) {
  const chars = Array.from(s.slice(0, max * 2 + 2));   // a character is at most 2 UTF-16 units
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() + (ellipsis ? "…" : "") : s;
}

// The start of a text: its first line with something on it, cut to `max` characters.
export function textStart(text, max = 24, ellipsis = true) {
  const line = plainText(text).split(/\r\n|\r|\n|\u2028|\u2029/).map((l) => l.trim()).find(hasVisible) || "";
  return cut(line, max, ellipsis);
}

// What a tap copies, as one line: every run of spaces and line breaks becomes one space, so
// nothing after the first line hides. Used for the toast and the square's tooltip.
export function preview(text, max = 40) {
  return cut(plainText(text).replace(/\s+/g, " ").trim(), max, true);
}

// What a square shows, as on the iPhone: its name, or the first 12 characters of its text;
// "Folder" for a folder with no name, "Square" when there is nothing visible to show.
export function labelFor(sq) {
  const name = plainText(sq && sq.name);
  if (hasVisible(name)) return name;
  if (sq && sq.isFolder) return "Folder";
  return textStart(sq && sq.text, 12, false) || "Square";
}

// The iPhone's smaller name size is for names over 8 characters; a text's start never counts.
export function isLongName(name) {
  const s = plainText(name);
  if (!s) return false;
  if (segmenter) {
    let n = 0;
    for (const _ of segmenter.segment(s)) { if (++n > 8) return true; }
    return false;
  }
  return Array.from(s).length > 8;
}

// Texts inside a folder, counting the ones in folders inside it (Square.textCount on the iPhone).
export function textCount(sq) {
  let n = 0;
  const stack = [(sq && sq.items) || []];
  while (stack.length) {
    for (const it of stack.pop()) {
      if (it.isFolder) stack.push(it.items || []);
      else n++;
    }
  }
  return n;
}

// "3 texts" under a folder's name, as on the iPhone ("0 texts" when it's empty).
export function folderCaption(sq) {
  return plural(textCount(sq), "text", "texts");
}

// "Open in Ditto" only works where Ditto can be installed: iPhone, iPad and iPod touch (an
// iPad asking for the desktop site says "MacIntel", but has a touch screen).
export function isIOSDevice(nav) {
  if (!nav) return false;
  if (/iPhone|iPad|iPod/.test(String(nav.userAgent || ""))) return true;
  return nav.platform === "MacIntel" && Number(nav.maxTouchPoints) > 1;
}

// [TODAY], [TOMORROW] and [TIME] become the real date or time when copied, as in the app.
export function substituteTokens(text, now = new Date()) {
  if (!text || text.indexOf("[") < 0) return text;
  const tomorrow = new Date(now.getTime() + 864e5);
  const day = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return text.split("[TODAY]").join(day(now)).split("[TOMORROW]").join(day(tomorrow))
    .split("[TIME]").join(now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
}
