// Kostlivá noc – síť pro dva hráče: WebRTC DataChannel, než naběhne (nebo když spadne) relay přes mantledb.sh.
//
// Dokumenty v kostliva-noc-<id>/ :
//   hra  meta {v, names, host: token zařízení, guest: token | null}, místo guesta se zabírá čti-ověř-zapiš
//   sh   nabídka (offer) od hosta   {a: id pokusu, sdp}    } signalizace WebRTC bez trickle ICE
//   sg   odpověď (answer) od guesta {a: id pokusu, sdp}    }
//   h    relay, píše jen host   } {sid, q: [[seq,obj]…] neodepsané spolehlivé, n: příští seq, ack: nejvyšší přijaté seq
//   g    relay, píše jen guest  }  od druhého, as: jeho sid, f/fs: poslední fast + číslo, pi/po: ping/pong, u}
// Spolehlivé zprávy mají jedno číslování (seq) napříč oběma transporty: příjemce dedupluje a doručuje po pořadí,
// odesílatel maže potvrzené (ack přes relay doc nebo přes kanál). Fast zprávy: vyhrává poslední (fs).
// Jakmile se P2P otevře, relay se zastaví; spadne-li, relay naběhne znovu a nepotvrzené zprávy dojdou odtud.

const win = typeof window !== "undefined" ? window : null;
export const API = (win && win.KN_API) || globalThis.KN_API || "https://mantledb.sh/v2/";
const APP = "kostliva-noc";
const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }];
const POLL = 250, POLL_HIDDEN = 2000, PING = 2500, P2P_WAIT = 10000, GATHER_MAX = 3000;
const docUrl = (id, k) => `${API}${APP}-${id}/${k}`;

async function req(url, opt = {}) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 8000);
  try { return await fetch(url, { ...opt, cache: "no-store", signal: ac.signal }); } finally { clearTimeout(timer); }
}
async function load(url) {
  const r = await req(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("load " + r.status);
  return r.json();
}
async function save(url, d) {
  const r = await req(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...d, u: Date.now() }) });
  if (!r.ok) throw new Error("save " + r.status);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function saveRetry(url, d, n = 4) {
  for (let i = 0; ; i++) { try { return await save(url, d); } catch (e) { if (i >= n - 1) throw e; await sleep(400); } }
}

const attempt = (fn, fb) => { try { return fn(); } catch { return fb; } };
export const store = {
  get: k => attempt(() => localStorage.getItem(k), null),
  set: (k, v) => attempt(() => localStorage.setItem(k, v)),
};
export const randId = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => (b % 36).toString(36)).join("");
export const device = store.get("kn-dev") || randId(16);
store.set("kn-dev", device);

