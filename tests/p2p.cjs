// Playwright test src/net.js: dva prohlížečové kontexty, P2P přes WebRTC + mock mantledb na stejném serveru.
// Spuštění: node tests/p2p.cjs   (PW=cesta k playwright, jinak %APPDATA%/npm/node_modules/playwright)
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require(process.env.PW || path.join(process.env.APPDATA, "npm/node_modules/playwright"));

const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json" };
const docs = new Map();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/mock/")) {
    const key = u.pathname.slice(6);
    if (req.method === "POST") {
      let b = "";
      req.on("data", c => (b += c));
      req.on("end", () => { docs.set(key, b); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
    } else if (docs.has(key)) { res.writeHead(200, { "content-type": "application/json" }); res.end(docs.get(key)); }
    else { res.writeHead(404); res.end("{}"); }
    return;
  }
  const file = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nenalezeno"); }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const range = (n, from = 0) => Array.from({ length: n }, (_, i) => i + from);
const waitFor = async (page, fn, arg, ms, what) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }); }
  catch { throw new Error("timeout: " + what + " | " + JSON.stringify(await page.evaluate(() => ({ s: window.L && window.L.link.state, st: window.L && window.L.states })))); }
};

async function newPair(browser, url, noRtcOn) {
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  if (noRtcOn === "A") await ctxA.addInitScript(() => { delete window.RTCPeerConnection; delete window.webkitRTCPeerConnection; });
  if (noRtcOn === "B") await ctxB.addInitScript(() => { delete window.RTCPeerConnection; delete window.webkitRTCPeerConnection; });
  const [A, B] = [await ctxA.newPage(), await ctxB.newPage()];
  for (const p of [A, B]) {
    p.on("pageerror", e => console.error("pageerror:", e.message));
    await p.goto(url);
    await p.waitForFunction(() => window.ready === true);
  }
  // A zakládá místnost (host), B se připojí jako guest (jiný kontext = jiný token zařízení)
  const id = await A.evaluate(() => net.createRoom(["Mark", "Radka"]));
  const ra = await A.evaluate(id => net.joinRoom(id).then(r => r.role), id);
  const rb = await B.evaluate(id => net.joinRoom(id).then(r => r.role), id);
  assert.equal(ra, "host"); assert.equal(rb, "guest");
  await A.evaluate(id => start(id, "host"), id);
  await B.evaluate(id => start(id, "guest"), id);
  return { A, B, close: async () => { await ctxA.close(); await ctxB.close(); } };
}

// A i B si vymění 20 spolehlivých zpráv v pořadí a fast zprávy, vrátí poslední fast
async function exchange(A, B, tag) {
  await A.evaluate(tag => { for (let i = 0; i < 20; i++) L.link.send({ t: tag, i }); }, tag);
  await B.evaluate(tag => { for (let i = 0; i < 20; i++) L.link.send({ t: tag + "b", i }); }, tag);
  await waitFor(B, tag => L.msgs.filter(m => m.t === tag).length >= 20, tag, 15000, "B spolehlivé " + tag);
  await waitFor(A, tag => L.msgs.filter(m => m.t === tag + "b").length >= 20, tag, 15000, "A spolehlivé " + tag);
  await A.evaluate(() => { for (let i = 1; i <= 30; i++) L.link.sendFast({ n: i }); });
  await waitFor(B, () => L.fast.length && L.fast.at(-1).n === 30, null, 10000, "B fast");
  await sleep(500);
  assert.deepEqual(await B.evaluate(tag => L.msgs.filter(m => m.t === tag).map(m => m.i), tag), range(20));
  assert.deepEqual(await A.evaluate(tag => L.msgs.filter(m => m.t === tag + "b").map(m => m.i), tag), range(20));
  const ns = await B.evaluate(() => L.fast.map(m => m.n));
  assert.deepEqual(ns, [...ns].sort((a, b) => a - b));
}

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/tests/p2p.html`;
  const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
  let code = 0;
  const run = async (name, fn) => {
    try { await fn(); console.log("ok   " + name); }
    catch (e) { code = 1; console.error("FAIL " + name + "\n" + (e && e.stack || e)); }
  };
  try {
    await run("P2P: oba linky dosáhnou stavu p2p, spolehlivé + fast zprávy, rtt", async () => {
      const t0 = Date.now(), p = await newPair(browser, url);
      try {
        await waitFor(p.A, () => L.link.state === "p2p", null, 25000, "A p2p");
        await waitFor(p.B, () => L.link.state === "p2p", null, 25000, "B p2p");
        console.log(`     p2p po ${Date.now() - t0} ms`);
        await exchange(p.A, p.B, "p2p");
        await waitFor(p.A, () => L.link.rtt > 0, null, 10000, "A rtt");
        await waitFor(p.B, () => L.link.rtt > 0, null, 10000, "B rtt");
        const rtt = [await p.A.evaluate(() => L.link.rtt), await p.B.evaluate(() => L.link.rtt)];
        assert.equal(await p.A.evaluate(() => L.link.state), "p2p");
        assert.equal(await p.B.evaluate(() => L.link.state), "p2p");
        console.log(`     rtt A ${rtt[0]} ms, B ${rtt[1]} ms`);
      } finally { await p.close(); }
    });

    for (const side of ["B", "A"]) {
      await run(`bez RTCPeerConnection na straně ${side} (${side === "A" ? "host" : "guest"}): oba zůstanou na relay a zprávy tečou`, async () => {
        const p = await newPair(browser, url, side);
        try {
          await waitFor(p.A, () => L.link.state === "relay", null, 10000, "A relay");
          await waitFor(p.B, () => L.link.state === "relay", null, 10000, "B relay");
          await exchange(p.A, p.B, "rel");
          await sleep(4000); // ani později se nepřepne
          assert.equal(await p.A.evaluate(() => L.link.state), "relay");
          assert.equal(await p.B.evaluate(() => L.link.state), "relay");
          assert.ok(!(await p.A.evaluate(() => L.states.includes("p2p"))) && !(await p.B.evaluate(() => L.states.includes("p2p"))));
        } finally { await p.close(); }
      });
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(code ? "\nNĚKTERÉ TESTY SELHALY" : "\nOK");
  process.exit(code);
})().catch(e => { console.error(e); process.exit(1); });
