// Kostlivá noc – simulace bez DOM a three.js (běží i v Node testech).
// Svět (nepřátelé, duše, vlny, bossové, level-upy) počítá jen hostitel: stepWorld. Každý klient počítá svého hrdinu:
// stepHero vrací zásahy (out.hits) a vizuální události (out.fx); hostitel zásahy aplikuje přes applyHits.
// Jednotky: metry a sekundy. Osa x doprava, z k hráči (dolů na obrazovce).

export const ARENA_R = 26;
export const RUN = 480;          // Lich přijde v 8:00
export const GUARD_AT = 240;     // Kostěný strážce ve 4:00
export const TETHER_MAX = 12;
export const DAWN = RUN + 120;   // když Lich do 10:00 nepadne, svítá a kosti se rozpadnou (výhra bez trofeje)
export const MAX_ENEMIES = 240;  // strop kvůli mobilům
export const dmgScale = t => 1 + t / 300;

export function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.pick = arr => arr[(f() * arr.length) | 0];
  return f;
}

export const CLASSES = {
  knight:    { name: "Rytíř",  hp: 150, speed: 4.6, atk: { kind: "slash",  cd: 0.85, dmg: 26, range: 2.7 } },
  mage:      { name: "Mág",    hp: 95,  speed: 4.8, atk: { kind: "bolt",   cd: 0.62, dmg: 17, range: 10, speed: 15 } },
  barbarian: { name: "Barbar", hp: 130, speed: 4.5, atk: { kind: "spin",   cd: 1.55, dmg: 21, range: 3.0 } },
  rogue:     { name: "Zloděj", hp: 95,  speed: 5.4, atk: { kind: "dagger", cd: 0.38, dmg: 10, range: 9, speed: 19 } },
};
export const CLASS_IDS = Object.keys(CLASSES);

export const ENEMIES = {
  minion:  { hp: 16,   speed: 2.15, dmg: 9,  r: 0.42, xp: 1 },
  rogue:   { hp: 11,   speed: 3.4,  dmg: 7,  r: 0.38, xp: 1 },
  warrior: { hp: 58,   speed: 1.6,  dmg: 15, r: 0.58, xp: 3 },
  mage:    { hp: 28,   speed: 1.8,  dmg: 10, r: 0.42, xp: 2, keep: 6.5, shotCd: 2.8 },
  guard:   { hp: 500, perLv: 90, speed: 1.9,  dmg: 26, r: 1.25, xp: 40, boss: 1 },
  lich:    { hp: 1000, perLv: 200, speed: 1.55, dmg: 20, r: 1.2,  xp: 0,  boss: 1, keep: 5.5 },
};
export const ENEMY_IDS = Object.keys(ENEMIES);   // index = typ ve snímku

export const TALENTS = {
  sila:   { name: "Ostří",          desc: "+20 % poškození",                    max: 5 },
  tempo:  { name: "Rychlá ruka",    desc: "Útočíš o 12 % častěji",              max: 5 },
  nohy:   { name: "Lehké boty",     desc: "+10 % rychlost běhu",                max: 3 },
  zivot:  { name: "Tuhý kořínek",   desc: "+30 životů a vyléčení",              max: 5 },
  regen:  { name: "Teplo ohně",     desc: "Obnova 1 života za sekundu",         max: 3 },
  magnet: { name: "Lapač duší",     desc: "Sbíráš duše o 40 % dál",             max: 3 },
  zbroj:  { name: "Kostěný pancíř", desc: "O 12 % menší zranění",               max: 3 },
  dosah:  { name: "Delší paže",     desc: "Útok sahá o 15 % dál",               max: 3 },
  vic:    { name: "Dvakrát měř",    desc: "Útok navíc v každém úderu",          max: 2 },
  svicky: { name: "Bludičky",       desc: "Světýlka kroužící kolem tebe",       max: 4 },
  nova:   { name: "Mrazivý dech",   desc: "Každé 4 s mráz kolem, zpomalí",      max: 3 },
  blesk:  { name: "Hromová ruka",   desc: "Každé 3 s blesk do několika kostí",  max: 4 },
  pouto:  { name: "Žhavé pouto",    desc: "Pouto pálí o 50 % víc",              max: 4, duo: 1 },
  dlouhe: { name: "Dlouhé pouto",   desc: "Pouto sahá o 3 m dál",               max: 2, duo: 1 },
  spolu:  { name: "Spolu v tom",    desc: "Blízko u sebe se oba léčíte",        max: 2, duo: 1 },
  vstan:  { name: "Vstávej!",       desc: "Kamaráda oživíš dvakrát rychleji",   max: 1, duo: 1 },
};
export const TALENT_IDS = Object.keys(TALENTS);

