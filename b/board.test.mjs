// Tests for the shared-board reader (board.js). Run: node --test b/board.test.mjs
// Fixtures are made here: with the iPhone repo's tools/board_link.py (python3) when it's
// there (set DITTO_IOS to its folder), and with Node's own raw DEFLATE.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";
import vm from "node:vm";
import {
  LIMITS, ERRORS, BoardLinkError, parseHash, base64urlToBytes, inflateRawLimited, normalizeBoard,
  decodeBoardLink, isEmojiImage, countLine, labelFor, textStart, folderCaption, substituteTokens,
} from "./board.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IOS = process.env.DITTO_IOS || "/Users/ditto/tapcopy-ios";
const TOOL = join(IOS, "tools/board_link.py");
const DEMO = join(IOS, "appstore/Ditto demo board rebuild.json");
const HAVE_TOOL = existsSync(TOOL);

const pack = (bytes) => Buffer.from(deflateRawSync(bytes, { level: 9 })).toString("base64url");
const linkOf = (obj) => "#d1=" + pack(Buffer.from(JSON.stringify(obj)));
const hashOf = (url) => url.slice(url.indexOf("#"));
const py = (...args) => execFileSync("python3", [TOOL, ...args], { encoding: "utf8", maxBuffer: 64 << 20 }).trim();

async function codeOf(promise) {
  try { await promise; } catch (e) {
    assert.ok(e instanceof BoardLinkError, "only BoardLinkErrors escape: " + e);
    return e.code;
  }
  return "ok";
}

