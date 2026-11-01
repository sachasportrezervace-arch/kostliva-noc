// Playwright: dva hráči, dva kontexty. (A) výzva odkazem #r.<id>: Chromium host + WebKit iPhone 13 guest.
// (B) Herna: hra v iframe rámci, parametry #herna=1…, zprávy postMessage do rodiče. Mantledb je mock na testovacím serveru.
// Spuštění: node tests/duo.cjs [link|herna]   Snímky: tests/shots/duo-*.png
const assert = require("assert/strict");
const path = require("path");
const { PW, startServer, newCtx, watch, until, sleep, SHOTS } = require("./harness.cjs");
const only = process.argv[2];

// g = objekt s evaluate/locator/click (Page nebo Frame)
const st = g => g.evaluate(() => window.__kn && window.__kn());
const setAuto = (g, a, sp = 1) => g.evaluate(([a, sp]) => { window.__knAuto = a; window.__knSpeed = sp; }, [a, sp]);

async function playBoth(H, G, shot) {
  try { return await playBoth2(H, G, shot); }
  catch (e) { e.message += "\n host " + JSON.stringify(await st(H).catch(() => null)) + "\n guest " + JSON.stringify(await st(G).catch(() => null)); throw e; }
}
async function playBoth2(H, G, shot) {
  // oba ve hře a vidí se navzájem
  await until(async () => (await st(H)).phase === "play" && (await st(G)).phase === "play", 20000, "oba hrají");
  await setAuto(H, 1); await setAuto(G, 1);
  const p0 = [(await st(H)).pos[1], (await st(G)).pos[0]];
  await until(async () => {
    const h = await st(H), g = await st(G);
    return Math.hypot(h.pos[1][0] - p0[0][0], h.pos[1][1] - p0[0][1]) > 1 && Math.hypot(g.pos[0][0] - p0[1][0], g.pos[0][1] - p0[1][1]) > 1;
  }, 30000, "host vidí pohyb guesta a guest vidí pohyb hosta");
  // zásahy guesta zabíjejí kosti u hosta
  await until(async () => (await st(H)).netKills >= 3, 60000, "zásahy guesta zabíjejí na hostiteli");
  await shot("1-hra");
  // level-up čeká na oba: guest nevybírá sám
  await setAuto(G, 0); await setAuto(H, 0, 2);
  await until(async () => (await st(H)).lvl && (await st(G)).lvl, 90000, "level-up u obou", 150);
  await H.locator("#lvl .card").first().click();
  await sleep(1500);
  const h1 = await st(H);
  assert.ok(h1.paused && h1.lvlWait, "host po výběru čeká na guesta");
  await shot("2-ceka");
  await G.locator("#lvl .card").nth(1).click();
  await until(async () => !(await st(H)).lvl && !(await st(G)).lvl && !(await st(H)).paused, 10000, "po obou výběrech běží dál");
  // zbytek zrychleně až do konce
  await setAuto(H, 1, 8); await setAuto(G, 1, 8);
  await until(async () => (await st(H)).phase === "end" && (await st(G)).phase === "end", 12 * 60000, "konec u obou", 1000);
  await sleep(2500); await shot("3-konec");
  return [await st(H), await st(G)];
}

async function linkFlow(base) {
  const bc = await PW.chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] }), bw = await PW.webkit.launch();
  try {
    const cA = await newCtx(bc, { viewport: { width: 1280, height: 800 } }), cB = await newCtx(bw, { ...PW.devices["iPhone 13"] });
    await cB.addInitScript(() => localStorage.setItem("kn-name", "Radka"));
    const A = await cA.newPage(), B = await cB.newPage(), errs = [...[]];
    const eA = watch(A, "host"), eB = watch(B, "guest");
    const shot = n => Promise.all([A.screenshot({ path: path.join(SHOTS, `duo-link-host-${n}.png`) }), B.screenshot({ path: path.join(SHOTS, `duo-link-guest-${n}.png`) })]);
    await A.goto(base + "/", { waitUntil: "commit" });
    await A.waitForSelector("#bHost", { timeout: 60000 });
    await A.fill("#nm", "Mark");
    await A.click("#bHost");
    await until(async () => /^#r\.[0-9a-z]+$/.test(await A.evaluate(() => location.hash)), 10000, "výzva má odkaz");
    assert.ok(await A.locator("#bShare").count(), "host má sdílení odkazu");
    const id = (await A.evaluate(() => location.hash)).slice(3);
    await B.goto(`${base}/#r.${id}`, { waitUntil: "commit" });
    await until(async () => (await st(B)).mode === "guest" && (await st(B)).phase === "lobby", 90000, "guest v lobby")
      .catch(async e => { e.message += " | " + JSON.stringify(await B.evaluate(() => [window.__kn && window.__kn(), document.getElementById("ui").innerText.slice(0, 80)]).catch(x => String(x))); throw e; });
    await B.click('.cls[data-c="rogue"]');
    await until(async () => (await st(A)).cls[1] === "rogue" && !(await A.locator("#bGo").isDisabled()), 20000, "host vidí guesta a jeho postavu");
    assert.deepEqual((await st(A)).names, ["Mark", "Radka"]);
    await A.screenshot({ path: path.join(SHOTS, "duo-link-host-0-lobby.png") });
    await A.click("#bGo");
    const [h, g] = await playBoth(A, B, shot);
    console.log(`     síť host ${h.net}, guest ${g.net}; konec ${JSON.stringify(h.over)} t=${h.t.toFixed(0)} zabití ${h.K} (z toho zásahy guesta ${h.netKills})`);
    // odveta
    await B.click("#bAgain");   // guest požádá, host (na konci) rovnou rozjede další partii
    await until(async () => (await st(A)).gameNo === 2 && (await st(B)).gameNo === 2 && (await st(B)).phase === "play", 20000, "odveta u obou");
    errs.push(...eA, ...eB);
    assert.deepEqual(errs, [], "chyby v konzoli");
  } finally { await bc.close(); await bw.close(); }
}