// ---------- hrdina ----------
export function makeHero(id, cls, name = "") {
  const c = CLASSES[cls];
  return { id, cls, name, x: id ? 1.6 : -1.6, z: 1.2, fx: 0, fz: 1, mx: 0, mz: 0, hp: c.hp, mh: c.hp, dn: 0, cd: 0.5,
    tl: {}, kills: 0, at: 0, nova: 2, blesk: 1.5, orb: 0, hurt: 0, orbHit: {}, an: "idle" };
}
const lvl = (h, id) => h.tl[id] || 0;
export const heroStats = h => {
  const a = CLASSES[h.cls].atk;
  return {
    dmg: a.dmg * (1 + 0.2 * lvl(h, "sila")),
    cd: a.cd / (1 + 0.12 * lvl(h, "tempo")),
    speed: CLASSES[h.cls].speed * (1 + 0.1 * lvl(h, "nohy")),
    range: a.range * (1 + 0.15 * lvl(h, "dosah")),
    armor: 1 - 0.12 * lvl(h, "zbroj"),
    mag: 2.2 * (1 + 0.4 * lvl(h, "magnet")),
  };
};

// Talenty k výběru: 3 různé, ne na maximu; duo talenty jen ve dvou.
export function offerTalents(h, r, duo) {
  const pool = TALENT_IDS.filter(id => lvl(h, id) < TALENTS[id].max && (duo || !TALENTS[id].duo));
  const out = [];
  while (out.length < 3 && pool.length) out.push(pool.splice((r() * pool.length) | 0, 1)[0]);
  return out;
}
export function applyTalent(h, id) {
  h.tl[id] = lvl(h, id) + 1;
  if (id === "zivot") { h.mh += 30; h.hp = Math.min(h.mh, h.hp + 60); }
}

// ---------- svět ----------
export function makeWorld(seed, opts = {}) {
  const r = rng(seed);
  const w = { seed, r, t: 0, tick: 0, nextId: 1, enemies: [], shots: [], eshots: [], gems: [], slams: [], props: [],
    xp: 0, level: 1, need: 6, pause: null, boss: null, guardDone: 0, lichOn: 0, over: null, duo: opts.duo !== false,
    spawnAcc: 0, pulse: 55, grid: new Map() };
  // hřbitov: hroby a stromy kolem táboráku (náhodně, ale s volným středem)
  const kinds = ["grave_A", "grave_B", "gravestone", "gravemarker_A", "gravemarker_B", "grave_A_destroyed"];
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = r.range(7, 22.5);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (w.props.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < 9)) continue;
    w.props.push({ k: r.pick(kinds), x, z, rot: r.range(-0.4, 0.4), s: 1, col: 0.55, grave: 1 });
  }
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2, d = r.range(11, 21);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (w.props.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < 12)) continue;
    w.props.push({ k: r.pick(["tree_dead_medium", "tree_dead_small", "tree_dead_large"]), x, z, rot: r() * 6.28, s: r.range(0.9, 1.25), col: 0.5 });
  }
  return w;
}

export const alive = h => h && !h.dn;
function nearestHero(heroes, x, z) {
  let best = null, bd = 1e9;
  for (const h of heroes) if (alive(h)) { const d = (h.x - x) ** 2 + (h.z - z) ** 2; if (d < bd) { bd = d; best = h; } }
  return best;
}

function spawn(w, type, x, z, out, rise = 1) {
  const E = ENEMIES[type], grow = 1 + w.t / 170;
  if (!E.boss && w.enemies.length >= MAX_ENEMIES) return null;
  // bossové rostou s úrovní týmu: silná dvojice se s Lichem pere ~1 min, slabší má do svítání 2 min
  const hp = Math.round(E.boss ? (E.hp + E.perLv * w.level) * (w.duo ? 1 : 0.75) : E.hp * grow);
  const e = { id: w.nextId++, type, x, z, hp, mh: hp, rise: rise ? 0.9 : 0, slow: 0, cd: E.shotCd ? 1 + w.r() * E.shotCd : 3, ab: 4, hit: 0 };
  w.enemies.push(e);
  if (E.boss) { w.boss = e; out.ev.push({ k: "boss", type, id: e.id }); }
  return e;
}

