// The phone's side of the secure link with its desk (the desk's SECURE-LINK.md; the board's side is trust.py there,
// and its bench/trust_test.py plays this file's steps in Python). The phone's key is made here once and can't be
// read out of the browser; the desk keeps its public half at the claim, the phone keeps the desk's.
// A session: a key made for it only, sent to the desk, which answers with its own; both work out the same session
// keys from the two pairs. Then every message, both ways, is sealed and bound to its route, with a number used once.
// ECDH P-256 (raw 65-byte points), HKDF-SHA256, AES-GCM (nonce: 4 zero bytes, the number on 8 bytes big-endian).

const INFO = new TextEncoder().encode("symbiot session v1");
const P256 = { name: "ECDH", namedCurve: "P-256" };
const subtle = globalThis.crypto?.subtle;

const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = text => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const join = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0)); let at = 0; for (const p of parts) { out.set(new Uint8Array(p), at); at += p.byteLength; } return out; };
const raw = async key => new Uint8Array(await subtle.exportKey("raw", key));
const point = bytes => subtle.importKey("raw", bytes, P256, false, []);
const nonce = n => { const b = new Uint8Array(12); new DataView(b.buffer).setBigUint64(4, BigInt(n)); return b; };
const bound = (sid, route, way) => new TextEncoder().encode(`${sid} ${way} ${route}`);

export const usable = !!subtle; // only on an https page (or localhost): the companion's own address

// the phone's key: made the first time, kept in the phone's database; its private half never leaves the browser
async function phoneKey() {
  let pair = await setting("phone-key");
  if (!pair) {
    pair = await subtle.generateKey(P256, false, ["deriveBits"]);
    await put("settings", pair, "phone-key");
  }
  return pair;
}

// what this phone knows of the desk it claimed: { board, id, host, since }, or nothing
export const owned = () => setting("owner");

// the start of a key's hash, the same on both sides: the desk names its owners by it and says its own in /api/hello
export async function keyId(bytes) {
  return [...new Uint8Array(await subtle.digest("SHA-256", bytes))].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

// the claim, over the cable: the desk keeps this phone's public key and gives its own
export async function claim(at, name) {
  const pair = await phoneKey();
  const r = await fetch("http://" + at + "/api/trust/claim", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: b64(await raw(pair.publicKey)), name }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "the desk answered " + r.status);
  const mine = { board: data.board, boardId: await keyId(unb64(data.board)), id: data.id, host: data.host, since: Date.now() };
  await put("settings", mine, "owner");
  return mine;
}

// the session's keys, whatever carries the asking: ask({ id, key }) → the desk's { session, key }
async function agree(ask) {
  const pair = await phoneKey(), mine = await owned();
  if (!mine) throw new Error("this phone hasn't claimed a desk");
  const once = await subtle.generateKey(P256, false, ["deriveBits"]), onceRaw = await raw(once.publicKey);
  const data = await ask({ id: mine.id, key: b64(onceRaw) });
  if (data.error) throw new Error(data.error === "refused" ? "the desk doesn't know this phone" : data.error);
  const theirs = unb64(data.key);
  const both = join(
    await subtle.deriveBits({ name: "ECDH", public: await point(unb64(mine.board)) }, pair.privateKey, 256),
    await subtle.deriveBits({ name: "ECDH", public: await point(theirs) }, once.privateKey, 256));
  const ikm = await subtle.importKey("raw", both, "HKDF", false, ["deriveBits"]);
  const keys = new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: join(onceRaw, theirs), info: INFO }, ikm, 512));
  return { sid: data.session, up: await subtle.importKey("raw", keys.slice(0, 32), "AES-GCM", false, ["encrypt"]),
    down: await subtle.importKey("raw", keys.slice(32), "AES-GCM", false, ["decrypt"]) };
}

// a session with the desk at this address, over the network: { seal, unseal, send }
export async function session(at) {
  const { sid, up, down } = await agree(async ask => {
    const r = await fetch("http://" + at + "/api/trust/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ask) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok && !data.error) data.error = "the desk answered " + r.status;
    return data;
  });
  let n = 0;
  const seal = async (route, bytes) => {
    const mine = ++n;
    return { n: mine, sealed: await subtle.encrypt({ name: "AES-GCM", iv: nonce(mine), additionalData: bound(sid, route, "up") }, up, bytes) };
  };
  const unseal = (m, route, sealed) => subtle.decrypt({ name: "AES-GCM", iv: nonce(m), additionalData: bound(sid, route, "down") }, down, sealed);
  // a sealed request over the network, bound to its method and full path (?name= and all); its answer comes sealed.
  // A refusal comes plain, as { error }, with its status on the error thrown
  const send = async (method, path, bytes, ms) => {
    const route = method + " " + path, { n: m, sealed } = await seal(route, bytes || new Uint8Array());
    // a GET can't carry a body: its seal (no text, the proof alone) goes as X-Seal
    const get = method === "GET", r = await fetch("http://" + at + path, { method, signal: ms ? AbortSignal.timeout(ms) : undefined,
      headers: { "X-Session": sid, "X-N": String(m), ...(get ? { "X-Seal": b64(sealed) } : { "Content-Type": "application/octet-stream" }) },
      body: get ? undefined : sealed });
    if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || "the desk answered " + r.status), { status: r.status });
    return new Uint8Array(await unseal(+r.headers.get("X-N"), route, await r.arrayBuffer()));
  };
  return { sid, at, seal, unseal, send };
}

// a session over Bluetooth, through the desk's session value (desk-bluetooth): { steer(text) → the bytes to write,
// join(object) → the bytes to write }. Moves and clicks go as a frame (the session, the number, the sealed lines);
// a WiFi as JSON, which may come in pieces
export async function overBluetooth(value) {
  const { sid, up } = await agree(async ask => {
    await value.writeValueWithResponse(new TextEncoder().encode(JSON.stringify(ask)));
    return JSON.parse(new TextDecoder().decode(await value.readValue()));
  });
  let n = 0;
  const seal = async (route, bytes) => { const mine = ++n; return { n: mine, sealed: new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce(mine), additionalData: bound(sid, route, "up") }, up, bytes)) }; };
  return {
    async steer(text) {
      const { n: m, sealed } = await seal("BT steer", new TextEncoder().encode(text)), head = new Uint8Array(20);
      head.set(unb64(sid)); new DataView(head.buffer).setBigUint64(12, BigInt(m));
      return join(head, sealed);
    },
    async join(asked) {
      const { n: m, sealed } = await seal("BT join", new TextEncoder().encode(JSON.stringify(asked)));
      return new TextEncoder().encode(JSON.stringify({ s: sid, n: m, c: b64(sealed) }));
    },
  };
}

// one session kept per address, opened when first needed; when the desk no longer knows it (it restarted), a new
// one is opened and the request sent once more
let kept = null;
export async function request(at, method, path, bytes, ms) {
  for (const fresh of [false, true]) {
    if (fresh || !kept || kept.at !== at) kept = await session(at);
    try { return await kept.send(method, path, bytes, ms); } catch (e) { if (e.status !== 401 || fresh) throw e; }
  }
}
