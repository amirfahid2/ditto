// Ditto Link core — key derivation, sealing and relay calls (PROTOCOL.md v1).
// Plain ES module: used by the web editor and by the relay's Node tests.

const enc = new TextEncoder();
const dec = new TextDecoder();
const SALT = enc.encode("ditto-link/v1");
export const PAIR_PREFIX = "https://dittotap.com/pair#v1.";

export function b64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(text) {
  const s = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function newSecret() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function pairUrl(secret) {
  return PAIR_PREFIX + b64url(secret);
}

export function parsePairUrl(text) {
  const m = /^https:\/\/dittotap\.com\/pair#v1\.([A-Za-z0-9_-]{43})$/.exec(text);
  if (!m) return null;
  const secret = unb64url(m[1]);
  return secret.length === 32 ? secret : null;
}

async function hkdf(secret, info, length) {
  const ikm = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(info) }, ikm, length * 8);
  return new Uint8Array(bits);
}

// -> { roomId, key: CryptoKey, keyBytes }
export async function deriveLink(secret) {
  const roomId = b64url(await hkdf(secret, "room", 16));
  const keyBytes = await hkdf(secret, "key", 32);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { roomId, key, keyBytes };
}

export const aadBoard = (roomId) => enc.encode(`ditto-link/v1|${roomId}|board`);
export const aadImage = (roomId, name) => enc.encode(`ditto-link/v1|${roomId}|img|${name}`);

// nonce(12) || ciphertext || tag(16) — the same bytes as CryptoKit's SealedBox.combined
export async function seal(key, aad, plain, nonce = crypto.getRandomValues(new Uint8Array(12))) {
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, plain));
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce, 0);
  out.set(ct, 12);
  return out;
}

export async function open(key, aad, sealed) {
  if (sealed.length < 28) throw new Error("sealed blob too short");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.subarray(0, 12), additionalData: aad }, key, sealed.subarray(12));
  return new Uint8Array(plain);
}

export const PICTURE_NAME = /^[A-Za-z0-9-]{1,64}\.(jpg|png)$/;

// Every "file:" picture a board names, nested folders included.
export function pictureNames(board, into = new Set()) {
  for (const sq of board || []) {
    const img = sq && sq.image;
    if (typeof img === "string" && img.startsWith("file:") && PICTURE_NAME.test(img.slice(5))) into.add(img.slice(5));
    if (sq && Array.isArray(sq.items)) pictureNames(sq.items, into);
  }
  return into;
}

export class RelayError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Talks to the relay for one linked room.
export class LinkClient {
  constructor(relayBase, link) {
    this.base = relayBase.replace(/\/$/, "") + "/v1/rooms/" + link.roomId;
    this.link = link;
  }

  // -> { status: "none" } | { status: "same", rev } | { status: "board", rev, envelope }
  async getBoard(knownRev) {
    const headers = knownRev ? { "If-None-Match": `"${knownRev}"` } : {};
    const res = await fetch(this.base + "/board", { headers, cache: "no-store" });
    if (res.status === 404) return { status: "none" };
    if (res.status === 304) return { status: "same", rev: knownRev };
    if (!res.ok) throw new RelayError(res.status, "relay answered " + res.status);
    const rev = Number((res.headers.get("ETag") || "").replace(/\D/g, ""));
    const plain = await open(this.link.key, aadBoard(this.link.roomId), new Uint8Array(await res.arrayBuffer()));
    const envelope = JSON.parse(dec.decode(plain));
    if (envelope.v !== 1 || envelope.rev !== rev || !Array.isArray(envelope.board)) {
      throw new RelayError(0, "board envelope does not match the relay revision");
    }
    return { status: "board", rev, envelope };
  }

  // expectRev 0 = first write. -> { ok: true, rev } | { ok: false, rev: current }
  async putBoard(expectRev, board, from, device) {
    const envelope = { v: 1, rev: expectRev + 1, from, device, at: new Date().toISOString(), board };
    const sealed = await seal(this.link.key, aadBoard(this.link.roomId), enc.encode(JSON.stringify(envelope)));
    const headers = { "Content-Type": "application/octet-stream" };
    if (expectRev === 0) headers["If-None-Match"] = "*";
    else headers["If-Match"] = `"${expectRev}"`;
    const res = await fetch(this.base + "/board", { method: "PUT", headers, body: sealed });
    if (res.status === 200 || res.status === 409) {
      const out = await res.json();
      return { ok: res.status === 200, rev: out.rev };
    }
    throw new RelayError(res.status, res.status === 413 ? "The board is too large to send." : "relay answered " + res.status);
  }

  async putPicture(name, bytes) {
    const sealed = await seal(this.link.key, aadImage(this.link.roomId, name), bytes);
    const res = await fetch(this.base + "/blobs/" + name, {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: sealed,
    });
    if (res.status !== 201 && res.status !== 200) {
      throw new RelayError(res.status, res.status === 413 ? "A picture is too large, or the link is full." : "relay answered " + res.status);
    }
  }

  async getPicture(name) {
    const res = await fetch(this.base + "/blobs/" + name, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new RelayError(res.status, "relay answered " + res.status);
    return open(this.link.key, aadImage(this.link.roomId, name), new Uint8Array(await res.arrayBuffer()));
  }

  async unlink() {
    const res = await fetch(this.base, { method: "DELETE" });
    if (res.status !== 204) throw new RelayError(res.status, "relay answered " + res.status);
  }
}
