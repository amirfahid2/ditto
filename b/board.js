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
  depth: 16,              // a folder may sit inside at most 15 others (a top-level folder is depth 1)
});

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

// "#d1=…" -> { version: "1", payload: "…" }, or null when there is no board in it.
export function parseHash(hash) {
  let frag = String(hash == null ? "" : hash).replace(/^#/, "");
  try { frag = decodeURIComponent(frag); } catch (e) { /* a stray "%" is caught below */ }
  const m = /^d(\d{1,6})=([\s\S]*)$/.exec(frag);
  if (!m) return null;
  // Tolerate what messengers sometimes add at the very end (a period, "=" padding, a space,
  // an "&…" of their own).
  return { version: m[1], payload: m[2].split("&")[0].replace(/[^A-Za-z0-9_-]+$/, "") };
}

const B64 = new Int16Array(128).fill(-1);
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".split("").forEach((c, i) => { B64[c.charCodeAt(0)] = i; });

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

// The link's squares -> clean squares in the link's own shape (only known keys, defaults left
// out). Blank "…" slots are dropped, unknown colors and borders become the default, at most
// LIMITS.squares entries are kept (in the order they appear) and folders past LIMITS.depth are
// dropped with everything in them.
export function normalizeBoard(list, limits = LIMITS) {
  const res = { board: [], squares: 0, folders: 0, truncated: { count: false, depth: false } };
  let kept = 0;

  function walk(items, level) {   // level = how many folders hold this list (0 = the board)
    const out = [];
    if (!Array.isArray(items)) return out;
    for (const it of items) {
      if (!it || typeof it !== "object" || Array.isArray(it)) continue;
      const folder = it.isFolder === true;
      const name = str(it.name), text = folder ? "" : str(it.text);
      if (!folder && !name && !text) continue;   // a blank slot
      if (folder && level >= limits.depth) { res.truncated.depth = true; continue; }
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

// The start of a text: its first line with something on it, cut to `max` characters.
export function textStart(text, max = 24) {
  const line = str(text).split(/\r\n|\r|\n|\u2028|\u2029/).map((l) => l.trim()).find((l) => l) || "";
  const chars = Array.from(line);
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() + "…" : line;
}

// What a square shows: its name, or the start of its text; "Folder" for a folder with no name.
export function labelFor(sq) {
  const name = str(sq && sq.name);
  if (name.trim()) return name;
  if (sq && sq.isFolder) return "Folder";
  return textStart(sq && sq.text);
}

// "3 texts" / "2 folders, 1 text": what a folder holds, one level down.
export function folderCaption(sq) {
  const items = (sq && sq.items) || [];
  const f = items.filter((i) => i.isFolder).length, t = items.length - f;
  if (!items.length) return "Empty";
  if (!f) return plural(t, "text", "texts");
  if (!t) return plural(f, "folder", "folders");
  return plural(f, "folder", "folders") + ", " + plural(t, "text", "texts");
}

// [TODAY], [TOMORROW] and [TIME] become the real date or time when copied, as in the app.
export function substituteTokens(text, now = new Date()) {
  if (!text || text.indexOf("[") < 0) return text;
  const tomorrow = new Date(now.getTime() + 864e5);
  const day = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return text.split("[TODAY]").join(day(now)).split("[TOMORROW]").join(day(tomorrow))
    .split("[TIME]").join(now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
}
