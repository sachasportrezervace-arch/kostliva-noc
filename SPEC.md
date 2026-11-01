# Kostlivá noc – specifikace (kontrakt mezi moduly)

Mobilní co-op hordovka pro dva (Mark a Radka, každý na svém telefonu) à la Vampire Survivors. Low-poly CC0 modely
KayKit (Kay Lousberg). Statické soubory na GitHub Pages (`sachasportrezervace-arch.github.io/kostliva-noc/`), bez buildu:
`index.html` + ES moduly v `src/`, `three` přes importmap z `vendor/`. Jazyk UI čeština, tykání, krátce, vtipně.

## Hra
- Kruhová aréna (hřbitov, poloměr 26 m), uprostřed táborák. Kamera šikmo shora, sleduje vlastního hráče.
- Ovládání: plovoucí joystick palcem (kdekoli ve spodních 2/3), na PC WASD/šipky. Útok je automatický.
- Běh 8 min. Vlny houstnou, ve 4:00 mini-boss Kostěný strážce, v 8:00 Lich. Zabitý Lich = výhra. Oba padlí = prohra.
- Postavy: rytíř (seknutí před sebe), mág (střela na nejbližšího), barbar (točivý útok kolem), zloděj (dýky ve směru pohybu).
- Duše (XP) jsou společné; level-up = hra stojí, každý vybírá 1 ze 3 talentů pro sebe.
- **Pouto**: světelná čára mezi hráči pálí kostlivce, kteří ji kříží (účinné do 12 m). **Oživení**: padlý leží, kamarád
  u něj stojí 3 s. Na konci MVP (víc zabití) bere bod do Herny.
- Sólo (`#solo`, „Zkusit sám“): stejná hra s botem-parťákem, bez sítě.

## Síťový model
Hostitel (zakladatel) simuluje nepřátele, duše, vlny, bosse a level-upy. Každý klient je autoritou pro **vlastního hrdinu**
(pozice, HP, útoky): host posílá snímky nepřátel, host i host-guest posílají své hrdiny a zásahy. Host aplikuje zásahy
hosta lokálně, zásahy hosta-hráče (guest) přijdou jako `hits`. Guest si zásah okamžitě ukáže a nepřítele s nulovým
předpovězeným HP schová. Zpoždění 100–500 ms je tak skoro neznat.

## src/net.js (ES modul) – kontrakt
```js
export const API = window.KN_API || "https://mantledb.sh/v2/";   // testy podstrčí mock
export function parseHerna(hash) // -> {r, seat:0|1, names:[a,b], zaklada:0|1} | null   (viz ../HERNA-PROTOKOL.md)
export function randId(n)        // [0-9a-z]{n}
export const store               // {get(k), set(k,v)} nad localStorage, bez výjimek
export const device              // token zařízení (localStorage "kn-dev")
export async function createRoom(names) // -> id; založí dokument kostliva-noc-<id>/hra {v, names, host: device, guest: null}
export async function joinRoom(id)      // -> {role:"host"|"guest"|"full", doc}; obsadí guest místo (čti-ověř-zapiš)
export function connect({ id, role, onMessage, onState }) // -> link
link.send(obj)            // spolehlivě, v pořadí, právě jednou (lobby, eventy, level-upy, konec)
link.sendFast(obj)        // nespolehlivě, vyhrává poslední (snímky 15 Hz); smí se ztratit
link.state                // "connecting" | "p2p" | "relay" | "closed"
link.rtt                  // ms, odhad
link.close()
onMessage(obj, fast:boolean); onState(state)
```
Transport: WebRTC DataChannel (kanály `r` ordered/reliable a `u` unordered maxRetransmits 0), STUN
`stun:stun.l.google.com:19302` + `stun:stun.cloudflare.com:3478`, signalizace bez trickle přes dokumenty
`kostliva-noc-<id>/sh` (offer od hosta) a `/sg` (answer od guesta). Než se kanál otevře (nebo když se do 10 s neotevře
či později spadne), běží **relay přes mantledb**: dokumenty `/h` (píše jen host) a `/g` (píše jen guest), každý
`{q:[[seq,obj],…] neodepsané spolehlivé, ack: nejvyšší přijaté seq od druhého, f: poslední fast obj, fs: jeho číslo, u}`.
Poll druhého dokumentu à 250 ms, zápis vlastního nejvýš à 250 ms a jen když se změnil. Spolehlivé zprávy mají jedno
číslování napříč transporty, příjemce deduplikuje, odesílatel maže potvrzené. Polling se při skryté stránce zpomalí na 2 s.
Všechno `fetch` s timeoutem 8 s, chyby nepadají ven (jen onState/retry).

## Zprávy (obsah `link.send` / `sendFast`) – vlastní main.js
- lobby: `{t:"hi", name, cls}`, `{t:"cls", cls}`, `{t:"go", seed, cls:[c0,c1], names}` (host)
- hra fast: host→guest `{t:"s", k: tick, e: [id,x,z,typ,hp%…] ploché pole, g: duše, p: hero hosta, b: boss}`,
  guest→host `{t:"p", hero}` (pozice, směr, hp, stav, anim)
- hra spolehlivě: guest→host `{t:"hit", l:[[id,dmg],…]}`, host→guest `{t:"ev", l:[…]}` (smrti, level-up, talenty, konec)

## Moduly
| soubor | obsah |
|---|---|
| `src/sim.js` | čistá simulace bez DOM a three (testovatelná v Node): hrdinové, nepřátelé, projektily, duše, vlny, talenty, pouto, oživení, bossové |
| `src/scene.js` | three.js: načtení glb, zapečení chůze kostlivců do InstancedMesh snímků, hrdinové se skinningem, efekty, kamera |
| `src/main.js` | obrazovky, HUD, joystick, smyčka, Herna, sólo, síťová vrstva hry |
| `src/bot.js` | parťák pro sólo (vstup z simulace) |
| `src/audio.js` | WebAudio syntetické zvuky, až po prvním dotyku |
| `src/net.js` | viz výše |
| `tools/assets.mjs` | ořez CC0 balíčků KayKit do `assets/` |
| `tools/serve.cjs` | lokální statický server (port 8787) |
| `tests/*.mjs|cjs` | Node testy sim/net, Playwright (globální `%APPDATA%/npm/node_modules/playwright`) |

## Licence
Modely KayKit: CC0 (Kay Lousberg, kaylousberg.com) – uvedeno v titulcích. three.js MIT.
