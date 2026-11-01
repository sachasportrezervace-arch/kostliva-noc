// Kostlivá noc – vykreslení ve three.js. Kostlivci jsou zapečení: chůze se při načtení nasnímkuje do F statických
// geometrií a každý snímek je jeden InstancedMesh, takže 240 kostí = pár desítek draw callů i na mobilu.
// Hrdinové a bossové jsou normální SkinnedMesh s AnimationMixerem. Svítící věci jdou přes jeden Points shader.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_R, ENEMIES, TETHER_MAX } from "./sim.js";

const COL = {
  sky: 0x121829, fog: 0x161d33, ground: 0x2b3428, moon: 0xb4c2ff, fire: 0xffa255,
  soul: 0x86f3ff, orb: 0xb98aff, tether: 0xffcf72, slam: 0xff5b4d, frost: 0xa8e6ff,
  seat: [0xffc94d, 0xff7fae],
};
const HERO_FILE = { knight: "knight", mage: "mage", barbarian: "barbarian", rogue: "rogue_hooded" };
const HERO_KEEP = {   // které zbraně nechat viditelné
  knight: ["1H_Sword", "Badge_Shield", "Knight_Helmet", "Knight_Cape"], mage: ["2H_Staff", "Mage_Hat", "Mage_Cape"],
  barbarian: ["2H_Axe", "Barbarian_Hat", "Barbarian_Cape"], rogue: ["Knife", "Knife_Offhand", "Rogue_Cape"],
};
const HERO_ATTACK = { knight: "1H_Melee_Attack_Slice_Horizontal", mage: "Spellcast_Shoot", barbarian: "2H_Melee_Attack_Spin", rogue: "Throw" };
const SKEL = { minion: "skel_minion", rogue: "skel_rogue", warrior: "skel_warrior", mage: "skel_mage", guard: "skel_warrior", lich: "skel_mage" };
const SKEL_WALK = { minion: "Walking_D_Skeletons", rogue: "Running_C", warrior: "Walking_D_Skeletons", mage: "Walking_D_Skeletons" };
const SKEL_CAP = { minion: 240, rogue: 120, warrior: 110, mage: 70 };
const FRAMES = 10;
const SK_S = 0.78, HERO_S = 0.88;   // modely menší než v balíčku: horda je čitelná a víc místa v aréně

const loader = new GLTFLoader();
const glbCache = {};
const loadGlb = (name, onDone) => glbCache[name] || (glbCache[name] = loader.loadAsync(`assets/${name}.glb`).then(g => { onDone && onDone(); return g; }));

function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function groundTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#34402f"; g.fillRect(0, 0, 512, 512);
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) {   // měkké skvrny trávy a hlíny, žádný šum na pixel
    const x = r() * 512, y = r() * 512, rad = 10 + r() * 46;
    const tone = r() < 0.3 ? "58,52,40" : r() < 0.6 ? "36,48,36" : "48,60,44";
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${tone},.55)`); gr.addColorStop(1, `rgba(${tone},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 7); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Points s velikostí na bod (záře, jiskry, duše)
function glowPoints(cap, tex) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3), size = new Float32Array(cap);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, scale: { value: 600 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
      uniform float scale;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a, t.a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  let n = 0; const c = new THREE.Color();
  return {
    obj: pts, mat,
    begin() { n = 0; },
    add(x, y, z, color, s, a = 1) {
      if (n >= cap) return;
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
      c.set(color); col[n * 3] = c.r * a; col[n * 3 + 1] = c.g * a; col[n * 3 + 2] = c.b * a; size[n] = s; n++;
    },
    end() { geo.setDrawRange(0, n); for (const k of ["position", "color", "size"]) geo.attributes[k].needsUpdate = true; },
  };
}

