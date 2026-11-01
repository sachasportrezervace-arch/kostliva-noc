// Bot: vstup pro hrdinu z toho, co vidí (parťák v sólu, testy). Utíká před hustou kostí, sbírá duše,
// drží se v dosahu pouta a oživuje padlého kamaráda. Hratelný, ne dokonalý.
import { ARENA_R, ENEMIES, CLASSES, alive } from "./sim.js";

export function botInput(view, h, partner, t) {
  if (h.dn) return { mx: 0, mz: 0 };
  let ax = 0, az = 0;
  for (const e of view.enemies) {
    const dx = h.x - e.x, dz = h.z - e.z, d2 = dx * dx + dz * dz;
    if (d2 < 49 && d2 > 1e-4) { const w = (ENEMIES[e.type].boss ? (h.hp > h.mh * 0.45 ? 1.5 : 6) : 1) / d2; ax += dx * w; az += dz * w; }
  }
  for (const s of view.eshots || []) { const dx = h.x - s.x, dz = h.z - s.z, d2 = dx * dx + dz * dz; if (d2 < 9) { ax += dx / d2 * 3; az += dz / d2 * 3; } }
  for (const s of view.slams || []) { const dx = h.x - s.x, dz = h.z - s.z, d = Math.hypot(dx, dz); if (d < s.r + 0.8) { ax += dx / (d || 1) * 4; az += dz / (d || 1) * 4; } }
  let g = null, gd = 64;
  for (const x of view.gems) { const d = (x.x - h.x) ** 2 + (x.z - h.z) ** 2; if (d < gd) { gd = d; g = x; } }
  if (g) { const d = Math.sqrt(gd) || 1; ax += (g.x - h.x) / d * 0.35; az += (g.z - h.z) / d * 0.35; }
  if (partner) {
    const dx = partner.x - h.x, dz = partner.z - h.z, d = Math.hypot(dx, dz) || 1;
    if (!alive(partner)) { ax += dx / d * 2.5; az += dz / d * 2.5; }
    else if (d > 8) { ax += dx / d * (d - 8) * 0.25; az += dz / d * (d - 8) * 0.25; }
    else if (d < 4) { const k = d < 1.5 ? 1.2 : 0.3; ax -= dx / d * k; az -= dz / d * k; }
    // kroužit kolem kamaráda: pouto tak zametá kosti
    ax += -dz / d * 0.25 * Math.sin(t * 0.3 + 1); az += dx / d * 0.25 * Math.sin(t * 0.3 + 1);
  }
  // na bosse se jde, dokud je dost života (zblízka u rytíře a barbara, z dálky u ostatních)
  const boss = view.enemies.find(e => ENEMIES[e.type].boss && !(e.rise > 0));
  if (boss && h.hp > h.mh * 0.45) {
    const a = CLASSES[h.cls].atk, want = a.kind === "slash" || a.kind === "spin" ? a.range * 0.8 + 1.2 : a.range * 0.7;
    const dx = boss.x - h.x, dz = boss.z - h.z, d = Math.hypot(dx, dz) || 1;
    if (d > want) { ax += dx / d * 1.4; az += dz / d * 1.4; }
  }
  const l = Math.hypot(h.x, h.z);
  if (l > ARENA_R - 5) { ax -= h.x / l * (l - ARENA_R + 5) * 0.6; az -= h.z / l * (l - ARENA_R + 5) * 0.6; }
  const m = Math.hypot(ax, az);
  return m < 0.05 ? { mx: 0, mz: 0 } : { mx: ax / m, mz: az / m };
}
