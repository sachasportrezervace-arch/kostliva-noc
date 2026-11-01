// Syntetické zvuky přes WebAudio (žádné soubory). Startuje až po prvním dotyku, hlasitost drží nízko, četnost omezuje.
let ctx = null, master = null, last = {}, muted = false;
export function unlock() {
  if (ctx) { ctx.state === "suspended" && ctx.resume(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
  ambience();
}
export const setMuted = m => { muted = m; if (master) master.gain.value = m ? 0 : 0.55; };
const ok = (k, gap) => { const t = performance.now(); if (t - (last[k] || 0) < gap) return false; last[k] = t; return !!ctx && !muted; };
function noiseBuf(sec) { const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
let nb = null;
function noise(dur, freq, q, vol, type = "bandpass", at = 0) {
  nb = nb || noiseBuf(1);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime + at;
  s.buffer = nb; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
function tone(freq, dur, vol, type = "sine", at = 0, slide = 0) {
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function ambience() {   // vítr a praskání ohně, velmi potichu
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf(4); s.loop = true; f.type = "lowpass"; f.frequency.value = 380; g.gain.value = 0.035;
  s.connect(f).connect(g).connect(master); s.start();
  setInterval(() => { if (ctx && !muted && Math.random() < 0.6) noise(0.04, 2400 + Math.random() * 2000, 2, 0.03 + Math.random() * 0.04, "bandpass"); }, 140);
}
export const sfx = {
  slash: () => ok("slash", 90) && noise(0.16, 1800, 0.8, 0.18, "bandpass"),
  spin: () => ok("spin", 200) && (noise(0.3, 900, 0.7, 0.2), noise(0.25, 1600, 0.7, 0.12, "bandpass", 0.08)),
  bolt: () => ok("bolt", 80) && tone(880, 0.12, 0.06, "triangle", 0, 1.8),
  dagger: () => ok("dagger", 70) && noise(0.06, 4200, 2, 0.08),
  hit: () => ok("hit", 45) && noise(0.05, 1300, 3, 0.12),
  die: () => ok("die", 35) && (noise(0.03, 3200, 6, 0.16), noise(0.03, 2500, 6, 0.12, "bandpass", 0.05), noise(0.04, 1900, 6, 0.08, "bandpass", 0.11)),
  soul: () => ok("soul", 55) && tone(1320 + Math.random() * 240, 0.09, 0.035, "sine"),
  lvl: () => ok("lvl", 300) && [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 0.09, "triangle", i * 0.07)),
  pick: () => ok("pick", 100) && (tone(660, 0.12, 0.08, "triangle"), tone(990, 0.18, 0.07, "triangle", 0.06)),
  ouch: () => ok("ouch", 160) && (tone(180, 0.18, 0.12, "square", 0, 0.5), noise(0.1, 600, 1, 0.1)),
  down: () => ok("down", 400) && [440, 370, 294, 220].forEach((f, i) => tone(f, 0.3, 0.08, "triangle", i * 0.11)),
  revive: () => ok("revive", 400) && [392, 523, 659, 784].forEach((f, i) => tone(f, 0.3, 0.08, "sine", i * 0.08)),
  heal: () => ok("heal", 200) && (tone(700, 0.2, 0.06, "sine", 0, 1.5)),
  zap: () => ok("zap", 120) && (noise(0.12, 5200, 1, 0.12, "highpass"), tone(1500, 0.08, 0.04, "sawtooth", 0, 0.3)),
  nova: () => ok("nova", 300) && (noise(0.45, 5800, 0.6, 0.1, "highpass"), tone(2100, 0.4, 0.03, "sine", 0, 0.5)),
  boss: () => ok("boss", 1500) && (tone(70, 1.4, 0.22, "sawtooth", 0, 0.6), noise(1.2, 220, 0.8, 0.2, "lowpass")),
  slam: () => ok("slam", 300) && (tone(55, 0.5, 0.3, "sine", 0, 0.5), noise(0.4, 300, 0.6, 0.3, "lowpass")),
  pulse: () => ok("pulse", 2000) && [196, 185].forEach((f, i) => tone(f, 0.9, 0.08, "sawtooth", i * 0.25, 0.7)),
  win: () => ok("win", 2000) && [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.6, 0.1, "triangle", i * 0.12)),
  lose: () => ok("lose", 2000) && [392, 330, 262, 196].forEach((f, i) => tone(f, 0.7, 0.1, "triangle", i * 0.2)),
  tap: () => ok("tap", 60) && tone(520, 0.06, 0.05, "triangle"),
};