// kruh na zemi s výsečí (HP pod nohama, oživení, dopad bosse)
function arcMaterial(color, opacity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { frac: { value: 1 }, color: { value: new THREE.Color(color) }, opacity: { value: opacity }, inner: { value: 0.78 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float frac; uniform vec3 color; uniform float opacity; uniform float inner; varying vec2 vUv;
      void main(){ vec2 p = vUv*2.0-1.0; float r = length(p); if (r > 1.0 || r < inner) discard;
        float a = atan(p.x, p.y) / 6.2831853 + 0.5; if (a > frac) discard;
        float edge = smoothstep(1.0, 0.96, r) * smoothstep(inner, inner + 0.04, r);
        gl_FragColor = vec4(color, opacity * edge); }`,
    transparent: true, depthWrite: false,
  });
}

export async function createScene(canvas, onProgress = () => {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.sky);
  scene.fog = new THREE.Fog(COL.fog, 22, 48);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 120);

  scene.add(new THREE.HemisphereLight(0x7080c8, 0x2a2230, 1.7));
  const moon = new THREE.DirectionalLight(COL.moon, 1.8); moon.position.set(-8, 18, -6); scene.add(moon);
  const fire = new THREE.PointLight(COL.fire, 60, 16, 1.6); fire.position.set(0, 1.6, 0); scene.add(fire);
  const heroLight = new THREE.PointLight(0xffd9a0, 14, 7, 1.8); scene.add(heroLight);

  const glowTex = glowTexture();
  const glow = glowPoints(2600, glowTex); scene.add(glow.obj);

  // ---- zem a okraj ----
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 72), new THREE.MeshLambertMaterial({ map: groundTexture() }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const clearing = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), new THREE.MeshBasicMaterial({ color: 0x4a3a28, transparent: true, opacity: 0.35, depthWrite: false }));
  clearing.rotation.x = -Math.PI / 2; clearing.position.y = 0.01; scene.add(clearing);

  // blob stíny (jeden InstancedMesh)
  const shadowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
  shadowMat.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace("#include <map_fragment>", "diffuseColor.a *= texture2D(map, vMapUv).a;"); };
  const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat, 420);
  shadows.frustumCulled = false; shadows.position.y = 0.02; scene.add(shadows);

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), CC = new THREE.Color();
  const tLoad = { n: 0, of: 1 + 4 };
  const tick = () => onProgress(++tLoad.n / tLoad.of);

  // ---- prostředí ----
  const env = await loadGlb("env", tick);
  const envPart = name => env.scene.getObjectByName(name);
  const envMat = (() => { let m; env.scene.traverse(o => { if (o.isMesh && !m) m = o.material; }); return m; })();
  envMat.map && (envMat.map.colorSpace = THREE.SRGBColorSpace);
  const flatEnv = new THREE.MeshLambertMaterial({ map: envMat.map });
  function partGeo(name) {   // celý kus jako jedna geometrie v jeho souřadnicích
    const root = envPart(name); if (!root) return null;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), geos = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const out = new THREE.BufferGeometry();
      for (const k of ["position", "normal", "uv"]) { const a = g.attributes[k]; if (!a) continue; const arr = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) arr[i * a.itemSize + j] = a.getComponent(i, j); out.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize)); }
      if (g.index) out.setIndex(Array.from(g.index.array));
      geos.push(out);
    });
    return geos.length ? mergeGeometries(geos) : null;
  }
  const partCache = {};
  const part = name => partCache[name] !== undefined ? partCache[name] : (partCache[name] = partGeo(name));
  let staticMesh = null;
  function setProps(props, seed = 1) {
    if (staticMesh) { scene.remove(staticMesh); staticMesh.geometry.dispose(); }
    const geos = [];
    const put = (name, x, z, rot, s) => { const g = part(name); if (!g) return; const c = g.clone(); c.applyMatrix4(M.compose(V.set(x, 0, z), Q.setFromAxisAngle(UP, rot), SC.set(s, s, s))); geos.push(c); };
    for (const p of props) put(p.k, p.x, p.z, p.rot + (p.k.startsWith("grave") || p.k.startsWith("gravem") ? Math.atan2(p.x, p.z) + Math.PI : 0), p.s);
    // plot dokola
    const fence = part("fence"); fence.computeBoundingBox();
    const len = fence.boundingBox.max.x - fence.boundingBox.min.x, R = ARENA_R + 0.4, n = Math.round(Math.PI * 2 * R / len);
    let s = seed * 9301; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * Math.PI * 2;
      put(r() < 0.18 ? "fence_broken" : "fence", Math.cos(a) * R, Math.sin(a) * R, -a + Math.PI / 2, (Math.PI * 2 * R / n) / len);
      if (i % 4 === 0) put("fence_pillar", Math.cos(i / n * Math.PI * 2) * R, Math.sin(i / n * Math.PI * 2) * R, -a, 1);
    }
    // les za plotem a pár světel
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = R + 2 + r() * 13;
      put(r() < 0.55 ? (r() < 0.5 ? "tree_pine_orange_medium" : "tree_pine_yellow_small") : r() < 0.5 ? "tree_dead_large" : "tree_dead_medium", Math.cos(a) * d, Math.sin(a) * d, r() * 6.28, 1.1 + r() * 0.9);
    }
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; put("post_lantern", Math.cos(a) * (R - 1.3), Math.sin(a) * (R - 1.3), -a, 1); }
    for (let i = 0; i < 14; i++) { const a = r() * 6.28, d = 6 + r() * 17; const k = r() < 0.5 ? "pumpkin_orange_jackolantern" : r() < 0.5 ? "skull_candle" : "candle_triple"; put(k, Math.cos(a) * d, Math.sin(a) * d, r() * 6.28, k.startsWith("pumpkin") ? 0.55 : 0.8); }
    put("crypt", 0, -ARENA_R - 6, 0, 1.6);
    staticMesh = new THREE.Mesh(mergeGeometries(geos), flatEnv);
    scene.add(staticMesh);
    lanternSpots = [];
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; lanternSpots.push([Math.cos(a) * (R - 1.3), Math.sin(a) * (R - 1.3)]); }
  }
  let lanternSpots = [];

  // táborák: polena + plameny (kužely) + jiskry
  const campfire = new THREE.Group(); scene.add(campfire);
  const logMat = new THREE.MeshLambertMaterial({ color: 0x5b3a24 });
  for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 1.3, 6), logMat); l.rotation.z = Math.PI / 2; l.rotation.y = i * Math.PI / 4; l.position.y = 0.14; campfire.add(l); }
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x6d6a73, flatShading: true });
  for (let i = 0; i < 9; i++) { const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), stoneMat); const a = i / 9 * 6.28; st.position.set(Math.cos(a) * 0.85, 0.1, Math.sin(a) * 0.85); st.rotation.set(i, i * 2, 0); campfire.add(st); }
  const flames = [0xffd27a, 0xff9f45, 0xff6a3a].map((c, i) => { const f = new THREE.Mesh(new THREE.ConeGeometry(0.42 - i * 0.1, 1.1 - i * 0.2, 7, 1, true), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })); f.position.y = 0.55; campfire.add(f); return f; });

  // ---- kostlivci: zapečená chůze ----
  const skel = {};
  async function bakeSkeleton(type) {
    const g = await loadGlb(SKEL[type], tick);
    const root = SkeletonUtils.clone(g.scene);
    const mixer = new THREE.AnimationMixer(root);
    const clip = g.animations.find(a => a.name === SKEL_WALK[type]);
    mixer.clipAction(clip).play();
    const texMat = []; let glowCol = 0x7fe8ff;
    root.traverse(o => { if (o.isMesh) { if (o.material.name === "Glow") glowCol = o.material.emissive.getHex() || glowCol; else texMat.push(o.material); } });
    const map = texMat[0].map; map.colorSpace = THREE.SRGBColorSpace;
    const mats = [new THREE.MeshLambertMaterial({ map, flatShading: true }), new THREE.MeshBasicMaterial({ color: glowCol })];
    const frames = [], tmp = new THREE.Vector3();
    for (let f = 0; f < FRAMES; f++) {
      mixer.setTime(clip.duration * f / FRAMES);
      root.updateMatrixWorld(true);
      const parts = [[], []];
      root.traverse(o => {
        if (!o.isMesh) return;
        if (o.isSkinnedMesh) o.skeleton.update();
        const src = o.geometry, n = src.attributes.position.count;
        const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
          if (o.isSkinnedMesh) o.getVertexPosition(i, tmp); else tmp.fromBufferAttribute(src.attributes.position, i);
          tmp.applyMatrix4(o.matrixWorld); pos[i * 3] = tmp.x; pos[i * 3 + 1] = tmp.y; pos[i * 3 + 2] = tmp.z;
          if (src.attributes.uv) { uv[i * 2] = src.attributes.uv.getX(i); uv[i * 2 + 1] = src.attributes.uv.getY(i); }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        if (src.index) geo.setIndex(Array.from(src.index.array));
        parts[o.material.name === "Glow" ? 1 : 0].push(geo);
      });
      const merged = mergeGeometries([mergeGeometries(parts[0]), mergeGeometries(parts[1])], true);
      merged.computeVertexNormals();
      const im = new THREE.InstancedMesh(merged, mats, SKEL_CAP[type]);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.count = 0;
      im.setColorAt(0, CC.set(1, 1, 1));
      scene.add(im); frames.push(im);
    }
    skel[type] = { frames, rate: FRAMES / clip.duration * (type === "rogue" ? 1 : 1.25) };
  }
  await Promise.all(["minion", "rogue", "warrior", "mage"].map(bakeSkeleton));

  // úlomky kostí po smrti
  const boneGeos = ["bone_A", "bone_B", "skull", "ribcage"].map(part).filter(Boolean);
  const debris = boneGeos.map(g => { const im = new THREE.InstancedMesh(g, flatEnv, 160); im.frustumCulled = false; im.count = 0; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); return im; });
  const bits = [];   // {g, x,y,z, vx,vy,vz, rx,ry, life}

  // ---- hrdinové ----
  const heroes = {};
  const heroGen = {};
  async function addHero(id, cls) {
    const gen = heroGen[id] = (heroGen[id] || 0) + 1;   // novější volání vyhrává (přepínání postav v lobby)
    if (heroes[id] && heroes[id].cls === cls) { const h = heroes[id]; h.dn = 0; h.at = 0; h.busy = 0; play(h, "Idle", 0); return h; }
    const g = await loadGlb(HERO_FILE[cls]);
    if (gen !== heroGen[id]) return null;
    const old = heroes[id];
    if (old) { scene.remove(old.root, old.ring, old.ringBg, old.rev); delete heroes[id]; }
    const root = SkeletonUtils.clone(g.scene); root.scale.setScalar(HERO_S);
    const mats = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      if (o.parent && o.parent.isBone && !HERO_KEEP[cls].includes(o.name)) o.visible = false;
      if (!o.isSkinnedMesh && !HERO_KEEP[cls].includes(o.name) && /Shield|Sword|Axe|Crossbow|Throwable|Mug|Spellbook|Wand|Staff|Knife/.test(o.name)) o.visible = false;
      o.material = new THREE.MeshLambertMaterial({ map: o.material.map, flatShading: true });
      o.material.map && (o.material.map.colorSpace = THREE.SRGBColorSpace);
      mats.push(o.material);
      o.frustumCulled = false;
    });
    const mixer = new THREE.AnimationMixer(root);
    const act = {};
    for (const c of g.animations) act[c.name] = mixer.clipAction(c);
    for (const k of [HERO_ATTACK[cls], "Hit_A", "Death_A", "Lie_StandUp", "Cheer"]) if (act[k]) { act[k].setLoop(THREE.LoopOnce); act[k].clampWhenFinished = true; }
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35).rotateX(-Math.PI / 2), arcMaterial(COL.seat[id], 0.95));
    ring.material.uniforms.inner.value = 0.8; ring.position.y = 0.04;
    const ringBg = new THREE.Mesh(ring.geometry, arcMaterial(0x000000, 0.35)); ringBg.material.uniforms.inner.value = 0.8; ringBg.position.y = 0.035;
    const rev = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2), arcMaterial(0xffffff, 0.9)); rev.position.y = 0.05; rev.material.uniforms.inner.value = 0.86; rev.visible = false;
    scene.add(root, ring, ringBg, rev);
    const h = { id, cls, root, mixer, act, cur: null, mats, ring, ringBg, rev, at: 0, dn: 0, yaw: 0, flash: 0 };
    play(h, "Idle");
    heroes[id] = h;
    return h;
  }
  function play(h, name, fade = 0.18) {
    const a = h.act[name]; if (!a || h.cur === a) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (h.cur) h.cur.fadeOut(fade);
    h.cur = a;
  }
  function removeHero(id) { const h = heroes[id]; if (!h) return; scene.remove(h.root, h.ring, h.ringBg, h.rev); delete heroes[id]; }

  // ---- bossové (skinned) ----
  const bosses = {};
  async function bossView(e) {
    if (bosses[e.id]) return bosses[e.id];
    bosses[e.id] = { pending: 1 };
    const g = await loadGlb(SKEL[e.type]);
    const root = SkeletonUtils.clone(g.scene), s = e.type === "guard" ? 2.5 : 2.7;
    root.scale.setScalar(s * SK_S);
    const mats = [];
    root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; if (o.material.name !== "Glow") { o.material = new THREE.MeshLambertMaterial({ map: o.material.map, flatShading: true, color: e.type === "lich" ? 0xd8c8ff : 0xffffff }); mats.push(o.material); } } });
    const mixer = new THREE.AnimationMixer(root), act = {};
    for (const c of g.animations) act[c.name] = mixer.clipAction(c);
    for (const k of ["2H_Melee_Attack_Chop", "Spellcast_Summon", "Spellcast_Shoot", "Death_C_Skeletons", "Spawn_Ground_Skeletons"]) if (act[k]) { act[k].setLoop(THREE.LoopOnce); act[k].clampWhenFinished = true; }
    scene.add(root);
    const b = { root, mixer, act, cur: null, mats, flash: 0, dead: 0, x: e.x, z: e.z, yaw: 0, type: e.type };
    play(b, "Spawn_Ground_Skeletons", 0);
    setTimeout(() => !b.dead && play(b, "Walking_D_Skeletons"), 1400);
    bosses[e.id] = b;
    return b;
  }

  // ---- střely, duše, efekty ----
  const daggerGeo = new THREE.ConeGeometry(0.07, 0.6, 4).rotateX(Math.PI / 2);
  const daggers = new THREE.InstancedMesh(daggerGeo, new THREE.MeshBasicMaterial({ color: 0xe8edf5 }), 120); daggers.frustumCulled = false; daggers.count = 0; scene.add(daggers);
  const soulGeo = new THREE.OctahedronGeometry(0.16, 0);
  const souls = new THREE.InstancedMesh(soulGeo, new THREE.MeshBasicMaterial({ color: COL.soul }), 200); souls.frustumCulled = false; souls.count = 0; scene.add(souls);
  const fxList = [];   // {k, t, life, …}
  const sparks = [];   // {x,y,z,vx,vy,vz,life,max,c,s,g}
  const ringGeo = new THREE.RingGeometry(0.86, 1, 56).rotateX(-Math.PI / 2);
  const ringPool = [];
  function ringFx(x, z, r, color, life, opts = {}) {
    let m = ringPool.find(m => !m.visible);
    if (!m) { m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(m); ringPool.push(m); }
    m.visible = true; m.material.color.set(color); m.position.set(x, 0.06 + (opts.y || 0), z);
    fxList.push({ k: "ring", m, r0: opts.r0 ?? r * 0.4, r, t: 0, life, op: opts.op ?? 0.9 });
  }
  const slashGeo = new THREE.RingGeometry(0.45, 1, 32, 1, -1.15, 2.3).rotateX(-Math.PI / 2);
  const slashPool = [];
  function slashFx(x, z, fx, fz, r, color) {
    let m = slashPool.find(m => !m.visible);
    if (!m) { m = new THREE.Mesh(slashGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); scene.add(m); slashPool.push(m); }
    m.visible = true; m.material.color.set(color); m.position.set(x, 0.7, z); m.rotation.set(0, Math.atan2(fx, fz) - Math.PI / 2, 0); m.scale.setScalar(r);
    fxList.push({ k: "slash", m, t: 0, life: 0.22, r });
  }
  const slamMeshes = {};
  const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6, 1, true).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: COL.tether, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  tether.visible = false; scene.add(tether);
  const zaps = [];
  const zapMat = new THREE.LineBasicMaterial({ color: 0xbff4ff, transparent: true, blending: THREE.AdditiveBlending });
  function zapFx(x0, z0, x1, z1) {
    const pts = []; const n = 7;
    for (let i = 0; i <= n; i++) { const t = i / n, j = i && i < n ? 0.35 : 0; pts.push(new THREE.Vector3(x0 + (x1 - x0) * t + (Math.random() - 0.5) * j, 1 + Math.sin(t * Math.PI) * 1.4, z0 + (z1 - z0) * t + (Math.random() - 0.5) * j)); }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), zapMat.clone()); scene.add(l); zaps.push({ l, t: 0 });
  }
  const burst = (x, y, z, color, n, sp = 3, s = 0.35, life = 0.6, g = 6) => {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, u = Math.random(); sparks.push({ x, y, z, vx: Math.cos(a) * sp * u, vy: sp * (0.4 + Math.random()), vz: Math.sin(a) * sp * u, life, max: life, c: color, s: s * (0.6 + Math.random() * 0.6), g }); }
  };

  let shake = 0, camX = 0, camZ = 0, aspect = 1, t0 = performance.now() / 1000;
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function fx(e, view) {
    switch (e.k) {
      case "slash": slashFx(e.x, e.z, e.fx, e.fz, e.r, 0xfff1c9); break;
      case "spin": ringFx(e.x, e.z, e.r, 0xffe0a8, 0.28, { r0: e.r * 0.5, y: 0.6, op: 0.7 }); break;
      case "nova": ringFx(e.x, e.z, e.r, COL.frost, 0.5, { r0: 0.5, op: 0.85 }); burst(e.x, 0.3, e.z, COL.frost, 24, 5, 0.4, 0.5, 2); break;
      case "zap": zapFx(e.fx, e.fz, e.x, e.z); burst(e.x, 0.8, e.z, 0xbff4ff, 8, 3, 0.35, 0.3); break;
      case "die": {
        const big = ENEMIES[e.type] && ENEMIES[e.type].boss;
        for (let i = 0; i < (big ? 18 : 3); i++) { const a = Math.random() * 6.28, sp = 1.5 + Math.random() * 2.5; bits.push({ g: (Math.random() * debris.length) | 0, x: e.x, y: 0.8, z: e.z, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 3, vz: Math.sin(a) * sp, rx: Math.random() * 6, ry: Math.random() * 6, life: 1.6 + Math.random() * 0.6, s: big ? 1.1 : 0.5 }); }
        burst(e.x, 0.6, e.z, 0x9fb6c9, big ? 40 : 6, 2.4, 0.5, 0.5, 2);
        if (big) { shake = Math.max(shake, 0.6); const b = bosses[e.id]; if (b && b.act) { b.dead = 1; play(b, "Death_C_Skeletons", 0.1); setTimeout(() => scene.remove(b.root), 2600); } }
        break;
      }
      case "soul": break;
      case "ouch": shake = Math.max(shake, e.big ? 0.5 : 0.18); burst(e.x, 1, e.z, 0xff7a6a, e.big ? 16 : 6, 3, 0.35, 0.35); break;
      case "down": burst(e.x, 0.8, e.z, 0xffffff, 20, 3, 0.4, 0.6); shake = Math.max(shake, 0.4); break;
      case "revive": ringFx(e.x, e.z, 2.6, 0xfff3c4, 0.6, { r0: 0.4 }); burst(e.x, 0.6, e.z, 0xfff3c4, 30, 4, 0.45, 0.7, 1); break;
      case "pulse": shake = Math.max(shake, 0.25); break;
      case "slam": { const m = new THREE.Mesh(new THREE.PlaneGeometry(e.r * 2, e.r * 2).rotateX(-Math.PI / 2), arcMaterial(COL.slam, 0.55)); m.material.uniforms.inner.value = 0; m.position.set(e.x, 0.05, e.z); scene.add(m); slamMeshes[e.id] = { m, t: e.t, t0: e.t, x: e.x, z: e.z, r: e.r }; const b = bosses[e.by]; if (b && b.act) { play(b, "2H_Melee_Attack_Chop", 0.1); setTimeout(() => !b.dead && play(b, "Walking_D_Skeletons"), 1300); } break; }
      case "cast": { const b = bosses[e.id]; if (b && b.act) { play(b, "Spellcast_Shoot", 0.1); setTimeout(() => !b.dead && play(b, "Walking_D_Skeletons"), 900); } break; }
      case "summon": { const b = bosses[e.id]; if (b && b.act) { play(b, "Spellcast_Summon", 0.1); setTimeout(() => !b.dead && play(b, "Walking_D_Skeletons"), 1500); } break; }
      case "lvl": for (const id in heroes) { const h = heroes[id].root.position; ringFx(h.x, h.z, 3, 0xfff1b0, 0.8, { r0: 0.3 }); burst(h.x, 0.5, h.z, 0xfff1b0, 26, 3.5, 0.45, 0.9, -1); } break;
      case "heal": { const h = heroes[e.hero]; if (h) burst(h.root.position.x, 1, h.root.position.z, 0x9dff9a, 14, 2, 0.4, 0.7, -2); break; }
      case "win": for (const id in heroes) play(heroes[id], "Cheer"); break;
    }
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); aspect = w / h; camera.aspect = aspect; camera.updateProjectionMatrix();
    glow.mat.uniforms.scale.value = h * renderer.getPixelRatio() * 0.9;
  }

  // st = {t, local, heroes:[packed|null], enemies, gems, shots, eshots, slams, tether:{dps}, boss}
  // adaptivní rozlišení: když snímky trvají dlouho (slabší telefon, hustá horda), sníží se poměr pixelů až na 1
  let perfT = 0, perfN = 0, pr = renderer.getPixelRatio();
  function adapt(dt) {
    perfT += dt; perfN++;
    if (perfT < 2) return;
    const avg = perfT / perfN; perfT = 0; perfN = 0;
    const next = avg > 0.024 ? Math.max(1, pr - 0.25) : pr;   // jen dolů: zpět nahoru by to cukalo
    if (next !== pr) { pr = next; renderer.setPixelRatio(pr); resize(); }
  }

  function render(st, dt) {
    adapt(dt);
    const now = performance.now() / 1000 - t0;
    glow.begin();
    // táborák
    const fl = 1 + Math.sin(now * 11) * 0.06 + Math.sin(now * 23) * 0.04;
    fire.intensity = 60 * fl;
    flames.forEach((f, i) => { f.scale.set(1, fl * (1 + Math.sin(now * (7 + i * 3)) * 0.12), 1); f.rotation.y = now * (1 + i); });
    glow.add(0, 0.8, 0, COL.fire, 5.5, 0.5);
    if (Math.random() < dt * 14) sparks.push({ x: (Math.random() - 0.5) * 0.4, y: 0.8, z: (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 0.6, vy: 1.6 + Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 1.3, max: 1.3, c: 0xffb066, s: 0.18, g: -0.3 });
    for (const [x, z] of lanternSpots) glow.add(x, 2.15, z, 0xffc070, 2.2, 0.55);

    // kostlivci
    let si = 0;
    const shadow = (x, z, s) => { if (si < 420) { shadows.setMatrixAt(si++, M.compose(V.set(x, 0, z), Q.identity(), SC.set(s, 1, s))); } };
    for (const t in skel) for (const im of skel[t].frames) im.count = 0;
    for (const e of st.enemies) {
      if (e.gone) continue;
      const E = ENEMIES[e.type];
      if (E.boss) {
        const b = bosses[e.id] || (bossView(e), null);
        if (b && b.root) {
          const dx = e.x - b.root.position.x, dz = e.z - b.root.position.z;
          if (dx * dx + dz * dz > 1e-5) b.yaw = Math.atan2(dx, dz);
          b.root.position.set(e.x, 0, e.z);
          let d = b.yaw - b.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); b.root.rotation.y += d * Math.min(1, dt * 6);
          b.ft = (b.ft || 0) - dt;   // záblesk zásahu nejvýš 4× za sekundu, jinak by boss při trvalé palbě jen svítil
          if (e.hit > 0 && b.ft <= 0) { b.flash = 1; b.ft = 0.25; }
          b.flash = Math.max(0, b.flash - dt * 8);
          for (const m of b.mats) m.emissive.setRGB(b.flash * 0.35, b.flash * 0.3, b.flash * 0.3);
          b.mixer.update(dt);
          if (e.type === "lich") glow.add(e.x, 2.8, e.z, 0xb98aff, 3.5, 0.5);
        }
        shadow(e.x, e.z, 3);
        continue;
      }
      const S = skel[e.type]; if (!S) continue;
      if (e.ph === undefined) e.ph = Math.random() * FRAMES;
      const fi = Math.floor((now * S.rate * (e.slow ? 0.45 : 1) + e.ph) % FRAMES);
      const im = S.frames[fi]; if (im.count >= im.instanceMatrix.count) continue;
      const rise = e.rise > 0 ? Math.min(1, e.rise / 0.9) : 0;
      const yaw = Math.atan2(e.fx ?? 0, e.fz ?? 1);
      const hitSq = e.hit > 0 ? 1.12 : 1;
      M.compose(V.set(e.x, -rise * 1.3, e.z), Q.setFromAxisAngle(UP, yaw), SC.set(hitSq * SK_S, SK_S / hitSq, hitSq * SK_S));
      im.setMatrixAt(im.count, M);
      if (e.hit > 0) CC.setRGB(3, 3, 3); else if (e.slow) CC.setRGB(0.55, 0.8, 1.5); else CC.setRGB(1, 1, 1);
      im.setColorAt(im.count, CC);
      im.count++;
      if (rise > 0 && Math.random() < 0.3) sparks.push({ x: e.x + (Math.random() - 0.5), y: 0.1, z: e.z + (Math.random() - 0.5), vx: 0, vy: 1, vz: 0, life: 0.5, max: 0.5, c: 0x6b5a48, s: 0.5, g: 1 });
      if (!rise) shadow(e.x, e.z, E.r * 2.2);
    }
    for (const t in skel) for (const im of skel[t].frames) { im.instanceMatrix.needsUpdate = true; im.instanceColor && (im.instanceColor.needsUpdate = true); }
    for (const id in bosses) if (!st.enemies.some(e => e.id == id) && !bosses[id].dead && bosses[id].root) { scene.remove(bosses[id].root); delete bosses[id]; }

    // hrdinové
    let me = null;
    st.heroes.forEach((p, i) => {
      const h = heroes[i]; if (!h) return;
      h.root.visible = h.ring.visible = h.ringBg.visible = !!p;
      if (!p) { h.rev.visible = false; return; }
      const r = h.root;
      r.position.x += (p.x - r.position.x) * (i === st.local ? 1 : Math.min(1, dt * 12));
      r.position.z += (p.z - r.position.z) * (i === st.local ? 1 : Math.min(1, dt * 12));
      if (!p.dn) { h.yaw = Math.atan2(p.fx, p.fz); let d = h.yaw - r.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); r.rotation.y += d * Math.min(1, dt * 14); }
      const moving = Math.hypot(p.mx || 0, p.mz || 0) > 0.15;
      if (p.dn && !h.dn) { h.dn = 1; play(h, "Death_A", 0.1); }
      else if (!p.dn && h.dn) { h.dn = 0; play(h, "Lie_StandUp", 0.1); h.busy = 1.1; fx({ k: "revive", x: p.x, z: p.z }); }
      else if (!p.dn) {
        if (p.at !== h.at) { h.at = p.at; if (!moving || h.cls === "barbarian") { play(h, HERO_ATTACK[h.cls], 0.08); h.busy = h.cls === "barbarian" ? 0.55 : 0.45; } }
        h.busy = Math.max(0, (h.busy || 0) - dt);
        if (!h.busy && !st.cheer) play(h, moving ? "Running_A" : "Idle");
        if (h.act.Running_A) h.act.Running_A.timeScale = 1.15;
      }
      h.flash = p.hurt > 0 ? 1 : Math.max(0, h.flash - dt * 5);
      for (const m of h.mats) m.emissive.setRGB(h.flash * 0.7, h.flash * 0.12, h.flash * 0.1);
      h.mixer.update(dt);
      const frac = Math.max(0, p.hp / p.mh);
      h.ring.position.set(r.position.x, 0.04, r.position.z); h.ringBg.position.copy(h.ring.position); h.ringBg.position.y = 0.035;
      h.ring.material.uniforms.frac.value = frac;
      h.ring.material.uniforms.color.value.set(frac < 0.3 ? 0xff5a4d : COL.seat[i]);
      h.rev.visible = !!p.dn; h.rev.position.set(r.position.x, 0.05, r.position.z); h.rev.material.uniforms.frac.value = p.rev || 0;
      shadow(r.position.x, r.position.z, 1.1);
      // bludičky
      const nOrb = (p.tl && p.tl.svicky) || 0;
      for (let k = 0; k < nOrb; k++) { const a = (p.orb || 0) + k / nOrb * Math.PI * 2; glow.add(r.position.x + Math.cos(a) * 1.9, 0.9, r.position.z + Math.sin(a) * 1.9, 0xffd27a, 1.5, 0.95); glow.add(r.position.x + Math.cos(a) * 1.9, 0.9, r.position.z + Math.sin(a) * 1.9, 0xffffff, 0.5, 1); }
      if (i === st.local) me = r.position;
    });
    // pouto
    const a = heroes[0] && st.heroes[0], b = heroes[1] && st.heroes[1];
    if (a && b && !a.dn && !b.dn) {
      const pa = heroes[0].root.position, pb = heroes[1].root.position, dx = pb.x - pa.x, dz = pb.z - pa.z, L = Math.hypot(dx, dz);
      const max = TETHER_MAX + 3 * (((a.tl && a.tl.dlouhe) || 0) + ((b.tl && b.tl.dlouhe) || 0)), on = L <= max;
      tether.visible = L > 0.5;
      tether.position.set((pa.x + pb.x) / 2, 0.85, (pa.z + pb.z) / 2);
      tether.rotation.set(0, -Math.atan2(dz, dx), 0);
      const thick = on ? 1 + Math.sin(now * 18) * 0.15 + (((a.tl && a.tl.pouto) || 0) + ((b.tl && b.tl.pouto) || 0)) * 0.2 : 0.35;
      tether.scale.set(L, thick, thick);
      tether.material.opacity = on ? 0.95 : 0.25 + Math.sin(now * 30) * 0.1;
      if (on) for (let k = 0; k < Math.ceil(L * 1.2); k++) { const t = (k / Math.ceil(L * 1.2) + now * 0.8) % 1; glow.add(pa.x + dx * t, 0.85, pa.z + dz * t, COL.tether, 0.9, 0.55); }
    } else tether.visible = false;

    // duše
    souls.count = 0;
    for (const g of st.gems) {
      const y = 0.45 + Math.sin(now * 3 + g.id) * 0.12;
      const c = g.heal ? 0x8dff8a : COL.soul, s = g.big ? 1.6 : 1;
      if (souls.count < 200) { souls.setMatrixAt(souls.count, M.compose(V.set(g.x, y, g.z), Q.setFromAxisAngle(UP, now * 2 + g.id), SC.set(s, s * 1.3, s))); souls.setColorAt(souls.count, CC.set(c)); souls.count++; }
      glow.add(g.x, y, g.z, c, g.big ? 1.6 : 1.0, 0.7);
    }
    souls.instanceMatrix.needsUpdate = true; souls.instanceColor && (souls.instanceColor.needsUpdate = true);
    // střely
    daggers.count = 0;
    for (const s of st.shots) {
      if (s.k === "dagger") { if (daggers.count < 120) { daggers.setMatrixAt(daggers.count++, M.compose(V.set(s.x, 0.9, s.z), Q.setFromAxisAngle(UP, Math.atan2(s.vx, s.vz)), SC.set(1, 1, 1))); } glow.add(s.x, 0.9, s.z, 0xdfe8ff, 0.6, 0.35); }
      else { glow.add(s.x, 1, s.z, 0x9fd8ff, 1.5, 0.9); glow.add(s.x, 1, s.z, 0xffffff, 0.55, 1); glow.add(s.x - s.vx * 0.03, 1, s.z - s.vz * 0.03, 0x6fb8ff, 1.1, 0.4); }
    }
    daggers.instanceMatrix.needsUpdate = true;
    for (const s of st.eshots) { glow.add(s.x, 1, s.z, COL.orb, 1.7, 0.95); glow.add(s.x, 1, s.z, 0xffffff, 0.5, 0.9); shadow(s.x, s.z, 0.5); }
    // dopady bosse
    for (const id in slamMeshes) {
      const s = slamMeshes[id]; s.t -= dt;
      s.m.material.uniforms.frac.value = 1; s.m.material.uniforms.inner.value = Math.max(0, s.t / s.t0) * 0.98;
      s.m.material.uniforms.opacity.value = 0.25 + (1 - s.t / s.t0) * 0.45;
      if (s.t <= 0) { scene.remove(s.m); delete slamMeshes[id]; burst(s.x, 0.2, s.z, 0xbda88e, 40, 5, 0.6, 0.6, 3); ringFx(s.x, s.z, s.r * 1.1, 0xffc9a8, 0.35, { r0: s.r * 0.5 }); shake = Math.max(shake, 0.45); }
    }
    // úlomky
    debris.forEach(im => (im.count = 0));
    for (const p of bits) {
      p.life -= dt; p.vy -= 18 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rx += dt * 8; p.ry += dt * 5;
      if (p.y < 0.08) { p.y = 0.08; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
      const im = debris[p.g]; if (!im || im.count >= 160) continue;
      const s = p.s * Math.min(1, p.life / 0.4);
      im.setMatrixAt(im.count++, M.compose(V.set(p.x, p.y, p.z), Q.setFromEuler(new THREE.Euler(p.rx, p.ry, 0)), SC.set(s, s, s)));
    }
    for (let i = bits.length - 1; i >= 0; i--) if (bits[i].life <= 0) bits.splice(i, 1);
    debris.forEach(im => (im.instanceMatrix.needsUpdate = true));
    // jiskry
    for (const p of sparks) { p.life -= dt; p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < 0.05) { p.y = 0.05; p.vy = 0; } glow.add(p.x, p.y, p.z, p.c, p.s, Math.max(0, p.life / p.max)); }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
    if (sparks.length > 900) sparks.splice(0, sparks.length - 900);
    // kruhy a seky
    for (let i = fxList.length - 1; i >= 0; i--) {
      const f = fxList[i]; f.t += dt; const u = f.t / f.life;
      if (u >= 1) { f.m.visible = false; fxList.splice(i, 1); continue; }
      if (f.k === "ring") { const r = f.r0 + (f.r - f.r0) * (1 - (1 - u) * (1 - u)); f.m.scale.setScalar(r); f.m.material.opacity = f.op * (1 - u); }
      else { f.m.material.opacity = 1 - u; f.m.scale.setScalar(f.r * (0.85 + u * 0.25)); f.m.rotation.y += dt * 3; }
    }
    for (let i = zaps.length - 1; i >= 0; i--) { const z = zaps[i]; z.t += dt; z.l.material.opacity = 1 - z.t / 0.2; if (z.t > 0.2) { scene.remove(z.l); z.l.geometry.dispose(); zaps.splice(i, 1); } }
    shadows.count = si; shadows.instanceMatrix.needsUpdate = true;
    glow.end();

    // kamera
    if (me) {
      camX += (me.x - camX) * Math.min(1, dt * 5); camZ += (me.z - camZ) * Math.min(1, dt * 5);
      heroLight.position.set(me.x, 2.2, me.z + 0.5);
    }
    // na výšku širší záběr: vodorovně má být vidět aspoň ~15 m, jinak horda přijde z ničeho
    const dist = aspect < 1 ? 1 + (1 - aspect) * 0.6 : 1, fov = aspect < 1 ? 42 + (1 - aspect) * 26 : 42;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    scene.fog.near = 20 * dist + 4; scene.fog.far = 20 * dist + 30;
    shake = Math.max(0, shake - dt * 2.2);
    const sh = reduced ? 0 : shake * shake * 0.6;
    camera.position.set(camX + (Math.random() - 0.5) * sh, 17 * dist, camZ + 11.5 * dist + (Math.random() - 0.5) * sh);
    camera.lookAt(camX, 0, camZ + 0.6);
    renderer.render(scene, camera);
  }

  resize();
  // pro testy: co se právě kreslí
  const debug = () => ({ skel: Object.values(skel).reduce((n, k) => n + k.frames.reduce((m, im) => m + im.count, 0), 0),
    tether: tether.visible, heroes: Object.keys(heroes).map(Number).filter(i => heroes[i].root.visible), heroAnim: Object.values(heroes).map(h => h.cur && h.cur.getClip().name),
    bosses: Object.values(bosses).filter(b => b.root).length, props: staticMesh ? staticMesh.geometry.attributes.position.count : 0, calls: renderer.info.render.calls, px: renderer.getPixelRatio() });
  return { debug, renderer, scene, camera, addHero, removeHero, setProps, render, fx, resize, preload: cls => loadGlb(HERO_FILE[cls]) };
}
