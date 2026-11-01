// Kouřový test živé verze: #solo se načte, hraje se, kostlivci se kreslí, bez chyb. Chromium + WebKit iPhone 13.
// Spuštění: node tests/live.cjs [URL]   (výchozí GitHub Pages). Na mantledb nesahá (sólo síť nepoužívá).
const assert = require("assert/strict");
const path = require("path");
const { PW, watch, until, sleep, SHOTS } = require("./harness.cjs");
const URL_ = (process.argv[2] || "https://sachasportrezervace-arch.github.io/kostliva-noc/").replace(/\/?$/, "/");

(async () => {
  let code = 0;
  for (const [name, type, opts] of [["chromium", "chromium", { viewport: { width: 1280, height: 800 } }], ["webkit-iphone13", "webkit", { ...PW.devices["iPhone 13"] }]]) {
    const b = await PW[type].launch();
    try {
      const cx = await b.newContext(opts); await cx.addInitScript(() => { window.__knNoAdapt = 1; });
      const p = await cx.newPage(), errs = watch(p, name);
      await p.goto(URL_ + "#solo", { waitUntil: "commit" });
      await p.waitForSelector("#bGo", { timeout: 90000 });
      await p.click("#bGo");
      await p.evaluate(() => { window.__knAuto = 1; window.__knSpeed = 3; });
      await until(() => p.evaluate(() => window.__knScene().skel > 5 && window.__kn().t > 15), 120000, "kostlivci ve hře");
      await p.evaluate(() => { window.__knSpeed = 1; }); await sleep(800);
      await p.screenshot({ path: path.join(SHOTS, `live-${name}.png`) });
      const s = await p.evaluate(() => window.__kn());
      assert.equal(s.phase, "play");
      assert.deepEqual(errs, []);
      console.log(`ok   ${name}: t=${s.t.toFixed(0)} nepřátel ${s.enemies} zabití ${s.K}`);
    } catch (e) { code = 1; console.error(`FAIL ${name}\n${e && e.stack || e}`); }
    finally { await b.close(); }
  }
  console.log(code ? "\nNĚKTERÉ TESTY SELHALY" : "\nOK");
  process.exit(code);
})();
