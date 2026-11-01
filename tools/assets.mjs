// Ořeže CC0 balíčky KayKit (Kay Lousberg) na to, co hra opravdu potřebuje, a uloží je do assets/.
// Zdroj: ../_dl-kaykit (git clone balíčků z github.com/KayKit-Game-Assets). Spuštění: npm run assets
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, resample, weld, unpartition, quantize } from "@gltf-transform/functions";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("../_dl-kaykit");
const OUT = path.resolve("assets");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const ADV = `${SRC}/KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures/Characters/gltf`;
const SKL = `${SRC}/KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons/Characters/gltf`;
const HAL = `${SRC}/KayKit-Halloween-Bits-1.0/addons/kaykit_halloween_bits/Assets/gltf`;

const HERO_ANIMS = ["Idle", "Running_A", "1H_Melee_Attack_Slice_Horizontal", "2H_Melee_Attack_Spin", "Spellcast_Shoot",
  "Throw", "Hit_A", "Death_A", "Lie_Idle", "Lie_StandUp", "Cheer"];
const SKEL_ANIMS = ["Walking_D_Skeletons", "Running_C", "Spawn_Ground_Skeletons", "Death_C_Skeletons", "2H_Melee_Attack_Chop",
  "Spellcast_Summon", "Spellcast_Shoot", "Taunt", "Idle_Combat", "Hit_A"];
const ENV = ["floor_dirt", "grave_A", "grave_A_destroyed", "grave_B", "gravestone", "gravemarker_A", "gravemarker_B", "crypt",
  "fence", "fence_broken", "fence_pillar", "tree_dead_large", "tree_dead_medium", "tree_dead_small", "tree_pine_orange_medium",
  "tree_pine_yellow_small", "pumpkin_orange_jackolantern", "pumpkin_yellow_small", "lantern_standing", "post_lantern",
  "candle_triple", "skull_candle", "bone_A", "bone_B", "bone_C", "skull", "ribcage", "shrine_candles", "coffin"];

async function slim(file, keep, out) {
  const doc = await io.read(file);
  for (const a of doc.getRoot().listAnimations()) if (!keep.includes(a.getName())) {
    // samotné a.dispose() nechá samplery i jejich data viset a prune je pak nenajde
    for (const c of a.listChannels()) c.dispose();
    for (const sm of a.listSamplers()) sm.dispose();
    a.dispose();
  }
  await doc.transform(resample({ tolerance: 2e-4 }), dedup(), prune(), quantize());
  await io.write(out, doc);
  const names = doc.getRoot().listAnimations().map(a => a.getName());
  console.log(path.basename(out), (fs.statSync(out).size / 1024).toFixed(0) + " kB", names.length + " animací");
}

fs.mkdirSync(OUT, { recursive: true });
for (const n of ["Knight", "Mage", "Barbarian", "Rogue_Hooded"]) await slim(`${ADV}/${n}.glb`, HERO_ANIMS, `${OUT}/${n.toLowerCase()}.glb`);
for (const n of ["Minion", "Warrior", "Rogue", "Mage"]) await slim(`${SKL}/Skeleton_${n}.glb`, SKEL_ANIMS, `${OUT}/skel_${n.toLowerCase()}.glb`);

// prostředí: všechny kousky do jednoho glb, každý jako uzel s názvem souboru (sdílí jednu texturu)
const env = await io.read(`${HAL}/${ENV[0]}.gltf`);
const envScene = env.getRoot().getDefaultScene() || env.getRoot().listScenes()[0];
const renameRoot = (doc, name) => {
  const sc = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const kids = sc.listChildren();
  const g = doc.createNode(name);
  for (const k of kids) { sc.removeChild(k); g.addChild(k); }
  sc.addChild(g);
};
renameRoot(env, ENV[0]);
const { mergeDocuments } = await import("@gltf-transform/functions");
for (const n of ENV.slice(1)) {
  const d = await io.read(`${HAL}/${n}.gltf`);
  renameRoot(d, n);
  const map = mergeDocuments(env, d);
  const sc = [...map.values()].find(v => v.propertyType === "Scene") || env.getRoot().listScenes().at(-1);
  for (const k of sc.listChildren()) { sc.removeChild(k); envScene.addChild(k); }
  sc.dispose();
}
await env.transform(dedup(), weld(), prune(), quantize(), unpartition());
await io.write(`${OUT}/env.glb`, env);
console.log("env.glb", (fs.statSync(`${OUT}/env.glb`).size / 1024).toFixed(0) + " kB", envScene.listChildren().length + " kusů");
