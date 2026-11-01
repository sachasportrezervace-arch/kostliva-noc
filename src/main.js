// Kostlivá noc – obrazovky, ovládání, smyčka a síťová vrstva hry. Kontrakt modulů: SPEC.md.
import * as Sim from "./sim.js";
import { botInput } from "./bot.js";
import * as Net from "./net.js";
import { sfx, unlock, setMuted } from "./audio.js";
import { createScene } from "./scene.js";

const DT = 1 / 30;
const $ui = document.getElementById("ui"), $stick = document.getElementById("stick"), canvas = document.getElementById("c");
const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// ---------- ikony (jednoduché tahy, jedna barva) ----------
const svg = (d, c = "currentColor") => `<svg viewBox="0 0 32 32" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  knight: svg(`<path d="M7 25 21 11M18 8l6 6M5 27l3-1-2-2z"/><path d="M19 17c0 5 3 8 7 9 0-4 0-8-2-11z" fill="rgba(255,207,114,.25)"/>`),
  mage: svg(`<path d="M9 28 21 10"/><circle cx="23" cy="8" r="4" fill="rgba(134,243,255,.3)"/><path d="M27 3l1 2M30 8h-2M19 3l-1 2"/>`),
  barbarian: svg(`<path d="M8 28 22 9"/><path d="M17 6c5-1 9 2 10 7-4 0-7-2-9-4z" fill="rgba(255,207,114,.25)"/><path d="M14 10c-3-3-7-3-9 0 3 2 6 2 8 2"/>`),
  rogue: svg(`<path d="M6 26 18 14M15 11l6 6M22 6l4 4"/><path d="M26 26 14 14"/><path d="M11 11 6 6"/>`),
  sila: svg(`<path d="M6 26 22 10l4-4-1 5-15 16z"/><path d="M9 20l3 3"/>`),
  tempo: svg(`<circle cx="16" cy="17" r="10"/><path d="M16 11v6l4 3M13 3h6"/>`),
  nohy: svg(`<path d="M9 5v14c0 3 2 5 5 5h11v-4c0-2-2-3-4-3h-5l-1-12z"/><path d="M4 12h3M3 17h4"/>`),
  zivot: svg(`<path d="M16 27S5 20 5 12a5.5 5.5 0 0 1 11-1 5.5 5.5 0 0 1 11 1c0 8-11 15-11 15z" fill="rgba(255,91,77,.25)"/>`),
  regen: svg(`<path d="M16 28c6 0 9-4 9-9 0-6-5-8-6-14-3 3-3 6-3 8-2-2-3-3-3-6-4 4-6 8-6 12 0 5 3 9 9 9z" fill="rgba(255,162,85,.25)"/>`),
  magnet: svg(`<path d="M8 6v10a8 8 0 0 0 16 0V6"/><path d="M8 11h4M20 11h4"/>`),
  zbroj: svg(`<path d="M16 4 6 8v7c0 7 4 11 10 13 6-2 10-6 10-13V8z" fill="rgba(255,255,255,.08)"/>`),
  dosah: svg(`<path d="M4 16h24M22 10l6 6-6 6M10 10l-6 6 6 6"/>`),
  vic: svg(`<path d="M5 24 17 12M13 28 25 16"/><path d="M17 7l5-1-1 5M25 11l5-1-1 5"/>`),
  svicky: svg(`<circle cx="16" cy="16" r="9" stroke-dasharray="3 5"/><circle cx="25" cy="16" r="3" fill="rgba(255,210,122,.5)"/><circle cx="9" cy="10" r="2.4" fill="rgba(255,210,122,.5)"/>`),
  nova: svg(`<path d="M16 3v26M5 9.5l22 13M5 22.5l22-13"/><path d="M13 5l3 3 3-3M13 27l3-3 3 3"/>`),
  blesk: svg(`<path d="M18 3 7 18h8l-2 11 12-16h-8z" fill="rgba(191,244,255,.3)"/>`),
  pouto: svg(`<circle cx="6" cy="16" r="3"/><circle cx="26" cy="16" r="3"/><path d="M9 16h14" stroke="#ffcf72" stroke-width="3.5"/>`),
  dlouhe: svg(`<circle cx="4.5" cy="16" r="2.5"/><circle cx="27.5" cy="16" r="2.5"/><path d="M7 16h18M11 11l-4 5 4 5M21 11l4 5-4 5"/>`),
  spolu: svg(`<circle cx="11" cy="11" r="4"/><circle cx="21" cy="11" r="4"/><path d="M4 27c1-5 4-8 7-8s4 1 5 2c1-1 2-2 5-2s6 3 7 8"/>`),
  vstan: svg(`<path d="M16 28V10M9 16l7-7 7 7"/><path d="M8 4h16"/>`),
};
const CLS_DESC = {
  knight: "Seká vším kolem sebe a hodně vydrží.",
  mage: "Střílí kouzla na nejbližší kost. Křehký.",
  barbarian: "Roztočí sekeru a smete všechno okolo.",
  rogue: "Rychlý. Dýka prolétne i dvěma kostmi.",
};
const BOSS_NAME = { guard: "Kostěný strážce", lich: "Lich" };
const SEAT_COL = ["#ffc94d", "#ff7fae"];

// ---------- stav ----------
let S = null;               // scéna
let phase = "load", mode = null, myId = 0, link = null, roomId = null;
let names = ["", ""], cls = ["knight", "mage"], seed = 1, gameNo = 0, mateHere = false, hs = [0, 1];
let world = null, H = [null, null], view = null, K = [0, 0], paused = false, lvlOpen = null, endShown = false;
let evQ = [], hitQ = [], pending = new Map(), shownDie = new Set(), steps = 0, acc = 0, lastT = performance.now();
let bossInfo = null, hintT = 0, moved = false, autoPick = null, netKills = 0, stepMs = 0;
const herna = Net.parseHerna(location.hash);
const doHerny = z => { if (herna && window.parent !== window) { try { window.parent.postMessage({ herna: 1, ...z }, "*"); } catch {} } };
let hernaFaze = "";
const hernaStav = f => { if (f !== hernaFaze) { hernaFaze = f; doHerny({ typ: "stav", faze: f }); } };
const hernaSent = new Set();

const myName = () => (Net.store.get("kn-name") || "").slice(0, 16);
const otherId = () => 1 - myId;

// ---------- vstup ----------
const keys = new Set(), stick = { on: false, id: null, x0: 0, y0: 0, mx: 0, mz: 0 };
addEventListener("keydown", e => { keys.add(e.key.toLowerCase()); if (e.key.startsWith("Arrow")) e.preventDefault(); });
addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());
function input() {
  if (window.__knAuto && H[myId]) { moved = true; return botInput(mode === "guest" ? view : world, H[myId], H[otherId()], (mode === "guest" ? view : world).t + myId * 40); }
  let mx = stick.mx, mz = stick.mz;
  if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
  if (keys.has("d") || keys.has("arrowright")) mx += 1;
  if (keys.has("w") || keys.has("arrowup")) mz -= 1;
  if (keys.has("s") || keys.has("arrowdown")) mz += 1;
  if (mx || mz) moved = true;
  return { mx, mz };
}
$ui.addEventListener("pointerdown", e => {
  unlock();
  if (phase !== "play" || paused || e.target.closest("button")) return;
  stick.on = true; stick.id = e.pointerId; stick.x0 = e.clientX; stick.y0 = e.clientY; stick.mx = stick.mz = 0;
  $stick.style.left = e.clientX + "px"; $stick.style.top = e.clientY + "px"; $stick.style.opacity = 1; $stick.firstElementChild.style.transform = "";
});
addEventListener("pointermove", e => {
  if (!stick.on || e.pointerId !== stick.id) return;
  let dx = e.clientX - stick.x0, dy = e.clientY - stick.y0; const d = Math.hypot(dx, dy), max = 52;
  if (d > max) { stick.x0 += dx * (1 - max / d) ; stick.y0 += dy * (1 - max / d); dx = e.clientX - stick.x0; dy = e.clientY - stick.y0; $stick.style.left = stick.x0 + "px"; $stick.style.top = stick.y0 + "px"; }
  const m = Math.min(1, Math.hypot(dx, dy) / 40);
  const l = Math.hypot(dx, dy) || 1; stick.mx = dx / l * (m < 0.12 ? 0 : m); stick.mz = dy / l * (m < 0.12 ? 0 : m);
  $stick.firstElementChild.style.transform = `translate(${dx}px,${dy}px)`;
});
const stickEnd = e => { if (e.pointerId !== stick.id) return; stick.on = false; stick.mx = stick.mz = 0; $stick.style.opacity = 0; };
addEventListener("pointerup", stickEnd); addEventListener("pointercancel", stickEnd);

// ---------- obrazovky ----------
function render(html) { $ui.innerHTML = html; }
function loading(p) { render(`<div class="title"><h1>Kostlivá noc</h1><p>Rozdělávám oheň…</p></div><div class="loader"><i style="width:${Math.round(p * 100)}%"></i></div>`); }

function title(msg = "") {
  phase = "title"; mode = null; hernaStav("ceka");
  lobbyHeroes();
  render(`<div class="screen">
    <div class="title"><h1>Kostlivá noc</h1><p>Vydržte spolu u ohně do svítání.</p></div>
    <div class="stack">
      <div class="field"><label for="nm">Jméno</label><input id="nm" maxlength="16" autocomplete="off" placeholder="Jak ti říkají" value="${esc(myName())}"></div>
      <button class="btn" id="bHost">Vyzvat parťáka</button>
      <button class="btn alt" id="bSolo">Zkusit sám</button>
      <div class="note" id="note">${esc(msg)}</div>
    </div></div><div class="credit">Modely: KayKit od Kay Lousberg (CC0)</div>`);
  const nm = document.getElementById("nm");
  nm.oninput = () => Net.store.set("kn-name", nm.value.trim().slice(0, 16));
  document.getElementById("bSolo").onclick = () => { sfx.tap(); location.hash = "solo"; startSolo(); };
  document.getElementById("bHost").onclick = async e => {
    sfx.tap(); e.target.disabled = true; document.getElementById("note").textContent = "Zakládám místnost…";
    try {
      const id = await Net.createRoom([myName() || "Hráč 1", ""]);
      history.replaceState(null, "", "#r." + id);
      openRoom(id, "host");
    } catch { e.target.disabled = false; document.getElementById("note").textContent = "Síť nejde. Zkus to znovu."; }
  };
}

function lobbyHeroes() {
  if (!S) return;
  S.addHero(0, cls[0]); if (mode !== "solo-alone") S.addHero(1, cls[1]);
}

function classPicker() {
  return `<div class="classes">${Sim.CLASS_IDS.map(c => `<button class="cls ${cls[myId] === c ? "on" : ""}" data-c="${c}">${ICON[c]}<b>${Sim.CLASSES[c].name}</b>${mateHere && cls[otherId()] === c ? `<i class="mate" title="parťák"></i>` : ""}</button>`).join("")}</div>
    <div class="desc">${esc(CLS_DESC[cls[myId]])}</div>`;
}
function bindClasses() {
  for (const b of $ui.querySelectorAll(".cls")) b.onclick = () => {
    sfx.tap(); cls[myId] = b.dataset.c; S.addHero(myId, cls[myId]);
    if (link) link.send({ t: "cls", cls: cls[myId] });
    if (mode === "solo") { if (cls[1] === cls[0]) { cls[1] = Sim.CLASS_IDS.find(c => c !== cls[0]); S.addHero(1, cls[1]); } }
    lobby();
  };
}

function lobby(note = "") {
  phase = "lobby"; hernaStav("ceka");
  const other = names[otherId()] || "parťák";
  let body = "";
  if (mode === "solo") body = `${classPicker()}<button class="btn" id="bGo">Do noci</button><div class="note">Trénink s botem Kostíkem (${Sim.CLASSES[cls[1]].name.toLowerCase()})</div>`;
  else if (mode === "host") {
    const share = !herna && !mateHere ? `<div class="share"><button class="btn alt" id="bShare">Poslat odkaz</button><button class="btn alt" id="bCopy">Kopírovat</button></div>` : "";
    body = `${classPicker()}${share}<button class="btn" id="bGo" ${mateHere ? "" : "disabled"}>Zapálit oheň</button>
      <div class="note">${mateHere ? `${esc(other)} hraje za: ${Sim.CLASSES[cls[1]].name}` : herna ? "Čeká se, až hra naskočí parťákovi…" : "Pošli odkaz a počkej na parťáka."}${note ? " " + esc(note) : ""}</div>`;
  } else body = `${classPicker()}<div class="note">${mateHere ? `Čeká se, až ${esc(other)} zapálí oheň.` : "Připojuju se…"}${note ? " " + esc(note) : ""}</div>`;
  render(`<div class="screen"><div class="title"><h1>Kostlivá noc</h1><p>${mode === "solo" ? "Vyber si hrdinu" : mateHere || mode === "host" ? `${esc(names[0] || "?")} a ${esc(names[1] || "parťák")}` : "Připojuju se k ohni…"}</p></div><div class="stack">${body}</div></div>`);
  bindClasses();
  const go = document.getElementById("bGo"); if (go) go.onclick = () => { sfx.tap(); startGame(); };
  const url = location.href.split("#")[0] + "#r." + roomId;
  const sh = document.getElementById("bShare"); if (sh) sh.onclick = async () => { try { await navigator.share({ title: "Kostlivá noc", text: "Pojď mi pomoct u ohně. Kostlivci jdou.", url }); } catch { copy(url); } };
  const cp = document.getElementById("bCopy"); if (cp) cp.onclick = () => copy(url);
}
function copy(url) { try { navigator.clipboard.writeText(url); toastNote("Odkaz je ve schránce."); } catch { prompt("Odkaz pro parťáka:", url); } }
function toastNote(t) { const n = $ui.querySelector(".note"); if (n) n.textContent = t; }

// ---------- síť: místnost a lobby ----------
async function openRoom(id, role) {
  roomId = id; mode = role; myId = role === "host" ? 0 : 1; mateHere = false;
  names[myId] = (herna ? herna.names[herna.seat] : myName()) || (myId ? "Hráč 2" : "Hráč 1");
  if (herna) names[otherId()] = herna.names[1 - herna.seat];
  if (role === "host") hs = herna ? [herna.seat, 1 - herna.seat] : [0, 1];
  cls[myId] = Net.store.get("kn-cls") || cls[myId];
  lobbyHeroes(); lobby();
  link && link.close();
  link = Net.connect({ id, role, onMessage, onState: st => { const n = document.getElementById("net"); if (n) n.textContent = netLabel(st); } });
  if (role === "guest") link.send({ t: "hi", name: names[1], cls: cls[1] });
}
const netLabel = st => st === "connecting" ? "spojuju…" : st === "relay" && link && link.rtt > 900 ? "pomalé spojení" : "";

function onMessage(m) {
  switch (m.t) {
    case "hi": // host: guest přišel
      if (mode !== "host") return;
      mateHere = true; names[1] = herna ? names[1] : (m.name || "Parťák").slice(0, 16); cls[1] = m.cls || cls[1];
      S.addHero(1, cls[1]);
      link.send({ t: "lobby", names, cls });
      if (phase === "lobby") lobby();
      if (phase === "play" || phase === "end") link.send({ t: "go", seed, cls, names, hs, n: gameNo, late: 1 });
      break;
    case "lobby": if (mode !== "guest") return; mateHere = true; names = m.names; cls[0] = m.cls[0]; S.addHero(0, cls[0]); if (phase === "lobby" || phase === "load") lobby(); break;
    case "cls": cls[otherId()] = m.cls; S.addHero(otherId(), m.cls); if (phase === "lobby") lobby(); break;
    case "go": if (mode === "guest") { seed = m.seed; cls = m.cls; names = m.names; hs = m.hs; gameNo = m.n; startGame(true); } break;
    case "again": if (mode === "host" && phase === "end") startGame(); break;
    case "s": if (mode === "guest" && phase === "play") readSnap(m); break;
    case "p": if (mode === "host" && H[1]) { const was = H[1].at; Sim.unpackHero(H[1], m.h); if (H[1].at !== was && phase === "play") heroAttackSfx(H[1]); } break;
    case "hit": if (mode === "host" && world && phase === "play") { const o = { ev: [], kills: {} }; Sim.applyHits(world, m.l, 1, o); countKills(o.kills); netKills += o.kills[1] || 0; for (const e of o.ev) emit(e); } break;
    case "pick": if (mode === "host" && world) { if (Sim.pickTalent(world, 1, m.id)) resume(); } break;
    case "ev": if (mode === "guest") for (const e of m.l) onEv(e, true); break;
  }
}

// ---------- hra ----------
function startSolo() {
  mode = "solo"; myId = 0; link && link.close(); link = null; mateHere = true;
  names = [myName() || "Ty", "Kostík"];
  cls[0] = Net.store.get("kn-cls") || "knight";
  cls[1] = Sim.CLASS_IDS.filter(c => c !== cls[0])[(Math.random() * 3) | 0];
  lobbyHeroes(); lobby();
}

function startGame(fromNet) {
  if (mode === "host" && !fromNet) { seed = (Math.random() * 1e9) | 0; gameNo++; link.send({ t: "go", seed, cls, names, hs, n: gameNo }); }
  if (mode === "solo") { seed = (Math.random() * 1e9) | 0; gameNo++; }
  Net.store.set("kn-cls", cls[myId]);
  phase = "play"; paused = false; lvlOpen = null; endShown = false; K = [0, 0]; evQ = []; hitQ = []; pending.clear(); shownDie.clear(); steps = 0; acc = 0;
  bossInfo = null; hintT = 0; moved = false; clearTimeout(autoPick);
  world = Sim.makeWorld(seed, { duo: true });
  H = [Sim.makeHero(0, cls[0], names[0]), Sim.makeHero(1, cls[1], names[1])];
  view = mode === "guest" ? { enemies: [], gems: [], eshots: [], slams: [], shots: [], props: world.props, t: 0, map: new Map(), xp: 0, need: 6, lv: 1 } : null;
  S.setProps(world.props, seed);
  S.addHero(0, cls[0]); S.addHero(1, cls[1]);
  hernaStav("hraje");
  hud();
}

function countKills(k) { for (const id in k) K[id] += k[id]; }

// události: hostitel je vytvoří, rozešle a sám zpracuje; host-hráč je dostane v {t:"ev"}
function emit(e) {
  onEv(e, false);
  if (mode === "host" && (e.k !== "soul" || e.hero === 1)) evQ.push(e);
}
function onEv(e, remote) {
  switch (e.k) {
    case "die":
      if (shownDie.has(e.id)) break;
      shownDie.add(e.id); S.fx(e); sfx.die(); break;
    case "boss": bossInfo = { id: e.id, type: e.type }; sfx.boss(); break;
    case "slam":
      if (remote) view.slams.push({ id: e.id, x: e.x, z: e.z, r: e.r, t: e.t, dmg: e.dmg });
      S.fx(e); setTimeout(sfx.slam, e.t * 1000); break;
    case "cast": case "summon": S.fx(e); break;
    case "pulse": S.fx(e); sfx.pulse(); break;
    case "soul": if (e.hero === myId) sfx.soul(); break;
    case "heal":
      if (e.hero === myId || (mode === "solo" && e.hero === 1)) { const h = H[e.hero]; h.hp = Math.min(h.mh, h.hp + e.v); }
      S.fx(e); if (e.hero === myId) sfx.heal(); break;
    case "lvl": openLevel(e); break;
    case "resume": closeLevel(); break;
    case "over": over(e); break;
  }
}

function openLevel(e) {
  paused = true; S.fx({ k: "lvl" }); sfx.lvl();
  const offers = e.offers[myId] || [];
  lvlOpen = { level: e.level, picked: false };
  stick.on = false; stick.mx = stick.mz = 0; $stick.style.opacity = 0;
  const h = H[myId];
  const el = document.createElement("div"); el.id = "lvl";
  el.innerHTML = `<h2>Úroveň ${e.level}</h2><div class="sub">${mode === "solo" ? "Vyber si jednu věc" : `Každý si vybírá sám. ${esc(names[otherId()])} taky.`}</div>
    <div class="cards">${offers.map(id => { const T = Sim.TALENTS[id], l = h.tl[id] || 0; return `<button class="card ${T.duo ? "duo" : ""}" data-id="${id}">${ICON[id] || ""}<span><b>${T.name}</b><small>${T.desc}</small></span><span class="pips">${Array.from({ length: T.max }, (_, i) => `<i class="${i <= l ? "f" : ""}"></i>`).join("")}</span></button>`; }).join("")}</div>`;
  $ui.appendChild(el);
  for (const b of el.querySelectorAll(".card")) b.onclick = () => pick(b.dataset.id);
  clearTimeout(autoPick); autoPick = setTimeout(() => offers[0] && pick(offers[0]), window.__knAuto ? 350 : 25000);
  if (mode === "solo") setTimeout(() => { const o = e.offers[1]; if (o && o.length) { const id = o[(Math.random() * o.length) | 0]; Sim.applyTalent(H[1], id); if (Sim.pickTalent(world, 1, id)) resume(); } }, 700);
}
function pick(id) {
  if (!lvlOpen || lvlOpen.picked) return;
  lvlOpen.picked = true; clearTimeout(autoPick); sfx.pick();
  Sim.applyTalent(H[myId], id);
  const el = document.getElementById("lvl");
  if (el) { el.querySelector(".cards").innerHTML = `<div class="note">${Sim.TALENTS[id].name}. ${mode === "solo" ? "" : `Čeká se na ${esc(names[otherId()])}…`}</div>`; }
  if (mode === "guest") link.send({ t: "pick", id });
  else if (Sim.pickTalent(world, myId, id)) resume();
}
function resume() { emit({ k: "resume" }); }
function closeLevel() { paused = false; lvlOpen = null; clearTimeout(autoPick); const el = document.getElementById("lvl"); el && el.remove(); }

function over(e) {
  if (endShown) return;
  endShown = true; phase = "end"; closeLevel(); hernaStav("konec");
  const t = mode === "guest" ? view.t : world.t;
  const mvp = K[0] === K[1] ? -1 : K[0] > K[1] ? 0 : 1;
  if (e.win) { S.fx({ k: "win" }); sfx.win(); } else sfx.lose();
  if (herna) {
    const partie = herna.r + ":" + gameNo;
    if (!hernaSent.has(partie)) { hernaSent.add(partie); doHerny({ typ: "vysledek", partie, vitez: mvp < 0 ? null : hs[mvp] }); }
  }
  setTimeout(() => endScreen(e, t, mvp), e.win ? 1600 : 1200);
}
function endScreen(e, t, mvp) {
  if (phase !== "end") return;
  const head = e.win ? (e.dawn ? "Svítá" : "Lich padl") : "Kosti vyhrály";
  const lead = e.win ? (e.dawn ? "Přežili jste noc. Lich se schoval do krypty." : "Oheň hoří a hřbitov ztichl.") : `Vydrželi jste ${fmt(t)}.`;
  const solo = mode === "solo";
  const pair = [0, 1].map(i => `<div class="stat ${mvp === i ? "mvp" : ""}"><small>${esc(names[i])}${mvp === i ? " · víc kostí" : ""}</small><b>${K[i]}</b></div>`).join("");
  const buttons = herna
    ? `<button class="btn" id="bAgain">Odveta</button><button class="btn alt" id="bOther">Jiná hra</button>`
    : solo ? `<button class="btn" id="bAgain">Znovu</button><button class="btn alt" id="bHost2">Vyzvat parťáka</button>`
    : `<button class="btn" id="bAgain">Odveta</button>`;
  render(`<div class="screen" id="end"><div class="title"><h2>${head}</h2><p class="lead">${lead}</p></div>
    <div class="stack"><div class="stats">${pair}<div class="stat"><small>Čas</small><b>${fmt(t)}</b></div><div class="stat"><small>Úroveň</small><b>${mode === "guest" ? view.lv : world.level}</b></div></div>${buttons}
    <div class="note" id="note"></div></div></div>`);
  document.getElementById("bAgain").onclick = () => {
    sfx.tap();
    if (mode === "guest") { link.send({ t: "again" }); toastNote(`Čeká se na ${names[0]}…`); }
    else startGame();
  };
  const o = document.getElementById("bOther"); if (o) o.onclick = () => doHerny({ typ: "jina-hra" });
  const h2 = document.getElementById("bHost2"); if (h2) h2.onclick = () => { location.hash = ""; title(); };
}

// ---------- krok simulace ----------
function heroAttackSfx(h) { const k = Sim.CLASSES[h.cls].atk.kind; ({ slash: sfx.slash, spin: sfx.spin, bolt: sfx.bolt, dagger: sfx.dagger })[k](); }
function heroOut(o, id) {
  for (const f of o.fx) {
    S.fx(f);
    if (f.k === "ouch" && id === myId) sfx.ouch();
    if (f.k === "nova") sfx.nova();
    if (f.k === "zap") sfx.zap();
    if (f.k === "down") sfx.down();
  }
  if (o.hits.length && id === myId) sfx.hit();
}

function stepHost() {
  const inp = input();
  if (!world.pause && !world.over) simHost(inp);
  // síť i během pauzy a po konci: jinak by level-up a konec k hostovi nikdy nedošly
  if (mode === "host") {
    if (steps % 2 === 0 && !world.over) { const sn = Sim.snapshot(world); sn.tm = sn.t; sn.t = "s"; sn.p = Sim.packHero(H[0]); sn.kl = K; link.sendFast(sn); }
    if (evQ.length && (steps % 3 === 0 || world.pause || world.over)) { link.send({ t: "ev", l: evQ }); evQ = []; }
  }
}
function simHost(inp) {
  for (const id of [0, 1]) {
    const local = id === 0 || mode === "solo";
    if (!local) continue;
    const h = H[id], at = h.at;
    const o = Sim.stepHero(world, h, id === 0 ? inp : botInput(world, h, H[0], world.t), DT, H[1 - id]);
    if (h.at !== at && id === myId) heroAttackSfx(h);
    heroOut(o, id);
    const out = { ev: [], kills: {} };
    Sim.applyHits(world, o.hits, id, out);
    countKills(out.kills); for (const e of out.ev) emit(e);
    if (Sim.stepRevive(h, H[1 - id], DT)) sfx.revive();
  }
  const out = Sim.stepWorld(world, H, DT);
  countKills(out.kills);
  for (const e of out.ev) emit(e);
}

function readSnap(m) {
  const r = Sim.readSnapshot(m), map = view.map, seen = new Set();
  for (const e of r.enemies) {
    seen.add(e.id);
    let v = map.get(e.id);
    if (!v) { v = { ...e, fx: 0, fz: 1 }; map.set(e.id, v); }
    v.tx = e.x; v.tz = e.z; v.hp = e.hp; v.rise = e.rise; v.slow = e.slow; v.hit = Math.max(v.hit || 0, e.hit);
  }
  for (const [id, v] of map) if (!seen.has(id)) map.delete(id);
  view.enemies = [...map.values()];
  view.gems = r.gems; view.eshots = r.eshots;
  view.t = m.tm; view.xp = m.xp; view.need = m.need; view.lv = m.lv; view.bh = m.bh;
  K = m.kl || K;
  if (m.p) { const was = H[0].at; Sim.unpackHero(H[0], m.p); if (H[0].at !== was) heroAttackSfx(H[0]); }
}

function stepGuest() {
  const inp = input();
  for (const e of view.enemies) {
    const dx = e.tx - e.x, dz = e.tz - e.z, k = Math.min(1, DT * 10);
    if (dx * dx + dz * dz > 1e-4) { const l = Math.hypot(dx, dz); e.fx = dx / l; e.fz = dz / l; }
    e.x += dx * k; e.z += dz * k; e.hit = Math.max(0, (e.hit || 0) - DT);
    const p = pending.get(e.id); e.gone = p && e.hp - p.d <= 0;
  }
  for (const s of view.eshots) { s.x += s.vx * DT; s.z += s.vz * DT; }
  for (const s of view.slams) s.t -= DT;
  view.slams = view.slams.filter(s => s.t > -0.3);
  const now = performance.now();
  for (const [id, p] of pending) if (now - p.t > 1500) pending.delete(id);
  if (paused || endShown) return;
  view.t += DT;
  const h = H[1], at = h.at;
  const o = Sim.stepHero(view, h, inp, DT, H[0]);
  if (h.at !== at) heroAttackSfx(h);
  heroOut(o, 1);
  for (const [id, d, slow] of o.hits) {
    hitQ.push(slow ? [id, d, slow] : [id, d]);
    const p = pending.get(id) || { d: 0, t: now }; p.d += d; p.t = now; pending.set(id, p);
    const e = view.map.get(id);
    if (e) { e.hit = 0.12; if (e.hp - p.d <= 0 && !shownDie.has(id)) { shownDie.add(id); e.gone = true; S.fx({ k: "die", id, x: e.x, z: e.z, type: e.type }); sfx.die(); } }
  }
  if (Sim.stepRevive(h, H[0], DT)) sfx.revive();
  if (steps % 2 === 0) link.sendFast({ t: "p", h: Sim.packHero(h) });
  if (hitQ.length && steps % 3 === 0) { link.send({ t: "hit", l: hitQ }); hitQ = []; }
}

// ---------- HUD ----------
let hudT = 0;
function hud() {
  render(`<div id="hud" class="layer">
    <div id="xp"><i></i></div>
    <div id="top"><div class="kills">${[0, 1].map(i => `<span><i style="background:${SEAT_COL[i]}"></i><small>${esc((names[i] || "").slice(0, 8))}</small><b id="k${i}">0</b></span>`).join("")}</div>
      <div id="time">0:00</div><div id="lv">Úr. 1</div></div>
    <div id="bossbar" class="hidden"><span id="bn"></span><div><i id="bhp"></i></div></div>
    <div id="net"></div>
    <div id="hint">Táhni palcem kamkoli. Útočíš sám.</div>
    <button id="mute" aria-label="Zvuk">${svg(`<path d="M5 12h5l7-6v20l-7-6H5z"/><path d="M22 11c2 2 2 8 0 10M25 8c4 4 4 12 0 16"/>`)}</button>
  </div>`);
  const mb = document.getElementById("mute"); let m = Net.store.get("kn-mute") === "1"; setMuted(m); mb.style.opacity = m ? 0.35 : 0.75;
  mb.onclick = () => { m = !m; setMuted(m); Net.store.set("kn-mute", m ? "1" : "0"); mb.style.opacity = m ? 0.35 : 0.75; };
}
function hudTick(dt) {
  hudT -= dt; if (hudT > 0 || phase !== "play") return; hudT = 0.1;
  const src = mode === "guest" ? view : world;
  const t = src.t, xp = mode === "guest" ? view.xp : world.xp, need = mode === "guest" ? view.need : world.need, lv = mode === "guest" ? view.lv : world.level;
  const el = id => document.getElementById(id);
  if (!el("time")) return;
  el("time").textContent = t >= Sim.RUN ? (bossInfo && bossInfo.type === "lich" ? "Lich" : fmt(t)) : fmt(Sim.RUN - t);
  el("xp").firstElementChild.style.width = Math.min(100, xp / need * 100) + "%";
  el("lv").textContent = "Úr. " + lv;
  el("k0").textContent = K[0]; el("k1").textContent = K[1];
  const bb = el("bossbar"), boss = bossInfo && (mode === "guest" ? view.enemies.find(e => e.id === bossInfo.id) : world.enemies.find(e => e.id === bossInfo.id));
  if (boss) { bb.classList.remove("hidden"); el("bn").textContent = BOSS_NAME[bossInfo.type]; const mh = mode === "guest" ? (view.bh && view.bh[1]) || boss.hp : boss.mh; el("bhp").style.width = Math.max(0, boss.hp / mh * 100) + "%"; }
  else { bb.classList.add("hidden"); if (bossInfo && t > 5) bossInfo = boss ? bossInfo : null; }
  hintT += 0.1;
  const hint = el("hint");
  if (hint) { if (moved && hintT > 2) hint.style.opacity = 0; if (hintT > 5 && mode !== "solo-alone" && !hint.dataset.two) { hint.dataset.two = 1; hint.textContent = "Světlo mezi vámi pálí kosti."; hint.style.opacity = 0.8; } if (hintT > 10) hint.style.opacity = 0; }
  const n = el("net"); if (n && link) n.textContent = netLabel(link.state);
}

// ---------- smyčka ----------
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (!S) return;
  if (phase === "play" || phase === "end") {
    if (mode !== "solo" || !document.hidden) {
      const sp = window.__knSpeed || 1;   // testy: zrychlený běh
      acc += dt * sp; let n = 0;
      const ts = performance.now();
      while (acc >= DT && n++ < 4 * sp) { acc -= DT; steps++; mode === "guest" ? stepGuest() : stepHost(); }
      if (n) stepMs = stepMs * 0.95 + (performance.now() - ts) / n * 0.05;
      if (n >= 4 * sp) acc = 0;
    }
    const src = mode === "guest" ? view : world;
    S.render({ t: src.t, local: myId, heroes: H, enemies: src.enemies, gems: src.gems, shots: src.shots, eshots: src.eshots, slams: src.slams }, dt);
    hudTick(dt);
  } else {
    const hs2 = [0, 1].map(i => ({ x: i ? 1.5 : -1.5, z: 1.4, fx: i ? -0.35 : 0.35, fz: 1, mx: 0, mz: 0, hp: 1, mh: 1, dn: 0, at: 0, tl: {} }));
    if (phase === "lobby" && !mateHere && mode !== "solo") hs2[otherId()] = null;   // na titulu stojí u ohně oba
    S.render({ t: 0, local: -1, heroes: hs2, enemies: [], gems: [], shots: [], eshots: [], slams: [] }, dt);
  }
}

// ---------- start ----------
addEventListener("resize", () => S && S.resize());
addEventListener("hashchange", () => { if (location.hash === "#solo" && phase === "title") startSolo(); });
(async function boot() {
  loading(0);
  if (herna) doHerny({ typ: "pripraveno" });
  try { S = await createScene(canvas, loading); }
  catch (e) { console.error(e); render(`<div class="screen"><div class="title"><h1>Kostlivá noc</h1><p>Tenhle prohlížeč neumí 3D (WebGL). Zkus jiný.</p></div></div>`); return; }
  S.setProps(Sim.makeWorld(7).props, 7);
  window.__knScene = () => S.debug();
  requestAnimationFrame(frame);
  const h = location.hash;
  if (herna) return hernaJoin();
  if (h === "#solo") return startSolo();
  const m = /^#r\.([0-9a-z]{6,16})$/.exec(h);
  if (m) {
    render(`<div class="screen"><div class="title"><h1>Kostlivá noc</h1><p>Připojuju se k ohni…</p></div></div>`);
    try {
      const j = await Net.joinRoom(m[1]);
      if (!j) return title("Tahle místnost neexistuje. Založ novou.");
      if (j.role === "full") return title("Tady už hrají dva. Založ si vlastní.");
      if (j.role === "host") names = [j.doc.names[0] || myName(), ""];
      openRoom(m[1], j.role);
    } catch { title("Síť nejde. Zkus to znovu."); }
    return;
  }
  title();
})();

async function hernaJoin() {
  render(`<div class="screen"><div class="title"><h1>Kostlivá noc</h1><p>Čeká se, až hra naskočí…</p></div></div>`);
  hernaStav("ceka");
  try {
    let j = await Net.joinRoom(herna.r);
    if (herna.zaklada) {
      if (!j) { await Net.createRoom([herna.names[herna.seat], herna.names[1 - herna.seat]], Net.device, herna.r); j = { role: "host" }; }
    } else {
      while (!j || j.role === "host") { await new Promise(r => setTimeout(r, 1200)); j = await Net.joinRoom(herna.r); }
    }
    if (j.role === "full") return render(`<div class="screen"><div class="title"><h1>Kostlivá noc</h1><p>Tady už hrají dva.</p></div></div>`);
    openRoom(herna.r, j.role);
  } catch { setTimeout(hernaJoin, 2000); }
}

// ladění a testy (Playwright): jen čte stav, nic nemění
window.__kn = () => {
  const src = mode === "guest" ? view : world;
  return { phase, mode, myId, paused, lvl: !!lvlOpen, t: src ? src.t : 0, level: mode === "guest" ? view && view.lv : world && world.level,
    enemies: src ? src.enemies.length : 0, K: [...K], hp: H.map(h => h && [Math.round(h.hp), h.mh, h.dn]), pos: H.map(h => h && [+h.x.toFixed(2), +h.z.toFixed(2)]),
    boss: bossInfo && bossInfo.type, net: link && link.state, over: world && world.over, names: [...names], cls: [...cls], gameNo, netKills, stepMs: +stepMs.toFixed(2), lvlWait: !!(lvlOpen && lvlOpen.picked) };
};