function spawnPoint(w, heroes) {
  for (let i = 0; i < 8; i++) {
    let x, z;
    if (w.r() < 0.35) { const g = w.r.pick(w.props.filter(p => p.grave)); if (!g) continue; x = g.x + w.r.range(-1, 1); z = g.z + w.r.range(0.8, 1.6); }
    else { const a = w.r() * Math.PI * 2, d = w.r.range(22, ARENA_R - 1); x = Math.cos(a) * d; z = Math.sin(a) * d; }
    if (heroes.every(h => (h.x - x) ** 2 + (h.z - z) ** 2 > 64)) return [x, z];
  }
  const a = w.r() * Math.PI * 2; return [Math.cos(a) * (ARENA_R - 1), Math.sin(a) * (ARENA_R - 1)];
}

function director(w, heroes, dt, out) {
  const t = w.t;
  if (!w.lichOn && t >= GUARD_AT && !w.guardDone) { w.guardDone = 1; const [x, z] = spawnPoint(w, heroes); spawn(w, "guard", x, z, out); }
  if (!w.lichOn && t >= RUN) { w.lichOn = 1; const [x, z] = spawnPoint(w, heroes); spawn(w, "lich", x, z, out); }
  const cap = Math.min(30 + t * 0.5, 230) * (w.duo ? 1 : 0.8) * (w.boss ? (w.boss.type === "lich" ? 0.3 : 0.6) : 1);   // u Licha jde hlavně o souboj s ním
  w.spawnAcc += dt * (1.4 + t / 32);
  while (w.spawnAcc >= 1) {
    w.spawnAcc -= 1;
    if (w.enemies.length >= cap) break;
    const roll = w.r(); let type = "minion";
    if (t > 150 && roll < 0.12) type = "mage"; else if (t > 90 && roll < 0.3) type = "warrior"; else if (t > 40 && roll < 0.5) type = "rogue";
    const [x, z] = spawnPoint(w, heroes); spawn(w, type, x, z, out);
  }
  // každou minutu obklíčení: kruh kostí kolem hráčů
  w.pulse -= dt;
  if (w.pulse <= 0 && !w.boss) {
    w.pulse = 60;
    const h = nearestHero(heroes, 0, 0);
    if (h) {
      const n = Math.min(14 + Math.floor(t / 30) * 2, 34);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, d = 9.5;
        let x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d;
        const l = Math.hypot(x, z); if (l > ARENA_R - 1) { x *= (ARENA_R - 1) / l; z *= (ARENA_R - 1) / l; }
        spawn(w, t > 120 && i % 3 === 0 ? "warrior" : "minion", x, z, out);
      }
      out.ev.push({ k: "pulse" });
    }
  }
}

const CELL = 1.6;
function gridBuild(w) {
  w.grid.clear();
  for (const e of w.enemies) {
    const k = ((Math.floor(e.x / CELL) + 64) << 8) | (Math.floor(e.z / CELL) + 64);
    let c = w.grid.get(k); if (!c) w.grid.set(k, c = []); c.push(e);
  }
}
export function near(w, x, z, rad, fn) {
  const x0 = Math.floor((x - rad) / CELL), x1 = Math.floor((x + rad) / CELL), z0 = Math.floor((z - rad) / CELL), z1 = Math.floor((z + rad) / CELL);
  for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
    const c = w.grid.get(((i + 64) << 8) | (j + 64)); if (c) for (const e of c) fn(e);
  }
}