// Herna: #herna=1&m=…&r=<12–16 znaků>&seat=0|1&names=<a>,<b>&zaklada=0|1 (viz ../HERNA-PROTOKOL.md)
export function parseHerna(hash) {
  try {
    const p = {};
    for (const kv of String(hash || "").replace(/^#/, "").split("&")) {
      const i = kv.indexOf("=");
      if (i > 0) p[kv.slice(0, i)] = kv.slice(i + 1);
    }
    if (p.herna !== "1" || !/^[0-9a-z]{12,16}$/.test(p.r || "")) return null;
    if (!/^[01]$/.test(p.seat) || !/^[01]$/.test(p.zaklada)) return null;
    const names = (p.names || "").split(",").map(s => decodeURIComponent(s).trim().slice(0, 16));
    if (names.length !== 2 || !names[0] || !names[1]) return null;
    return { r: p.r, seat: +p.seat, names, zaklada: +p.zaklada };
  } catch { return null; }
}

// založí místnost; hostitel je toto zařízení
export async function createRoom(names, dev = device, id = randId(12)) {

  await save(docUrl(id, "hra"), { v: 1, names, host: dev, guest: null });
  return id;
}
// role podle tokenu zařízení; volné místo guesta se obsazuje čti-ověř-zapiš. Neexistující místnost -> null
export async function joinRoom(id, dev = device) {
  const doc = await load(docUrl(id, "hra"));
  if (!doc) return null;
  if (doc.host === dev) return { role: "host", doc };
  if (doc.guest === dev) return { role: "guest", doc };
  if (doc.guest) return { role: "full", doc };
  await save(docUrl(id, "hra"), { ...doc, guest: dev, v: (doc.v || 0) + 1 });
  const after = await load(docUrl(id, "hra"));
  return after && after.guest === dev ? { role: "guest", doc: after } : { role: "full", doc: after || doc };
}

// počká na dokončení sběru ICE kandidátů, nejvýš GATHER_MAX ms
const gather = pc => new Promise(res => {
  if (pc.iceGatheringState === "complete") return res();
  const done = () => { clearTimeout(t); pc.removeEventListener("icegatheringstatechange", chk); res(); };
  const chk = () => pc.iceGatheringState === "complete" && done();
  const t = setTimeout(done, GATHER_MAX);
  pc.addEventListener("icegatheringstatechange", chk);
});
const desc = pc => ({ type: pc.localDescription.type, sdp: pc.localDescription.sdp });

export function connect({ id, role, onMessage = () => {}, onState = () => {} }) {
  const host = role === "host", sid = randId(8), RTC = globalThis.RTCPeerConnection;
  const own = docUrl(id, host ? "h" : "g"), peer = docUrl(id, host ? "g" : "h");
  let state = "connecting", rtt = 0, closed = false;
  // spolehlivé zprávy
  let sendSeq = 0, outQ = [], recvNext = 0, buf = new Map(), peerSid = null;
  // fast zprávy
  let fSeq = 0, lastF = 0, f = null, fs = 0;
  // ping/pong
  let pingT = 0, pi = 0, po = 0, lastPi = 0, rx = 0;
  // relay
  let dirty = true, pushing = false, pulling = false, sigBusy = false, timer = null, pinger = null;
  // P2P: att = aktuální pokus {pc, aid, r, u, wait, timer}
  let att = null, up = false, reneg = 1, tries = 0, lastOffer = null;

  const hidden = () => typeof document !== "undefined" && document.hidden;
  const setState = s => { if (s !== state && !(closed && s !== "closed")) { state = s; attempt(() => onState(s)); } };
  const deliver = (o, fast) => attempt(() => onMessage(o, fast));
  const relayOk = () => { if (!up && state === "connecting") setState("relay"); };
  const sendCh = (ch, m) => { if (ch && ch.readyState === "open") attempt(() => ch.send(JSON.stringify(m))); };

  // --- příjem (společný pro oba transporty) ---
  function accept(s, o) {
    if (!(s > recvNext) || buf.has(s)) return;
    buf.set(s, o);
    const before = recvNext;
    while (buf.has(recvNext + 1)) { const m = buf.get(recvNext + 1); buf.delete(recvNext + 1); recvNext++; deliver(m, false); }
    if (recvNext !== before) { dirty = true; if (up) sendCh(att && att.r, { k: "a", a: recvNext }); }
  }
  function gotAck(a) {
    let n = outQ.length;
    while (outQ.length && outQ[0][0] <= a) outQ.shift();
    if (outQ.length !== n) dirty = true;
  }
  function gotFast(s, o) { if (s > lastF) { lastF = s; deliver(o, true); } }
  function sample(t) {
    if (!t || t !== pingT) return;
    const d = Math.max(1, Date.now() - t);
    rtt = rtt ? Math.round(rtt * 0.6 + d * 0.4) : d;
    pingT = 0;
  }

  // --- relay přes mantledb ---
  function proc(d) {
    if (d.sid !== peerSid) { // druhá strana se připojila znovu (nové sid): číslování doručování začni od jejího nejstaršího nepotvrzeného
      peerSid = d.sid; buf.clear(); lastF = 0; lastPi = 0; dirty = true;
      recvNext = ((d.q && d.q[0] ? d.q[0][0] : d.n) || 1) - 1;
    }
    if (d.as === sid) gotAck(d.ack | 0);
    for (const e of d.q || []) accept(e[0], e[1]);
    if (d.fs > lastF) gotFast(d.fs, d.f);
    if (d.pi && d.pi !== lastPi) { lastPi = d.pi; po = d.pi; dirty = true; }
    if (d.po) sample(d.po);
  }
  async function pull() {
    if (pulling) return;
    pulling = true;
    try { const d = await load(peer); relayOk(); if (d && !closed) proc(d); } catch {} finally { pulling = false; }
  }
  async function push() {
    if (pushing || !dirty) return;
    pushing = true; dirty = false;
    try { await save(own, { sid, q: outQ, n: sendSeq + 1, ack: recvNext, as: peerSid, f, fs, pi, po }); relayOk(); }
    catch { dirty = true; } finally { pushing = false; }
  }
  function tick() {
    clearTimeout(timer);
    if (closed) return;
    if (!up) { pull(); push(); signal(); }
    timer = setTimeout(tick, hidden() ? POLL_HIDDEN : POLL);
  }

  // --- WebRTC ---
  function kill() {
    const a = att; att = null;
    if (a) { clearTimeout(a.timer); attempt(() => a.pc.close()); }
  }
  function newAtt(aid) {
    const a = { pc: new RTC({ iceServers: ICE }), aid, r: null, u: null, wait: false, timer: null };
    kill(); att = a;
    a.pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(a.pc.connectionState)) fail(a); };
    return a;
  }
  function hook(ch, a) {
    a[ch.label] = ch;
    ch.onopen = () => check(a);
    ch.onclose = () => fail(a);
    ch.onmessage = ev => {
      const m = attempt(() => JSON.parse(ev.data));
      if (!m) return;
      rx = Date.now();
      if (m.k === "m") accept(m.s, m.o);
      else if (m.k === "a") gotAck(m.a);
      else if (m.k === "f") gotFast(m.s, m.o);
      else if (m.k === "p") sendCh(a.u, { k: "q", t: m.t });
      else if (m.k === "q") sample(m.t);
    };
    check(a);
  }
  function check(a) {
    if (att !== a || up || !a.r || !a.u || a.r.readyState !== "open" || a.u.readyState !== "open") return;
    clearTimeout(a.timer);
    up = true; rx = Date.now();
    setState("p2p");
    for (const [s, o] of outQ) sendCh(a.r, { k: "m", s, o }); // co zůstalo nepotvrzené přes relay, dojde i kanálem (příjemce dedupluje)
    sendCh(a.r, { k: "a", a: recvNext });
  }
  // pokus skončil: nikdy se neotevřel (zůstane relay), nebo spadl otevřený (relay naběhne, jeden nový pokus)
  function fail(a) {
    if (att !== a) return;
    const wasUp = up;
    kill();
    if (!wasUp) return;
    up = false; dirty = true;
    setState("relay");
    if (reneg > 0 && !closed) { reneg--; if (host) setTimeout(offer, 500); }
    tick();
  }
  const arm = a => { clearTimeout(a.timer); a.timer = setTimeout(() => fail(a), P2P_WAIT); };

  async function offer() {
    if (!RTC || closed || up) return;
    const a = newAtt(sid + "." + ++tries);
    try {
      hook(a.pc.createDataChannel("r"), a);
      hook(a.pc.createDataChannel("u", { ordered: false, maxRetransmits: 0 }), a);
      await a.pc.setLocalDescription(await a.pc.createOffer());
      await gather(a.pc);
      if (att !== a) return;
      await saveRetry(docUrl(id, "sh"), { a: a.aid, sdp: desc(a.pc) });
      if (att === a) a.wait = true; // teď čekáme na odpověď v sg
    } catch { fail(a); }
  }
  async function answer(d) {
    const a = newAtt(d.a);
    try {
      a.pc.ondatachannel = e => hook(e.channel, a);
      await a.pc.setRemoteDescription(d.sdp);
      arm(a);
      await a.pc.setLocalDescription(await a.pc.createAnswer());
      await gather(a.pc);
      if (att !== a) return;
      await saveRetry(docUrl(id, "sg"), { a: a.aid, sdp: desc(a.pc) });
    } catch { fail(a); }
  }
  async function signal() {
    if (!RTC || sigBusy || up) return;
    sigBusy = true;
    try {
      if (host) {
        const a = att;
        if (!a || !a.wait) return;
        const d = await load(docUrl(id, "sg"));
        if (!d || !d.sdp || d.a !== a.aid || att !== a || !a.wait) return;
        a.wait = false;
        try { await a.pc.setRemoteDescription(d.sdp); arm(a); } catch { fail(a); }
      } else {
        const d = await load(docUrl(id, "sh"));
        if (!d || !d.sdp || !d.a || d.a === lastOffer || up) return;
        lastOffer = d.a;
        await answer(d);
      }
    } catch {} finally { sigBusy = false; }
  }

  // --- ping/pong přes aktivní transport; tichý P2P kanál se po 8 s vzdá ---
  function ping() {
    if (closed) return;
    if (up) {
      if (Date.now() - rx > 8000) return fail(att);
      pingT = Date.now();
      sendCh(att && att.u, { k: "p", t: pingT });
    } else { pingT = pi = Date.now(); dirty = true; }
  }

  const link = {
    get state() { return state; },
    get rtt() { return rtt; },
    send(obj) {
      if (closed) return;
      const s = ++sendSeq;
      outQ.push([s, obj]); dirty = true;
      if (up) sendCh(att && att.r, { k: "m", s, o: obj });
    },
    sendFast(obj) {
      if (closed) return;
      const s = ++fSeq;
      if (up) { if (!att.u.bufferedAmount || att.u.bufferedAmount < 65536) sendCh(att.u, { k: "f", s, o: obj }); }
      else { f = obj; fs = s; dirty = true; }
    },
    close() {
      if (closed) return;
      setState("closed");
      closed = true; up = false;
      clearTimeout(timer); clearInterval(pinger);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", tick);
      kill();
    },
  };

  if (typeof document !== "undefined") document.addEventListener("visibilitychange", tick);
  pinger = setInterval(ping, PING);
  setTimeout(ping, 800);
  tick();
  if (host) offer();
  return link;
}
