// Test src/net.js v Node: mock mantledb v paměti, bez RTCPeerConnection (jen relay).  Spuštění: node tests/net.test.mjs
import assert from "node:assert/strict";

// --- mock mantledb: GET 404 když dokument není, POST uloží JSON; fail = kolik dalších požadavků vrátí 500 ---
const docs = new Map();
const mock = { fail: 0, calls: 0 };
globalThis.KN_API = "http://mock.test/v2/";
globalThis.fetch = async (url, opt = {}) => {
  mock.calls++;
  await new Promise(r => setTimeout(r, 2 + Math.random() * 8));
  if (mock.fail > 0) { mock.fail--; return { ok: false, status: 500, json: async () => ({}) }; }
  const path = String(url).slice(globalThis.KN_API.length);
  if (opt.method === "POST") { docs.set(path, opt.body); return { ok: true, status: 200, json: async () => ({}) }; }
  if (!docs.has(path)) return { ok: false, status: 404, json: async () => ({}) };
  const body = docs.get(path);
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};
delete globalThis.RTCPeerConnection;

const net = await import("../src/net.js");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 10000, what = "podmínka") => {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error("timeout: " + what); await sleep(20); }
};
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log("ok   " + name); }
  catch (e) { console.error("FAIL " + name + "\n" + (e && e.stack || e)); process.exitCode = 1; }
};
const peerOf = (id, role) => {
  const P = { msgs: [], fast: [], states: [] };
  P.link = net.connect({ id, role, onMessage: (o, f) => (f ? P.fast : P.msgs).push(o), onState: s => P.states.push(s) });
  return P;
};
const range = (n, from = 0) => Array.from({ length: n }, (_, i) => i + from);

await test("parseHerna platné a neplatné", () => {
  const ok = net.parseHerna("#herna=1&m=abcdefghij&r=ab12cd34efk3&seat=1&names=Mark,Radka&zaklada=0");
  assert.deepEqual(ok, { r: "ab12cd34efk3", seat: 1, names: ["Mark", "Radka"], zaklada: 0 });
  assert.deepEqual(net.parseHerna("herna=1&r=ab12cd34efk3&seat=0&names=" + encodeURIComponent("Ž, a") + "," + encodeURIComponent("Řeřicha") + "&zaklada=1"),
    { r: "ab12cd34efk3", seat: 0, names: ["Ž, a", "Řeřicha"], zaklada: 1 });
  assert.equal(net.parseHerna("#herna=1&r=ab12cd34efk3&seat=0&names=" + "x".repeat(40) + ",B&zaklada=1").names[0].length, 16);
  for (const bad of [
    "", null, undefined, "#r.abc", "#herna=2&r=ab12cd34efk3&seat=0&names=A,B&zaklada=1", "#r=ab12cd34efk3&seat=0&names=A,B&zaklada=1",
    "#herna=1&r=short&seat=0&names=A,B&zaklada=1", "#herna=1&r=AB12CD34EFK3&seat=0&names=A,B&zaklada=1",
    "#herna=1&r=ab12cd34efk3&seat=2&names=A,B&zaklada=1", "#herna=1&r=ab12cd34efk3&seat=0&names=A,B&zaklada=x",
    "#herna=1&r=ab12cd34efk3&seat=0&names=A&zaklada=1", "#herna=1&r=ab12cd34efk3&seat=0&names=A,B,C&zaklada=1",
    "#herna=1&r=ab12cd34efk3&seat=0&names=A,&zaklada=1", "#herna=1&r=ab12cd34efk3&seat=0&names=%E0%A4%A,B&zaklada=1",
  ]) assert.equal(net.parseHerna(bad), null, "má být null: " + bad);
});

await test("randId, store, device", () => {
  assert.match(net.randId(12), /^[0-9a-z]{12}$/);
  assert.notEqual(net.randId(16), net.randId(16));
  assert.equal(net.store.get("x"), null); net.store.set("x", "1"); // bez localStorage nespadne
  assert.match(net.device, /^[0-9a-z]{16}$/);
});

await test("createRoom/joinRoom role", async () => {
  const id = await net.createRoom(["Mark", "Radka"]);
  const doc = JSON.parse(docs.get(`kostliva-noc-${id}/hra`));
  assert.deepEqual([doc.v, doc.names, doc.host, doc.guest], [1, ["Mark", "Radka"], net.device, null]);
  assert.equal((await net.joinRoom(id, "devB")).role, "guest");
  assert.equal((await net.joinRoom(id, "devC")).role, "full");
  assert.equal((await net.joinRoom(id, "devB")).role, "guest");   // návrat guesta
  assert.equal((await net.joinRoom(id)).role, "host");            // návrat hosta podle tokenu
  assert.equal(JSON.parse(docs.get(`kostliva-noc-${id}/hra`)).guest, "devB");
  assert.equal(await net.joinRoom("neexistuje000"), null);
});