function moveEnemies(w, heroes, dt, out) {
  gridBuild(w);
  for (const e of w.enemies) {
    const E = ENEMIES[e.type];
    if (e.rise > 0) { e.rise -= dt; continue; }
    e.hit = Math.max(0, e.hit - dt); e.slow = Math.max(0, e.slow - dt);
    const h = nearestHero(heroes, e.x, e.z); if (!h) continue;
    let dx = h.x - e.x, dz = h.z - e.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    let sp = E.speed * (e.slow > 0 ? 0.45 : 1) * (1 + Math.min(w.t / 600, 0.35));
    if (E.keep && d < E.keep) sp = d < E.keep - 1.5 ? -sp * 0.6 : 0;
    let vx = dx * sp, vz = dz * sp;
    // rozestup od sousedů, ať se nesbalí do jedné koule
    near(w, e.x, e.z, E.r * 2.2, o => {
      if (o === e) return;
      const ox = e.x - o.x, oz = e.z - o.z, dd = ox * ox + oz * oz, m = E.r + ENEMIES[o.type].r;
      if (dd < m * m && dd > 1e-6) { const l = Math.sqrt(dd), push = (m - l) / m * 3.2; vx += ox / l * push; vz += oz / l * push; }
    });
    e.x += vx * dt; e.z += vz * dt;
    e.fx = dx; e.fz = dz;
    for (const p of w.props) {
      const ox = e.x - p.x, oz = e.z - p.z, m = p.col + E.r, dd = ox * ox + oz * oz;
      if (dd < m * m && dd > 1e-6) { const l = Math.sqrt(dd); e.x = p.x + ox / l * m; e.z = p.z + oz / l * m; }
    }
    const l = Math.hypot(e.x, e.z); if (l > ARENA_R - E.r) { e.x *= (ARENA_R - E.r) / l; e.z *= (ARENA_R - E.r) / l; }
    // střelci a bossové
    if (E.shotCd || E.boss) e.cd -= dt;
    if (e.type === "mage" && e.cd <= 0 && d < 11) { e.cd = E.shotCd; shoot(w, e, h, 0, 6.5, 10); }
    if (e.type === "guard" && e.cd <= 0) {
      e.cd = 4.6; const s = { id: w.nextId++, x: h.x, z: h.z, r: 3.2, t: 1.25, dmg: 34 };
      w.slams.push(s); out.ev.push({ k: "slam", id: s.id, x: s.x, z: s.z, r: s.r, t: s.t, dmg: s.dmg, by: e.id });
    }
    if (e.type === "lich") {
      e.ab -= dt;
      if (e.cd <= 0) { e.cd = 2.6; for (let i = -2; i <= 2; i++) shoot(w, e, h, i * 0.22, 5.5, 11); out.ev.push({ k: "cast", id: e.id }); }
      if (e.ab <= 0) {
        e.ab = 9;
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; spawn(w, i % 4 ? "minion" : "rogue", e.x + Math.cos(a) * 2.6, e.z + Math.sin(a) * 2.6, out); }
        out.ev.push({ k: "summon", id: e.id });
      }
    }
  }
}

function shoot(w, e, h, spread, speed, dmg) {
  let dx = h.x - e.x, dz = h.z - e.z; const a = Math.atan2(dz, dx) + spread;
  w.eshots.push({ id: w.nextId++, x: e.x, z: e.z, vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, life: 4, dmg });
}

function tether(w, heroes, dt, out) {
  const [a, b] = heroes;
  if (!alive(a) || !alive(b)) return;
  const max = TETHER_MAX + 3 * (lvl(a, "dlouhe") + lvl(b, "dlouhe"));
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
  if (L2 > max * max || L2 < 0.25) return;
  const dps = 26 * (1 + 0.5 * (lvl(a, "pouto") + lvl(b, "pouto"))) * (1 + w.t / 400);
  const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, L = Math.sqrt(L2);
  const hits = [[], []];
  near(w, cx, cz, L / 2 + 1, e => {
    if (e.rise > 0) return;
    const t = Math.max(0, Math.min(1, ((e.x - a.x) * dx + (e.z - a.z) * dz) / L2));
    const px = a.x + dx * t - e.x, pz = a.z + dz * t - e.z, m = 0.55 + ENEMIES[e.type].r;
    if (px * px + pz * pz < m * m) hits[t < 0.5 ? 0 : 1].push([e.id, dps * dt]);
  });
  if (hits[0].length) applyHits(w, hits[0], a.id, out, 1);
  if (hits[1].length) applyHits(w, hits[1], b.id, out, 1);
}