async function hernaFlow(base) {
  const b = await PW.chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
  try {
    const r = "kn" + Math.random().toString(36).slice(2, 12).padEnd(10, "0");
    const q = s => `#herna=1&m=test000000&r=${r}&seat=${s}&names=Mark,Radka&zaklada=${s ? 0 : 1}`;
    const cA = await newCtx(b, { viewport: { width: 390, height: 613 } }), cB = await newCtx(b, { viewport: { width: 390, height: 613 } });
    const PA = await cA.newPage(), PB = await cB.newPage();
    const eA = watch(PA, "seat0"), eB = watch(PB, "seat1");
    // guest dřív než zakladatel: musí čekat na dokument
    await PB.goto(base + "/herna-frame.html" + q(1), { waitUntil: "commit" });
    await sleep(1500);
    await PA.goto(base + "/herna-frame.html" + q(0), { waitUntil: "commit" });
    const frame = async P => until(async () => P.frames().find(f => f.url().includes("/index.html")), 10000, "iframe hry");
    const A = await frame(PA), B = await frame(PB);
    await until(async () => (await st(A)).mode === "host" && (await st(B)).mode === "guest", 60000, "role podle Herny");
    await until(async () => !(await A.locator("#bGo").isDisabled()), 30000, "zakladatel může zapálit oheň");
    assert.equal(await A.locator("#bShare, #bSolo, #bHost").count(), 0, "v Herně žádné sdílení ani sólo");
    assert.deepEqual((await st(B)).names, ["Mark", "Radka"]);
    await PA.screenshot({ path: path.join(SHOTS, "duo-herna-0-lobby.png") });
    await A.click("#bGo");
    const shot = n => Promise.all([PA.screenshot({ path: path.join(SHOTS, `duo-herna-seat0-${n}.png`) }), PB.screenshot({ path: path.join(SHOTS, `duo-herna-seat1-${n}.png`) })]);
    const [h] = await playBoth(A, B, shot);
    const zA = await PA.evaluate(() => window.zpravy), zB = await PB.evaluate(() => window.zpravy);
    for (const [z, who] of [[zA, "seat0"], [zB, "seat1"]]) {
      assert.ok(z.some(m => m.typ === "pripraveno"), who + " pripraveno");
      for (const f of ["ceka", "hraje", "konec"]) assert.ok(z.some(m => m.typ === "stav" && m.faze === f), `${who} stav ${f}`);
      assert.equal(z.filter(m => m.typ === "vysledek").length, 1, who + " právě jeden vysledek");
    }
    const vA = zA.find(m => m.typ === "vysledek"), vB = zB.find(m => m.typ === "vysledek");
    assert.equal(vA.partie, vB.partie, "stejná partie");
    assert.deepEqual(vA, vB, "stejný výsledek");
    assert.ok(vA.vitez === null || vA.vitez === 0 || vA.vitez === 1);
    // konec se vejde do iframe Herny (613 px): tlačítka jsou vidět
    for (const id of ["#bAgain", "#bOther"]) { const bb = await B.locator(id).boundingBox(); assert.ok(bb && bb.y + bb.height <= 613, id + " je vidět"); }
    await B.click("#bOther");
    await until(async () => (await PB.evaluate(() => window.zpravy)).some(m => m.typ === "jina-hra"), 5000, "jina-hra");
    console.log(`     vysledek ${JSON.stringify(vA)}; zabití ${h.K}`);
    assert.deepEqual([...eA, ...eB], [], "chyby v konzoli");
  } finally { await b.close(); }
}

(async () => {
  const { server, url } = await startServer();
  let code = 0;
  for (const [name, fn] of [["link", linkFlow], ["herna", hernaFlow]]) {
    if (only && only !== name) continue;
    try { await fn(url); console.log("ok   " + name); } catch (e) { code = 1; console.error(`FAIL ${name}\n${e && e.stack || e}`); }
  }
  server.close();
  console.log(code ? "\nNĚKTERÉ TESTY SELHALY" : "\nOK");
  process.exit(code);
})();
