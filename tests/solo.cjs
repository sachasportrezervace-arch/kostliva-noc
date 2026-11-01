// Playwright: celé sólo (#solo) s botem až po konec, Chromium desktop + WebKit iPhone 13.
// Spuštění: node tests/solo.cjs [chromium|webkit]   (bez argumentu oba). Snímky: tests/shots/solo-*.png
const assert = require("assert/strict");
const path = require("path");
const { PW, startServer, newCtx, watch, until, sleep, SHOTS } = require("./harness.cjs");

const only = process.argv[2];
const RUNS = [
  { name: "chromium", type: "chromium", opts: { viewport: { width: 1280, height: 800 } } },
  { name: "webkit-iphone13", type: "webkit", opts: { ...PW.devices["iPhone 13"] } },
].filter(r => !only || r.type === only);

async function solo(base, run) {
  const browser = await PW[run.type].launch();
  const ctx = await newCtx(browser, run.opts), page = await ctx.newPage(), errs = watch(page, run.name);
  const shot = n => page.screenshot({ path: path.join(SHOTS, `solo-${run.name}-${n}.png`) });
  const st = () => page.evaluate(() => window.__kn && window.__kn());
  const sc = () => page.evaluate(() => window.__knScene && window.__knScene());
  try {
    await page.goto(base + "/#solo", { waitUntil: "commit" });
    await page.waitForSelector("#bGo", { timeout: 60000 });
    await until(async () => (await sc()).heroes.length === 2, 20000, "dva hrdinové v lobby");
    await sleep(600); await shot("1-lobby");
    await page.click('.cls[data-c="mage"]');
    assert.equal((await st()).cls[0], "mage");
    await page.click("#bGo");
    await until(async () => (await st()).phase === "play", 10000, "hra běží");
    await page.evaluate(() => { window.__knAuto = 1; });
    await until(async () => (await st()).t > 6, 30000, "čas běží");
    const s1 = await sc();
    assert.ok(s1.props > 1000, "plot, hroby a stromy jsou ve scéně");
    assert.ok(s1.tether, "pouto je vidět");
    await page.evaluate(() => { window.__knSpeed = 3; });
    await until(async () => (await sc()).skel > 10, 60000, "zapečení kostlivci se kreslí");
    const s2 = await sc();
    assert.ok(s2.heroAnim.some(a => /Running_A|Spellcast|Throw|Slice|Spin/.test(a)), "hrdinové se hýbou: " + s2.heroAnim);
    await page.evaluate(() => { window.__knSpeed = 1; }); await sleep(500); await shot("2-hra");
    // level-up: hra stojí, karty jsou vidět
    await page.evaluate(() => { window.__knAuto = 0; window.__knSpeed = 3; });
    await until(async () => (await st()).lvl, 90000, "level-up", 100);
    const before = (await st()).t; await sleep(800);
    assert.equal((await st()).t, before, "při level-upu hra stojí");
    assert.equal(await page.locator("#lvl .card").count(), 3);
    await shot("3-levelup");
    await page.locator("#lvl .card").first().click();
    await until(async () => !(await st()).lvl, 5000, "po výběru se hra rozběhne");
    // zbytek běhu: autopilot, zrychleně
    await page.evaluate(() => { window.__knAuto = 1; window.__knSpeed = 16; });
    let boss = false, end = null, maxE = 0;
    await until(async () => {
      const s = await st(); maxE = Math.max(maxE, s.enemies);
      if (s.boss && !boss) {
        boss = true; await page.evaluate(() => { window.__knSpeed = 1; }); await sleep(2500);
        assert.ok(await page.locator("#bossbar:not(.hidden)").count(), "lišta bosse");
        await shot("4-boss"); await page.evaluate(() => { window.__knSpeed = 16; });
      }
      if (s.phase === "end") end = s;
      return end;
    }, 9 * 60000, "konec běhu", 500);
    await page.waitForSelector("#end", { timeout: 5000 });
    await sleep(800); await shot("5-konec");
    const txt = await page.locator("#end").innerText();
    assert.ok(/Lich padl|Svítá|Kosti vyhrály/.test(txt), "konec: " + txt.slice(0, 60));
    assert.ok(maxE > 60, "horda: max " + maxE);
    await page.click("#bAgain");
    await until(async () => { const s = await st(); return s.phase === "play" && s.gameNo === 2; }, 10000, "znovu");
    assert.deepEqual(errs, [], "chyby v konzoli");
    console.log(`ok   ${run.name}: konec ${JSON.stringify(end.over)} t=${end.t.toFixed(0)} úroveň ${end.level} zabití ${end.K} max nepřátel ${maxE} boss ${boss}`);
  } finally { await browser.close(); }
}

(async () => {
  const { server, url } = await startServer();
  let code = 0;
  for (const run of RUNS) {
    try { await solo(url, run); } catch (e) { code = 1; console.error(`FAIL ${run.name}\n${e && e.stack || e}`); }
  }
  server.close();
  console.log(code ? "\nNĚKTERÉ TESTY SELHALY" : "\nOK");
  process.exit(code);
})();