// zásahy: [[id, dmg, zpomalení s?], …] od hrdiny `by`; vrací počet zabitých
export function applyHits(w, hits, by, out, quiet) {
  let k = 0;
  if (!w.byId || w.byIdTick !== w.tick || w.byId.size !== w.enemies.length) { w.byId = new Map(w.enemies.map(e => [e.id, e])); w.byIdTick = w.tick; }
  for (const [id, dmg, slow] of hits) {
    const e = w.byId.get(id);
    if (!e || e.hp <= 0) continue;
    e.hp -= dmg; if (!quiet) e.hit = 0.12; if (slow) e.slow = Math.max(e.slow, slow);
    if (e.hp <= 0) { kill(w, e, by, out); k++; }
  }
  if (k) { w.enemies = w.enemies.filter(e => e.hp > 0); w.byId = null; }
  return k;
}
function kill(w, e, by, out) {
  const E = ENEMIES[e.type];
  out.ev.push({ k: "die", id: e.id, x: +e.x.toFixed(2), z: +e.z.toFixed(2), type: e.type, by });
  out.kills[by] = (out.kills[by] || 0) + 1;
  if (E.xp) w.gems.push({ id: w.nextId++, x: e.x, z: e.z, v: E.xp, big: E.xp >= 3 ? 1 : 0, fly: 0 });
  if (w.r() < 0.012 && !E.boss) w.gems.push({ id: w.nextId++, x: e.x, z: e.z, v: 0, heal: 1, fly: 0 });
  if (e === w.boss) {
    w.boss = null;
    if (e.type === "lich") { w.over = { win: 1 }; out.ev.push({ k: "over", win: 1 }); }
    else for (let i = 0; i < 10; i++) w.gems.push({ id: w.nextId++, x: e.x + w.r.range(-2, 2), z: e.z + w.r.range(-2, 2), v: 4, big: 1, fly: 0 });
  }
}

function gems(w, heroes, dt, out) {
  for (const g of w.gems) {
    let best = null, bd = 1e9;
    for (const h of heroes) if (alive(h)) {
      const d = Math.hypot(h.x - g.x, h.z - g.z), m = heroStats(h).mag;
      if ((d < m || g.fly) && d < bd) { bd = d; best = h; }
    }
    if (!best) continue;
    g.fly = 1;
    if (bd < 0.6) {
      g.dead = 1;
      if (g.heal) out.ev.push({ k: "heal", hero: best.id, v: 35 });
      else { w.xp += g.v; out.ev.push({ k: "soul", hero: best.id, v: g.v }); }
      continue;
    }
    const sp = Math.min(16, 6 + (heroStats(best).mag - bd) * 3) * dt;
    g.x += (best.x - g.x) / bd * Math.min(sp * 1.6, bd); g.z += (best.z - g.z) / bd * Math.min(sp * 1.6, bd);
  }
  w.gems = w.gems.filter(g => !g.dead);
  if (w.gems.length > 160) { // stará drobotina se slije do jedné velké duše
    const old = w.gems.splice(0, 40), v = old.reduce((s, g) => s + g.v, 0);
    w.gems.push({ id: w.nextId++, x: old[0].x, z: old[0].z, v, big: 1, fly: 0 });
  }
}

export const needFor = level => Math.round(5 + level * 3.4 + level * level * 0.32);

// Hostitel: jeden krok světa. heroes = [h0, h1|null] v aktuálním stavu (h1 od hosta-hráče ze sítě nebo bot).
export function stepWorld(w, heroes, dt) {
  const out = { ev: [], kills: {} };
  if (w.over) return out;
  if (w.pause) return out;
  w.t += dt; w.tick++;
  if (heroes.every(h => !h || h.dn)) { w.over = { win: 0 }; out.ev.push({ k: "over", win: 0 }); return out; }
  if (w.t >= DAWN) { w.over = { win: 1, dawn: 1 }; out.ev.push({ k: "over", win: 1, dawn: 1 }); return out; }
  director(w, heroes.filter(Boolean), dt, out);
  moveEnemies(w, heroes.filter(Boolean), dt, out);
  for (const s of w.eshots) { s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt; }
  w.eshots = w.eshots.filter(s => s.life > 0 && s.x * s.x + s.z * s.z < ARENA_R * ARENA_R &&
    !heroes.some(h => alive(h) && (h.x - s.x) ** 2 + (h.z - s.z) ** 2 < 0.36));
  for (const s of w.slams) s.t -= dt;
  w.slams = w.slams.filter(s => s.t > -0.3);
  if (heroes[1]) tether(w, heroes, dt, out);
  gems(w, heroes, dt, out);
  if (w.xp >= w.need) {
    w.xp -= w.need; w.level++; w.need = needFor(w.level);
    const offers = heroes.map(h => h ? offerTalents(h, w.r, !!heroes[1]) : null);
    w.pause = { level: w.level, offers, picked: heroes.map(h => !h) };
    out.ev.push({ k: "lvl", level: w.level, offers });
  }
  return out;
}
// výběr talentu (hostitel); vrací true, když už vybrali oba a hra běží dál
export function pickTalent(w, heroId, id) {
  const p = w.pause; if (!p || p.picked[heroId]) return false;
  if (!p.offers[heroId].includes(id)) id = p.offers[heroId][0];
  p.picked[heroId] = id;
  if (p.picked.every(Boolean)) { w.pause = null; return true; }
  return false;
}

