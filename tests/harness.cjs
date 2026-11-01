// Společné pro Playwright testy hry: statický server + mock mantledb (/mock/<klíč>) + rámec Herny (/herna-frame.html).
// Nikdy nesahá na živé mantledb.sh: stránky dostanou window.KN_API = <origin>/mock/ přes addInitScript.
const http = require("http");
const fs = require("fs");
const path = require("path");
const PW = require(process.env.PW || path.join(process.env.APPDATA, "npm/node_modules/playwright"));

const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".svg": "image/svg+xml" };

// rámec, který napodobí Hernu: hru vloží do iframe a sbírá její postMessage do window.zpravy
const FRAME = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style>
<script>window.zpravy=[];addEventListener("message",e=>{if(e.data&&e.data.herna===1)window.zpravy.push(e.data)});</script>
<iframe id="g" allow="autoplay"></iframe><script>document.getElementById("g").src="/index.html"+location.hash;</script>`;

function startServer() {
  const docs = new Map();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/mock/")) {
      const key = u.pathname.slice(6);
      if (req.method === "POST") {
        let b = ""; req.on("data", c => (b += c));
        req.on("end", () => { docs.set(key, b); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
      } else if (docs.has(key)) { res.writeHead(200, { "content-type": "application/json" }); res.end(docs.get(key)); }
      else { res.writeHead(404); res.end("{}"); }
      return;
    }
    if (u.pathname === "/herna-frame.html") { res.writeHead(200, { "content-type": MIME[".html"] }); return res.end(FRAME); }
    let p = decodeURIComponent(u.pathname); if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nenalezeno"); }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({ server, docs, url: `http://127.0.0.1:${server.address().port}` })));
}

// Google Fonts v testech blokujeme (offline/rychlost); hra má systémový záložní font
async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext(opts);
  // __knNoAdapt: Playwright WebKit po změně velikosti canvasu fotí prázdnou plochu (canvas sám kreslí dál)
  await ctx.addInitScript(() => { window.KN_API = location.origin + "/mock/"; window.__knNoAdapt = 1; });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  return ctx;
}

// sběr chyb ze stránky (a jejích rámců)
function watch(page, tag) {
  const errs = [];
  page.on("pageerror", e => errs.push(`${tag} pageerror: ${e.message}`));
  page.on("console", m => { if (m.type() === "error" && !/fonts\.g|net::ERR_FAILED|Failed to load resource/.test(m.text())) errs.push(`${tag} console: ${m.text()}`); });
  return errs;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what, step = 300) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout: " + what);
    await sleep(step);
  }
}

module.exports = { PW, ROOT, startServer, newCtx, watch, sleep, until, SHOTS: path.join(ROOT, "tests/shots") };