const id = await net.createRoom(["Mark", "Radka"]);
const H = peerOf(id, "host"), G = peerOf(id, "guest");

await test("stav relay a rtt", async () => {
  assert.ok(["connecting", "relay"].includes(H.link.state));
  await until(() => H.link.state === "relay" && G.link.state === "relay", 5000, "state relay");
  await until(() => H.link.rtt > 0 && G.link.rtt > 0, 9000, "rtt");
  assert.ok(Number.isFinite(H.link.rtt) && Number.isFinite(G.link.rtt));
  console.log(`     rtt host ${H.link.rtt} ms, guest ${G.link.rtt} ms`);
});

await test("200 spolehlivých zpráv v pořadí právě jednou, oběma směry", async () => {
  for (let i = 0; i < 200; i++) { H.link.send({ t: "x", i }); G.link.send({ t: "y", i }); }
  await until(() => H.msgs.filter(m => m.t === "y").length >= 200 && G.msgs.filter(m => m.t === "x").length >= 200, 15000, "200 zpráv");
  await sleep(1200); // případné duplicity by dorazily
  assert.deepEqual(G.msgs.filter(m => m.t === "x").map(m => m.i), range(200));
  assert.deepEqual(H.msgs.filter(m => m.t === "y").map(m => m.i), range(200));
  assert.equal(G.msgs.length, 200); assert.equal(H.msgs.length, 200);
});

await test("fast: dorazí, staré se zahazují, vždy roste", async () => {
  H.link.sendFast({ n: 0 });
  await until(() => G.fast.length >= 1, 5000, "první fast");
  const base = G.fast.length;
  for (let i = 1; i <= 100; i++) H.link.sendFast({ n: i });
  await until(() => G.fast.at(-1).n === 100, 5000, "poslední fast");
  await sleep(800);
  const ns = G.fast.map(m => m.n);
  assert.deepEqual(ns, [...ns].sort((a, b) => a - b));
  assert.equal(new Set(ns).size, ns.length);
  assert.ok(G.fast.length - base < 100, "staré fast zprávy se měly zahodit, přišlo " + (G.fast.length - base));
  assert.equal(G.msgs.length, 200); // fast se nemíchá do spolehlivých
});

await test("výpadek (500) neztratí spolehlivé zprávy", async () => {
  const gBase = G.msgs.length, hBase = H.msgs.length;
  mock.fail = 1e9;
  for (let i = 0; i < 30; i++) { H.link.send({ t: "f1", i }); if (i % 2) G.link.send({ t: "f2", i }); await sleep(30); }
  await sleep(1500);
  assert.equal(G.msgs.length, gBase); // za výpadku nic nedorazilo
  mock.fail = 0;
  await until(() => G.msgs.length >= gBase + 30 && H.msgs.length >= hBase + 15, 15000, "obnova po výpadku");
  await sleep(800);
  assert.deepEqual(G.msgs.slice(gBase).map(m => m.i), range(30));
  assert.deepEqual(H.msgs.slice(hBase).map(m => m.i), range(30).filter(i => i % 2));
  mock.fail = 6; // krátké střídavé chyby
  for (let i = 100; i < 120; i++) { H.link.send({ t: "f3", i }); await sleep(40); }
  await until(() => G.msgs.filter(m => m.t === "f3").length >= 20, 15000, "po krátkých chybách");
  await sleep(600);
  assert.deepEqual(G.msgs.filter(m => m.t === "f3").map(m => m.i), range(20, 100));
});

await test("potvrzené zprávy se z relay dokumentu mažou", async () => {
  await until(() => JSON.parse(docs.get(`kostliva-noc-${id}/h`)).q.length === 0, 6000, "prázdná fronta");
});

await test("nový host po restartu (jiné sid) se s guestem domluví", async () => {
  H.link.close();
  assert.equal(H.link.state, "closed");
  assert.equal(H.states.at(-1), "closed");
  const H2 = peerOf(id, "host");
  await until(() => H2.link.state === "relay", 5000, "H2 relay");
  H2.link.send({ t: "again", i: 1 }); G.link.send({ t: "back", i: 1 });
  await until(() => G.msgs.some(m => m.t === "again") && H2.msgs.some(m => m.t === "back"), 10000, "po restartu");
  await sleep(800);
  assert.equal(G.msgs.filter(m => m.t === "again").length, 1);
  assert.equal(H2.msgs.filter(m => m.t === "back").length, 1);
  H2.link.close();
});

G.link.close();
console.log(process.exitCode ? "\nNĚKTERÉ TESTY SELHALY" : `\nOK, ${passed} testů`);
process.exit(process.exitCode ? 1 : 0);