// ---------- hrdina: krok na zařízení jeho majitele ----------
// view = svět, jak ho vidí tento klient (u hosta přímo w; u hosta-hráče snímek) – potřebuje enemies, eshots, slams, props.
export function stepHero(view, h, input, dt, partner) {
  const out = { hits: [], fx: [] };
  if (h.dn) { h.an = "down"; return out; }
  const S = heroStats(h);
  let mx = input.mx || 0, mz = input.mz || 0; const m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; }
  h.mx = mx; h.mz = mz;
  h.x += mx * S.speed * dt; h.z += mz * S.speed * dt;
  for (const p of view.props) {
    const ox = h.x - p.x, oz = h.z - p.z, mm = p.col + 0.45, dd = ox * ox + oz * oz;
    if (dd < mm * mm && dd > 1e-6) { const l = Math.sqrt(dd); h.x = p.x + ox / l * mm; h.z = p.z + oz / l * mm; }
  }
  const l = Math.hypot(h.x, h.z); if (l > ARENA_R - 0.6) { h.x *= (ARENA_R - 0.6) / l; h.z *= (ARENA_R - 0.6) / l; }
  if (m > 0.15) { h.fx = mx / Math.max(m, 1e-3) * Math.min(m, 1); h.fz = mz / Math.max(m, 1e-3) * Math.min(m, 1); const fl = Math.hypot(h.fx, h.fz); h.fx /= fl; h.fz /= fl; }
  h.an = m > 0.15 ? "run" : "idle";

  const live = view.enemies.filter(e => !(e.rise > 0) && !e.gone);
  const nearest = (rad) => { let b = null, bd = rad * rad; for (const e of live) { const d = (e.x - h.x) ** 2 + (e.z - h.z) ** 2; if (d < bd) { bd = d; b = e; } } return b; };
  // cíl: boss v dosahu má přednost, jinak nejbližší kost (jinak by se přes jeho přivolané kosti nedal ustřelit)
  const target = (rad) => { for (const e of live) if (ENEMIES[e.type].boss) { const rr = rad + ENEMIES[e.type].r; if ((e.x - h.x) ** 2 + (e.z - h.z) ** 2 < rr * rr) return e; } return nearest(rad); };
  const hitAt = (x, z, rad, dmg, slow) => {
    let n = 0;
    for (const e of live) { const rr = rad + ENEMIES[e.type].r; if ((e.x - x) ** 2 + (e.z - z) ** 2 < rr * rr) { out.hits.push(slow ? [e.id, dmg, slow] : [e.id, dmg]); n++; } }
    return n;
  };

  // hlavní útok
  h.cd -= dt;
  const a = CLASSES[h.cls].atk, extra = lvl(h, "vic");
  if (h.cd <= 0) {
    if (a.kind === "slash" || a.kind === "spin") {
      const t = target(S.range + 0.8);
      if (t) {
        h.cd = S.cd; h.at++;
        if (a.kind === "slash") {
          const dx = t.x - h.x, dz = t.z - h.z, d = Math.hypot(dx, dz) || 1; h.fx = dx / d; h.fz = dz / d;
          for (let i = 0; i <= extra; i++) {
            const reach = S.range * (1 + i * 0.35);
            for (const e of live) {
              const ex = e.x - h.x, ez = e.z - h.z, ed = Math.hypot(ex, ez);
              if (ed < reach + ENEMIES[e.type].r && (ex * h.fx + ez * h.fz) / (ed || 1) > -0.15) out.hits.push([e.id, S.dmg]);
            }
          }
          out.fx.push({ k: "slash", x: h.x, z: h.z, fx: h.fx, fz: h.fz, r: S.range * (1 + extra * 0.35) });
        } else {
          hitAt(h.x, h.z, S.range * (1 + extra * 0.25), S.dmg);
          out.fx.push({ k: "spin", x: h.x, z: h.z, r: S.range * (1 + extra * 0.25) });
        }
        h.an = "attack";
      }
    } else if (a.kind === "bolt") {
      const t = target(S.range);
      if (t) {
        h.cd = S.cd; h.at++;
        const dx = t.x - h.x, dz = t.z - h.z, d = Math.hypot(dx, dz) || 1; h.fx = dx / d; h.fz = dz / d;
        for (let i = 0; i <= extra; i++) {
          const ang = Math.atan2(dz, dx) + (i - extra / 2) * 0.18;
          view.shots.push({ o: h.id, k: "bolt", x: h.x, z: h.z, vx: Math.cos(ang) * a.speed, vz: Math.sin(ang) * a.speed, life: S.range / a.speed + 0.1, dmg: S.dmg, pierce: 0, done: {} });
        }
        h.an = "attack";
      }
    } else if (a.kind === "dagger") {
      h.cd = S.cd; h.at++;
      let dx = h.fx, dz = h.fz;
      const t = target(S.range); if (t) { const d = Math.hypot(t.x - h.x, t.z - h.z) || 1; dx = (t.x - h.x) / d; dz = (t.z - h.z) / d; }
      for (let i = 0; i <= extra; i++) {
        const ang = Math.atan2(dz, dx) + (i - extra / 2) * 0.2;
        view.shots.push({ o: h.id, k: "dagger", x: h.x, z: h.z, vx: Math.cos(ang) * a.speed, vz: Math.sin(ang) * a.speed, life: S.range / a.speed, dmg: S.dmg, pierce: 1, done: {} });
      }
      h.an = "attack";
    }
  }
  // vlastní střely
  for (const s of view.shots) {
    if (s.o !== h.id) continue;
    s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt;
    for (const e of live) {
      if (s.done[e.id]) continue;
      const rr = 0.3 + ENEMIES[e.type].r;
      if ((e.x - s.x) ** 2 + (e.z - s.z) ** 2 < rr * rr) { out.hits.push([e.id, s.dmg]); s.done[e.id] = 1; if (s.pierce-- <= 0) { s.life = 0; break; } }
    }
  }
  view.shots = view.shots.filter(s => s.life > 0);
  // bludičky
  const nOrb = lvl(h, "svicky");
  if (nOrb) {
    h.orb += dt * 2.6;
    for (const k in h.orbHit) if ((h.orbHit[k] -= dt) <= 0) delete h.orbHit[k];
    for (let i = 0; i < nOrb; i++) {
      const ang = h.orb + i / nOrb * Math.PI * 2, ox = h.x + Math.cos(ang) * 1.9, oz = h.z + Math.sin(ang) * 1.9;
      for (const e of live) {
        if (h.orbHit[e.id]) continue;
        const rr = 0.45 + ENEMIES[e.type].r;
        if ((e.x - ox) ** 2 + (e.z - oz) ** 2 < rr * rr) { out.hits.push([e.id, 9 + 3 * nOrb]); h.orbHit[e.id] = 0.5; }
      }
    }
  }
  // mrazivý dech
  if (lvl(h, "nova")) {
    h.nova -= dt;
    if (h.nova <= 0) { h.nova = 4; const r = 3.2 + lvl(h, "nova") * 0.6; hitAt(h.x, h.z, r, 8 * lvl(h, "nova"), 1.2 + 0.4 * lvl(h, "nova")); out.fx.push({ k: "nova", x: h.x, z: h.z, r }); }
  }
  // blesk
  if (lvl(h, "blesk")) {
    h.blesk -= dt;
    if (h.blesk <= 0) {
      h.blesk = 3; const n = 1 + lvl(h, "blesk");
      const pool = live.filter(e => (e.x - h.x) ** 2 + (e.z - h.z) ** 2 < 100).sort((p, q) => q.hp - p.hp).slice(0, n);
      for (const e of pool) { out.hits.push([e.id, 30 + 10 * lvl(h, "blesk")]); out.fx.push({ k: "zap", x: e.x, z: e.z, fx: h.x, fz: h.z }); }
    }
  }
  // zranění: dotyk, střely, dopady bosse
  let dmg = 0;
  for (const e of live) { const rr = ENEMIES[e.type].r + 0.42; if ((e.x - h.x) ** 2 + (e.z - h.z) ** 2 < rr * rr) dmg += ENEMIES[e.type].dmg * dt * dmgScale(view.t || 0); }
  h.shotHit = h.shotHit || {};
  for (const s of view.eshots) if (!h.shotHit[s.id] && (s.x - h.x) ** 2 + (s.z - h.z) ** 2 < 0.36) { h.shotHit[s.id] = 1; dmg += s.dmg; out.fx.push({ k: "ouch", x: h.x, z: h.z }); }
  h.slamHit = h.slamHit || {};
  for (const s of view.slams) if (s.t <= 0 && !h.slamHit[s.id] && (s.x - h.x) ** 2 + (s.z - h.z) ** 2 < s.r * s.r) { h.slamHit[s.id] = 1; dmg += s.dmg; out.fx.push({ k: "ouch", x: h.x, z: h.z, big: 1 }); }
  // léčení
  let heal = 0.8 * lvl(h, "regen") * 1.25;
  if (partner && alive(partner) && (lvl(h, "spolu") + lvl(partner, "spolu")) && (partner.x - h.x) ** 2 + (partner.z - h.z) ** 2 < 25) heal += 2 * (lvl(h, "spolu") + lvl(partner, "spolu"));
  h.hp = Math.min(h.mh, h.hp - dmg * S.armor + heal * dt);
  h.hurt = dmg > 0 ? 0.25 : Math.max(0, h.hurt - dt);
  if (h.hp <= 0) { h.hp = 0; h.dn = 1; h.rev = 0; out.fx.push({ k: "down", x: h.x, z: h.z }); }
  return out;
}

