# Deník – Kostlivá noc

Nejnovější nahoře. Kontrakt modulů: `SPEC.md`. Pravidla kola her: `../HRY-KOLO-2026-11-01.md`, Herna: `../HERNA-PROTOKOL.md`.

## 2026-11-02 noc – v1 živě (Pracant, hotovo)
- **Hotovo:** hra https://sachasportrezervace-arch.github.io/kostliva-noc/ (repo `sachasportrezervace-arch/kostliva-noc`,
  Pages main /, commity fd7dc80, e5771cd, d69018d). V Herně jako 12. hra (herna ef149d2: games.json, ikona `kostlivec`, deník).
  Opravy: síť (snímek přepisoval `t:"s"` časem → guest neviděl nepřátele; host při pauze/konci neposílal eventy → level-up
  a konec by u guesta nikdy nenastaly), závod `addHero`, klobouky/pláště hrdinů, kamera na výšku + zastavení u plotu,
  světlo, značky hrdinů, adaptivní pixel ratio, design-eye 3 kola. Balanc: boss v dosahu má přednost při míření, HP bossů
  roste s úrovní (Lich 1000+200·lv, strážce 500+90·lv), u Licha řidší horda, mírnější XP křivka, zloděj míří, rytíř delší sek.
- **Ověřeno (příkaz → exit):** `node tests/sim.test.mjs` 0 · `node tests/net.test.mjs` 0 (9 testů) · `node tests/p2p.cjs` 0 (3) ·
  `node tests/solo.cjs` chromium 0 (Lich padl t=580, úr. 21, max 240 nepřátel) + webkit iPhone 13 0 · `node tests/duo.cjs link` 0
  (chromium host + webkit guest přes relay, pohyb obou, zásahy guesta 110 zabití na hostu, level-up čeká na oba, konec u obou,
  odveta) · `node tests/duo.cjs herna` 0 (iframe, 1 vysledek/okno, stejné partie, jina-hra, tlačítka v 613 px) ·
  `node tests/live.cjs` 0 (živě chromium + webkit) · Herna `tests/herna.cjs` lokálně 269 PASS / 0 FAIL, games.json živě.
  Simulace „lidské“ dvojice: Lich za 63–98 s (2 ze 4 párů), slabší pár do svítání. Výkon WebKit iPhone 13 s 223 nepřáteli:
  sim 0,55 ms/krok, render JS 3,1 ms, 113 draw callů.
- **Design-eye:** kolo 3 „téměř, hodně blízko k profi indie hra“ (limit 3 kol vyčerpán).
- **NEOVĚŘENO:** skutečný iPhone (fps, GPU, zvuk, váha písma Baloo 2), WebRTC s WebKitem (v testu jen relay), Herna
  `tests/mistnost-hry.cjs` Kostlivou noc nezná. Playwright WebKit po změně velikosti canvasu fotí prázdnou plochu
  (canvas kreslí dál, ověřeno drawImage) → testy mají `__knNoAdapt`.
- **Dál:** (1) značka nad hlavou hrdiny skoro není vidět – zvětšit/zjasnit, (2) rytíř přepálený (červený záblesk zranění
  v hordě + heroLight) – omezit, (3) rekvizity blíž ~6 m ke kameře zmenšit/skrýt, jméno bosse s tmavým stínem,
  (4) HUD za level-upem schovat; přidat kostliva-noc do `herna/tests/mistnost-hry.cjs`; playtest na dvou iPhonech.

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