function pyEncode(board) {
  const dir = mkdtempSync(join(tmpdir(), "ditto-board-"));
  try {
    const file = join(dir, "board.json");
    writeFileSync(file, JSON.stringify(board));
    return py("encode", file);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function folderDepth(list) {
  let max = 0;
  for (const sq of list) if (sq.isFolder) max = Math.max(max, 1 + folderDepth(sq.items || []));
  return max;
}

function counts(list) {
  let squares = 0, folders = 0;
  for (const sq of list) {
    if (sq.isFolder) { folders++; const c = counts(sq.items || []); squares += c.squares; folders += c.folders; }
    else squares++;
  }
  return { squares, folders };
}

const HANDMADE = [
  { name: "<img src=x onerror=alert(1)>", text: "<script>alert('x')</script> &amp; <b>bold</b>", color: "teal" },
  { name: "مرحبا", text: "السلام عليكم ورحمة الله", color: "rose", border: "navy" },
  { name: "", text: "\n  Hello there, this is a long text\nand a second line" },
  { name: "Smile", text: "Have a great day!", image: "emoji:😀" },
  { name: "Family", text: "fam", image: "emoji:👨‍👩‍👧‍👦", showName: false },
  { name: "Flag", text: "flag", image: "emoji:🇵🇰" },
  { name: "Keycap", text: "k", image: "emoji:#️⃣" },
  { name: "Not an emoji", text: "t", image: "emoji:hello" },
  { name: "Two emoji", text: "t", image: "emoji:😀😀" },
  { name: "Picture", text: "t", image: "file:abc.jpg", showName: false },
  { name: "Unknown color", text: "t", color: "chartreuse", border: "dotted" },
  { name: "Black border", text: "t", border: "black", color: "slate" },
  { name: "", text: "" },
  { name: "Folder", isFolder: true, color: "navy", items: [{ name: "", text: "" }, { name: "Inside", text: "in", border: "none" }] },
];

/* ---------- the link ---------- */

test("the demo board from tools/board_link.py decodes and normalizes", { skip: !HAVE_TOOL && "no tools/board_link.py" }, async () => {
  const url = py("encode", DEMO);
  assert.match(url, /^https:\/\/dittotap\.com\/b\/#d1=[A-Za-z0-9_-]+$/);
  const expected = JSON.parse(py("decode", url));
  const res = await decodeBoardLink(hashOf(url));
  assert.deepEqual(res.board, expected.board, "the same squares Python reads, in the same shape");
  assert.deepEqual({ squares: res.squares, folders: res.folders }, counts(expected.board));
  assert.deepEqual(res.truncated, { count: false, depth: false });
  const pitch = res.board.find((s) => s.name === "MARKETING PITCH");
  assert.equal(pitch.items, undefined, "its two blank slots are left out");
  const meet = res.board.find((s) => s.name === "MEET UP HERE");
  assert.equal(meet.color, "navy");
  assert.match(meet.items[0].text, /^Let's meet up at noon\./);
  assert.ok(res.board.every((s) => !("id" in s)), "no ids travel");
  assert.equal(countLine(res.squares, res.folders), `${res.squares} squares · ${res.folders} folders`);
});

test("a hand-made board (Python encoder): HTML-looking text, Arabic, emoji, unknown colors", { skip: !HAVE_TOOL && "no tools/board_link.py" }, async () => {
  const res = await decodeBoardLink(hashOf(pyEncode(HANDMADE)));
  const by = (name) => res.board.find((s) => s.name === name);
  checkHandmade(res, by);
});

test("the same hand-made board (Node encoder) reads the same", async () => {
  const res = await decodeBoardLink(linkOf({ v: 1, board: HANDMADE }));
  checkHandmade(res, (name) => res.board.find((s) => s.name === name));
});

function checkHandmade(res, by) {
  // HTML stays plain text, character for character (the page shows it with textContent)
  assert.equal(res.board[0].name, "<img src=x onerror=alert(1)>");
  assert.equal(res.board[0].text, "<script>alert('x')</script> &amp; <b>bold</b>");
  assert.equal(res.board[0].color, "teal");
  // right-to-left text untouched
  assert.deepEqual(by("مرحبا"), { name: "مرحبا", text: "السلام عليكم ورحمة الله", color: "rose", border: "navy" });
  // no name: the label is the start of the text
  const unnamed = res.board.find((s) => !s.name && !s.isFolder);
  assert.equal(labelFor(unnamed), "Hello there, this is a l…");
  // emoji
  assert.equal(by("Smile").image, "emoji:😀");
  assert.deepEqual(by("Family"), { name: "Family", text: "fam", image: "emoji:👨‍👩‍👧‍👦", showName: false });
  assert.equal(by("Flag").image, "emoji:🇵🇰");
  assert.equal(by("Keycap").image, "emoji:#️⃣");
  assert.equal(by("Not an emoji").image, undefined);
  assert.equal(by("Two emoji").image, undefined);
  assert.deepEqual(by("Picture"), { name: "Picture", text: "t" }, "pictures and their showName are dropped");
  // unknown color and border become the default
  assert.deepEqual(by("Unknown color"), { name: "Unknown color", text: "t" });
  assert.deepEqual(by("Black border"), { name: "Black border", text: "t", color: "slate", border: "black" });
  // blank slots are dropped, in folders too
  assert.ok(!res.board.some((s) => !s.name && !s.text && !s.isFolder));
  assert.deepEqual(by("Folder"), { name: "Folder", isFolder: true, color: "navy", items: [{ name: "Inside", text: "in", border: "none" }] });
  assert.equal(res.squares, 13);
  assert.equal(res.folders, 1);
}

test("nested folders 20 deep are cut at 16", async () => {
  let inner = [];
  for (let k = 20; k >= 1; k--) inner = [{ name: "Folder " + k, isFolder: true, items: [{ name: "Text " + k, text: String(k) }].concat(inner) }];
  const res = await decodeBoardLink(linkOf({ v: 1, board: inner }));
  assert.equal(folderDepth(res.board), 16);
  assert.equal(res.folders, 16);
  assert.equal(res.squares, 16, "the texts inside the 16th folder stay");
  assert.equal(res.truncated.depth, true);
  let f = res.board[0];
  for (let k = 1; k < 16; k++) f = f.items[1];
  assert.equal(f.name, "Folder 16");
  assert.deepEqual(f.items, [{ name: "Text 16", text: "16" }]);
});

test("10,000-deep nesting doesn't overflow anything", async () => {
  const json = '{"v":1,"board":[' + '{"isFolder":true,"name":"x","items":['.repeat(10000) + ']}'.repeat(10000) + "]}";
  const res = await decodeBoardLink("#d1=" + pack(Buffer.from(json)));
  assert.equal(folderDepth(res.board), 16);
});

test("6,000 squares are cut at 5,000", async () => {
  const board = Array.from({ length: 6000 }, (_, i) => ({ name: "S" + i, text: "t" + i }));
  const res = await decodeBoardLink(linkOf({ v: 1, board }));
  assert.equal(res.board.length, 5000);
  assert.equal(res.squares, 5000);
  assert.equal(res.board[4999].name, "S4999");
  assert.equal(res.truncated.count, true);
  // in the order they appear: a folder of 5,000 fills the limit before the square after it
  const big = [{ name: "Big", isFolder: true, items: board.slice(0, 5000) }, { name: "After", text: "x" }];
  const r2 = await decodeBoardLink(linkOf({ v: 1, board: big }));
  assert.equal(r2.folders + r2.squares, 5000);
  assert.equal(r2.board[0].items.length, 4999);
  assert.equal(r2.board.length, 1);
});

let gc = null;
try { v8.setFlagsFromString("--expose-gc"); gc = vm.runInNewContext("gc"); } catch (e) { gc = null; }

test("a zip bomb stops at 2 MB without inflating it all", async () => {
  let hash;
  {
    const bomb = deflateRawSync(Buffer.alloc(50_000_000), { level: 9 });   // 50 MB of zeros
    hash = "#d1=" + Buffer.from(bomb).toString("base64url");
  }
  assert.ok(hash.length < LIMITS.payloadChars, "small enough to pass the length check: " + hash.length);
  if (gc) gc();
  const before = process.memoryUsage();
  const t0 = Date.now();
  let err = null;
  try { await decodeBoardLink(hash); } catch (e) { err = e; }
  const after = process.memoryUsage();   // no collection in between: what was made is still counted
  assert.ok(err instanceof BoardLinkError);
  assert.equal(err.code, "too-big");
  assert.ok(err.inflated > LIMITS.jsonBytes && err.inflated < LIMITS.jsonBytes + 1_200_000, "stopped just past 2 MB: " + err.inflated);
  const grew = after.arrayBuffers - before.arrayBuffers;
  assert.ok(grew < 12_000_000, "inflated about 2 MB, not 50 MB: buffers grew " + grew);
  assert.ok(Date.now() - t0 < 3000);

  // JSON that is valid but pads itself past 2 MB is too big as well
  const padded = Buffer.from('{"v":1,"board":[{"name":"a","text":"b"}]}' + " ".repeat(2_100_000));
  assert.equal(await codeOf(decodeBoardLink("#d1=" + pack(padded))), "too-big");
  // and just under the limit is fine
  const near = Buffer.from(JSON.stringify({ v: 1, board: [{ name: "Long", text: "x".repeat(1_990_000) }] }));
  const res = await decodeBoardLink("#d1=" + pack(near));
  assert.equal(res.board[0].text.length, 1_990_000);
});

test("a cut-off or damaged link is broken, never half a board", async () => {
  const full = linkOf({ v: 1, board: HANDMADE });
  const payload = full.slice(4);
  for (const keep of [10, Math.floor(payload.length / 2), payload.length - 7, payload.length - 5, payload.length - 3, payload.length - 2, payload.length - 1]) {
    assert.equal(await codeOf(decodeBoardLink("#d1=" + payload.slice(0, keep))), "broken", "kept " + keep);
  }
  const mid = Math.floor(payload.length / 2);
  const flipped = payload.slice(0, mid) + (payload[mid] === "A" ? "B" : "A") + payload.slice(mid + 1);
  assert.equal(await codeOf(decodeBoardLink("#d1=" + flipped)), "broken");
  assert.equal(await codeOf(decodeBoardLink("#d1=abc+def/ghi")), "broken", "outside the base64url alphabet");
  assert.equal(await codeOf(decodeBoardLink("#d1=" + pack(Buffer.from("not json")))), "broken");
  assert.equal(await codeOf(decodeBoardLink("#d1=" + pack(Buffer.from([0xff, 0xfe, 0x7b])))), "broken", "not UTF-8");
  assert.equal(await codeOf(decodeBoardLink("#d1=" + pack(Buffer.from("[1,2]")))), "broken");
  assert.equal(await codeOf(decodeBoardLink("#d1=" + pack(Buffer.from('{"v":1,"board":{}}')))), "broken");
  // extra data after the end of the DEFLATE stream
  assert.equal(await codeOf(decodeBoardLink("#d1=" + Buffer.concat([deflateRawSync(Buffer.from('{"v":1,"board":[{"name":"a"}]}')), Buffer.from("junk")]).toString("base64url"))), "broken");
});

test("a newer version asks for a newer Ditto", async () => {
  assert.equal(await codeOf(decodeBoardLink(linkOf({ v: 2, board: HANDMADE }))), "newer");
  assert.equal(await codeOf(decodeBoardLink("#d2=" + pack(Buffer.from('{"v":2,"board":[]}')))), "newer");
  assert.equal(await codeOf(decodeBoardLink("#d9=anything")), "newer");
  assert.equal(await codeOf(decodeBoardLink(linkOf({ v: "1", board: HANDMADE }))), "broken");
  assert.equal(await codeOf(decodeBoardLink(linkOf({ v: 0, board: HANDMADE }))), "broken");
  assert.equal(await codeOf(decodeBoardLink(linkOf({ board: HANDMADE }))), "broken");
});

test("a payload over 200,000 characters is too big, before any decoding", async () => {
  const t0 = Date.now();
  assert.equal(await codeOf(decodeBoardLink("#d1=" + "A".repeat(200_001))), "too-big");
  assert.equal(await codeOf(decodeBoardLink("#d1=" + "A".repeat(5_000_000))), "too-big");
  assert.ok(Date.now() - t0 < 500);
  assert.equal(await codeOf(decodeBoardLink("#d1=" + "A".repeat(200_000))), "broken", "at the limit it is read (and isn't a board)");
});

test("no board in the link", async () => {
  for (const h of ["", "#", "#hello", "#d1", "#x1=abc", "#=d1=abc"]) assert.equal(await codeOf(decodeBoardLink(h)), "none", JSON.stringify(h));
  assert.equal(await codeOf(decodeBoardLink("#d1=")), "broken");
  assert.equal(await codeOf(decodeBoardLink(linkOf({ v: 1, board: [] }))), "empty");
  assert.equal(await codeOf(decodeBoardLink(linkOf({ v: 1, board: [{ name: "", text: "" }, null, 7, "x", []] }))), "empty");
});

test("a browser without DecompressionStream('deflate-raw') is told to update", async () => {
  const hash = linkOf({ v: 1, board: HANDMADE });
  assert.equal(await codeOf(decodeBoardLink(hash, { DecompressionStream: null })), "unsupported");
  class OldDS { constructor(format) { if (format !== "gzip" && format !== "deflate") throw new TypeError("Unsupported compression format"); } }
  assert.equal(await codeOf(decodeBoardLink(hash, { DecompressionStream: OldDS })), "unsupported");
  // a missing board still says so first
  assert.equal(await codeOf(decodeBoardLink("", { DecompressionStream: null })), "none");
});

test("what messengers add at the end of a link is ignored", async () => {
  const hash = linkOf({ v: 1, board: [{ name: "Hi", text: "there" }] });
  for (const tail of [".", ")", "=", "==", " ", "%20", "&utm_source=x"]) {
    const res = await decodeBoardLink(hash + tail);
    assert.equal(res.board[0].text, "there", JSON.stringify(tail));
  }
  assert.deepEqual(parseHash("d1=abc"), { version: "1", payload: "abc" });
});

/* ---------- pieces ---------- */

test("normalizeBoard keeps only known keys of the right types", () => {
  const res = normalizeBoard([
    null, 5, "x", [], { name: 7, text: { a: 1 } },
    { name: "n", text: "t", id: "ABC", extra: 1, isFolder: "true", items: [{ name: "lost" }] },
    { isFolder: true },
    { isFolder: true, name: "F", text: "ignored", items: "nope" },
    { name: "e", image: "emoji:😀", showName: "no" },
    { name: "s", showName: false },
    { name: "__proto__", text: "p", ["__proto__"]: { polluted: true } },
  ]);
  assert.deepEqual(res.board, [
    { name: "n", text: "t" },
    { isFolder: true },
    { name: "F", isFolder: true },
    { name: "e", image: "emoji:😀" },
    { name: "s" },
    { name: "__proto__", text: "p" },
  ]);
  assert.equal(({}).polluted, undefined);
  assert.equal(labelFor({ isFolder: true }), "Folder");
  assert.equal(folderCaption({ isFolder: true }), "Empty");
});

test("emoji images: one emoji, nothing else", () => {
  for (const ok of ["emoji:😀", "emoji:👍🏽", "emoji:🇵🇰", "emoji:#️⃣", "emoji:❤️", "emoji:👩‍💻", "emoji:🏴󠁧󠁢󠁳󠁣󠁴󠁿"]) assert.ok(isEmojiImage(ok), ok);
  for (const bad of ["emoji:", "emoji:a", "emoji:5", "emoji:😀😀", "emoji:😀 ", "emoji:😀‮", "emoji:<b>", "file:x.png", "😀", "emoji:" + "😀".repeat(20), 42, null]) assert.ok(!isEmojiImage(bad), String(bad));
});

test("base64url decoding", () => {
  assert.deepEqual(Array.from(base64urlToBytes("AQID_-8")), [1, 2, 3, 255, 239]);
  assert.deepEqual(Buffer.from(base64urlToBytes(Buffer.from("héllo wörld ✓").toString("base64url"))).toString(), "héllo wörld ✓");
  assert.throws(() => base64urlToBytes("A"), BoardLinkError);
  assert.throws(() => base64urlToBytes("AB+C"), BoardLinkError);
});

test("inflateRawLimited reads a normal stream whole", async () => {
  const text = "hello ".repeat(10000);
  const out = await inflateRawLimited(deflateRawSync(Buffer.from(text)));
  assert.equal(Buffer.from(out).toString(), text);
});

test("the words on the page", () => {
  assert.equal(countLine(12, 3), "12 squares · 3 folders");
  assert.equal(countLine(1, 1), "1 square · 1 folder");
  assert.equal(countLine(5000, 0), "5,000 squares");
  assert.equal(textStart("short"), "short");
  assert.equal(textStart("  \n\n  two\nlines"), "two");
  assert.equal(textStart("😀".repeat(30), 5), "😀😀😀😀😀…", "cut by characters, not UTF-16 halves");
  assert.equal(folderCaption({ items: [{ text: "a" }, { text: "b" }] }), "2 texts");
  assert.equal(folderCaption({ items: [{ isFolder: true }, { text: "b" }] }), "1 folder, 1 text");
  assert.equal(ERRORS.broken.title, "This link looks cut off. Ask for it again.");
  assert.equal(ERRORS.unsupported.title, "Update your browser to open this board");
  const out = substituteTokens("On [TODAY] at [TIME], see you [TOMORROW]", new Date(2026, 9, 29, 14, 5));
  assert.doesNotMatch(out, /\[(TODAY|TIME|TOMORROW)\]/);
  assert.match(out, /Oct 29, 2026/);
  assert.match(out, /Oct 30, 2026/);
});

/* ---------- the page's hard rules, checked in its source ---------- */

test("the page loads nothing from anywhere else and never writes data as HTML", () => {
  const read = (p) => readFileSync(join(HERE, p), "utf8");
  const scripts = { "board.js": read("board.js"), "view.js": read("view.js"), "banner.js": read("banner.js"), "../link/qr.js": read("../link/qr.js") };
  for (const [name, src] of Object.entries(scripts)) {
    assert.doesNotMatch(src, /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser/, name);
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|new Image\b|\bimport\(|serviceWorker|postMessage/, name);
    assert.doesNotMatch(src, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/, name + " names no other site");
  }
  const html = read("index.html");
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(csp, "has a CSP");
  for (const d of ["default-src 'self'", "connect-src 'none'", "img-src 'self' data:", "script-src 'self'", "style-src 'self'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp[1].includes(d), d);
  assert.ok(!csp[1].includes("unsafe"), "no unsafe-inline or unsafe-eval");
  assert.ok(html.indexOf(csp[0]) < html.indexOf("<script"), "the CSP comes before any script");
  for (const m of html.matchAll(/<(script|link)\b[^>]*\b(src|href)="([^"]+)"/g)) assert.doesNotMatch(m[3], /^(https?:)?\/\//, m[0]);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "no inline scripts");
  assert.doesNotMatch(html, /\sstyle=|<style/, "no inline styles");
  assert.doesNotMatch(html, /\son[a-z]+=/i, "no inline event handlers");
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /https:\/\/apps\.apple\.com\/app\/apple-store\/id6810430522\?pt=118936797&amp;ct=shared-board&amp;mt=8/);
  const css = read("b.css");
  assert.doesNotMatch(css, /url\(|@import|@font-face/);
});