// oživení: počítá majitel padlého hrdiny podle polohy kamaráda; vrací true při oživení
export function stepRevive(h, partner, dt) {
  if (!h.dn || !alive(partner)) { if (h.dn) h.rev = Math.max(0, (h.rev || 0) - dt); return false; }
  const close = (partner.x - h.x) ** 2 + (partner.z - h.z) ** 2 < 2.4;
  const need = (lvl(h, "vstan") || lvl(partner, "vstan")) ? 1.5 : 3;
  h.rev = close ? (h.rev || 0) + dt / need : Math.max(0, (h.rev || 0) - dt);
  if (h.rev >= 1) { h.dn = 0; h.rev = 0; h.hp = Math.round(h.mh * 0.5); return true; }
  return false;
}

// ---------- síť: snímky ----------
const q = v => Math.round(v * 20);   // pozice po 5 cm
export function snapshot(w) {
  const e = [];
  for (const x of w.enemies) e.push(x.id, q(x.x), q(x.z), ENEMY_IDS.indexOf(x.type), Math.max(0, Math.ceil(x.hp)), (x.rise > 0 ? 1 : 0) | (x.slow > 0 ? 2 : 0) | (x.hit > 0 ? 4 : 0));
  const g = [];
  for (const x of w.gems) g.push(x.id, q(x.x), q(x.z), x.heal ? 2 : x.big ? 1 : 0);
  const s = [];
  for (const x of w.eshots) s.push(x.id, q(x.x), q(x.z), q(x.vx), q(x.vz), x.dmg);
  return { k: w.tick, t: +w.t.toFixed(2), e, g, s, xp: w.xp, need: w.need, lv: w.level, bh: w.boss ? [w.boss.id, w.boss.mh] : 0 };
}
export function readSnapshot(snap) {
  const enemies = [], gems = [], eshots = [];
  for (let i = 0; i < snap.e.length; i += 6) {
    const type = ENEMY_IDS[snap.e[i + 3]], f = snap.e[i + 5];
    enemies.push({ id: snap.e[i], x: snap.e[i + 1] / 20, z: snap.e[i + 2] / 20, type, hp: snap.e[i + 4], rise: f & 1 ? 0.5 : 0, slow: f & 2 ? 1 : 0, hit: f & 4 ? 0.1 : 0 });
  }
  for (let i = 0; i < snap.g.length; i += 4) gems.push({ id: snap.g[i], x: snap.g[i + 1] / 20, z: snap.g[i + 2] / 20, big: snap.g[i + 3] === 1 ? 1 : 0, heal: snap.g[i + 3] === 2 ? 1 : 0 });
  for (let i = 0; i < snap.s.length; i += 6) eshots.push({ id: snap.s[i], x: snap.s[i + 1] / 20, z: snap.s[i + 2] / 20, vx: snap.s[i + 3] / 20, vz: snap.s[i + 4] / 20, dmg: snap.s[i + 5] });
  return { enemies, gems, eshots };
}
// hrdina po síti
const HERO_KEYS = ["id", "cls", "name", "x", "z", "fx", "fz", "mx", "mz", "hp", "mh", "dn", "rev", "tl", "kills", "at", "an", "hurt", "orb"];
export const packHero = h => { const o = {}; for (const k of HERO_KEYS) o[k] = typeof h[k] === "number" ? +h[k].toFixed(3) : h[k]; return o; };
export const unpackHero = (h, o) => { for (const k of HERO_KEYS) if (k in o) h[k] = o[k]; return h; };
