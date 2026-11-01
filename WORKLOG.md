# Deník – Kostlivá noc

Nejnovější nahoře. Kontrakt modulů: `SPEC.md`. Pravidla kola her: `../HRY-KOLO-2026-11-01.md`, Herna: `../HERNA-PROTOKOL.md`.

## 2026-11-02 noc – Pracant dodělává (rozpracováno, průběžný stav)
- Hotovo: oprava závodu `addHero` (zdvojení hrdinů/kroužků), menší modely (SK_S 0.78, HERO_S 0.88), světlejší scéna, širší
  kamera na výšku (fov/vzdálenost podle poměru stran, mlha s ní), záblesk bosse omezen; balanc: boss v dosahu má přednost
  při míření, HP bossů roste s úrovní týmu (Lich 1000+200·lv, strážce 500+90·lv), u Licha řidší horda, mírnější křivka XP,
  zloděj míří na nejbližší, rytíř delší sek. Testovací háčky `__kn()`, `__knScene()`, `__knAuto`, `__knSpeed`.
- Síť OPRAVENO: snímek přepisoval `t:"s"` časem (guest neviděl nepřátele) a hostitel při pauze/konci neposílal eventy
  (level-up a konec by u guesta nikdy nenastaly). Mág: klobouky/pláště hrdinů zpět (černá „hlava“ byly vlasy bez klobouku).
  Adaptivní pixel ratio (jen dolů při průměru > 24 ms), ztlumené pozadí konce.
- Testy: `tests/harness.cjs` (server + mock mantledb + rámec Herny), `tests/solo.cjs` chromium exit 0, webkit iPhone 13
  exit 0; `tests/duo.cjs herna` exit 0; `tests/duo.cjs link` exit 0 (chromium host + webkit guest, relay; Lich padl).
  sim/net/p2p exit 0.
- Nasazeno: repo `sachasportrezervace-arch/kostliva-noc` (fd7dc80), Pages živě, `node tests/live.cjs` exit 0 (oba prohlížeče).
- Herna: ef149d2 pushnuto (games.json + ikona kostlivec + deník), lokálně `tests/herna.cjs` 269 PASS / 0 FAIL.
- Design-eye kolo 1: „téměř“; prázdné snímky hry na iPhonu = artefakt Playwright WebKit po změně velikosti canvasu
  (canvas má 187 barev přes drawImage, kreslí dál) → testy nastavují `__knNoAdapt`. Opravy kola 1 v e5771cd (lokálně,
  nepushnuto): titul s oběma hrdiny, jména u skóre 19 px, kamera na výšku blíž, tmavší kostlivci, větší kroužky, konec čitelnější.
- Výkon WebKit iPhone 13, 223 nepřátel: sim 0,55 ms/krok, render JS 3,1 ms, 113 draw callů (snímek 196 ms = softwarové
  vykreslování headless, ne telefon).
- Dál: design-eye kolo 2 na nových snímcích, push, `node tests/live.cjs`.

## 2026-11-01 ~23:00 – PŘEDÁVKA (hlavní session má plný kontext, dodělává subagent Pracant)
- Hotovo navíc: `src/scene.js` (three: zapečení chůze kostlivců do 10 snímků × InstancedMesh, hrdinové SkinnedMesh,
  bossové, pouto, efekty přes Points shader, kamera), `src/main.js` (titul, lobby s výběrem postavy, sólo s botem Kostíkem,
  výzva `#r.<id>`, Herna protokol v1, level-up karty, HUD, konec + MVP do Herny), `src/audio.js`, `index.html`,
  `tools/serve.cjs` (port 8787), `.claude/launch.json`. `node --check` OK.
- NEOVĚŘENO: nic z toho ještě neběželo v prohlížeči (scene/main/index). Testy sim/net/p2p zelené.
- Další krok: `node tools/serve.cjs` → otevřít `http://localhost:8787/#solo`, opravit chyby v konzoli, zahrát sólo celé,
  pak 2 kontexty host/guest (mock mantledb jako v `tests/p2p.cjs`), Playwright testy `tests/solo.cjs`, `tests/duo.cjs`
  (Chromium + WebKit iPhone 13), design-eye, repo + Pages, Herna.
- Otevřené: vyvážení (boti v `tests/sim.test.mjs` skoro neumírají, Lich těžko padá – po playtestu doladit),
  velikost assets 5,5 MB (hrdinové se načítají až po výběru).

## 2026-11-01 noc – stavba v1 (session hlavní, Mark: „gogo udělej to beze mě přes noc“)
- PŘEVZATO 1. 11. – stavba nové hry, hlavní session (scratch „hry“); jiná session sem nepíše.
- Hotovo: `tools/assets.mjs` (CC0 KayKit Adventurers/Skeletons/Halloween Bits → `assets/`, 5,5 MB), `src/sim.js`
  (svět, hrdinové, talenty, pouto, oživení, bossové, snímky), `src/bot.js`, `src/net.js` (WebRTC + relay mantledb, subagent),
  testy `tests/sim.test.mjs`, `tests/net.test.mjs`, `tests/p2p.cjs` zelené.
- Dál: `src/scene.js` (three: zapečená chůze kostlivců do InstancedMesh, hrdinové se skinningem, efekty),
  `src/main.js` + `index.html` (obrazovky, HUD, joystick, sólo s botem, výzva, Herna), `src/audio.js`, serve, Playwright,
  design-eye, GitHub repo `sachasportrezervace-arch/kostliva-noc` + Pages, přidat do Herny.
- Zdroj modelů: `../_dl-kaykit` (git clone, není v repu hry).
