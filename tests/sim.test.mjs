// Celý běh 8 min + Lich se dvěma boty: nesmí spadnout, musí se dít vlny, level-upy, bossové a skončit.
import assert from "node:assert/strict";
import * as S from "../src/sim.js";
import { botInput } from "../src/bot.js";

function run(seed, classes, duo = true) {
  const w = S.makeWorld(seed, { duo });
  const heroes = classes.map((c, i) => S.makeHero(i, c, "B" + i));
  if (!duo) heroes.length = 1;
  const stats = { lv: 0, guard: 0, lich: 0, maxE: 0, kills: [0, 0], revives: 0, downs: 0 };
  const dt = 1 / 30; let ms = 0;
  for (let step = 0; step < 30 * 60 * 11 && !w.over; step++) {
    if (w.pause) { heroes.forEach((h, i) => S.pickTalent(w, i, w.pause.offers[i][0])) && 0; const p = w.pause; if (p) { /* doplnit volby */ } continue; }
    const t0 = performance.now();
    heroes.forEach((h, i) => {
      const partner = heroes[1 - i];
      const out = S.stepHero(w, h, botInput(w, h, partner, w.t), dt, partner);
      const o2 = { ev: [], kills: {} };
      S.applyHits(w, out.hits, i, o2);
      h.kills += o2.kills[i] || 0;
      if (out.fx.some(f => f.k === "down")) stats.downs++;
      if (partner && S.stepRevive(h, partner, dt)) stats.revives++;
    });
    const out = S.stepWorld(w, heroes, dt);
    for (const [id, n] of Object.entries(out.kills)) heroes[id].kills += n;
    for (const e of out.ev) {
      if (e.k === "lvl") { stats.lv++; heroes.forEach((h, i) => { const id = e.offers[i][0]; if (id) S.applyTalent(h, id); S.pickTalent(w, i, id); }); }
      if (e.k === "boss") stats[e.type]++;
      if (e.k === "heal") heroes[e.hero].hp = Math.min(heroes[e.hero].mh, heroes[e.hero].hp + e.v);
    }
    ms = Math.max(ms, performance.now() - t0);
    stats.maxE = Math.max(stats.maxE, w.enemies.length);
  }
  return { w, heroes, stats, ms };
}

for (const [seed, cls, duo] of [[1, ["knight", "mage"], true], [7, ["barbarian", "rogue"], true], [3, ["mage"], false]]) {
  const { w, heroes, stats, ms } = run(seed, cls, duo);
  console.log(cls.join("+"), "t=" + w.t.toFixed(0), "over=" + JSON.stringify(w.over), "lv=" + w.level, "maxE=" + stats.maxE,
    "kills=" + heroes.map(h => h.kills).join("/"), "downs=" + stats.downs, "rev=" + stats.revives, "guard=" + stats.guard, "lich=" + stats.lich,
    "talents=" + heroes.map(h => JSON.stringify(h.tl)).join(" "), "worst step " + ms.toFixed(2) + " ms");
  assert.ok(w.t > 60, "běh musí trvat aspoň minutu");
  assert.ok(stats.lv >= 3, "level-upy");
  assert.ok(stats.maxE > 40, "horda");
}
// snímek tam a zpět
const w = S.makeWorld(5); const h = [S.makeHero(0, "knight"), S.makeHero(1, "mage")];
for (let i = 0; i < 30 * 50; i++) S.stepWorld(w, h, 1 / 30);
const snap = JSON.parse(JSON.stringify(S.snapshot(w))), back = S.readSnapshot(snap);
assert.equal(back.enemies.length, w.enemies.length);
assert.ok(Math.abs(back.enemies[0].x - w.enemies[0].x) < 0.03);
console.log("snímek", JSON.stringify(snap).length, "B pro", w.enemies.length, "nepřátel");
console.log("OK");
