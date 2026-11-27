// =====================================================================
//  motor-v6-anim.js — dá vida ao modelo "V6 car engine with engine [MoreThem]"
//  (Blendoriano, CC BY 4.0, Sketchfab). O modelo vem parado; tudo aqui é código:
//    começa fechado, vibrando de acordo com a rotação
//    botão "Explodir": as peças de fora se afastam e somem e aparece o miolo
//            (virabrequim, bielas, pistões, comando, balancins e válvulas)
//            com um clarão de luz em cada combustão
//    botão "Implodir": as peças voltam e o motor fecha de novo
//    em rotação alta entra um rastro de movimento (motion blur)
//  As medidas (eixo do virabrequim, manivela, biela, eixo de cada válvula)
//  são tiradas da própria geometria do modelo quando ele carrega.
// =====================================================================
import { createEngineSound } from "./motor-som.js";
import { createBoom } from "./motor-boom.js?v=20261127f";
import * as THREE from "three";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";

// o three.js tira pontos e acentos dos nomes: "Piston1.001" vira "Piston1001"
const norm = (s) => s.replace(/[^A-Za-z0-9_]/g, "");
// peças do motor montado. Fica de fora o "kit" espalhado no chão e o câmbio.
const ASSEMBLED = new Set([
  "Bielle_Sup001", "Bielle_Sup002", "Bielle_Sup003", "Bielle_Sup004", "Bielle_Sup007", "Bielle_Sup008",
  "BzierCurve006", "BzierCurve007", "Cube001", "Cube002", "Cube003", "Cube004", "Cube005", "Cube006",
  "Cube011", "Cube017", "Cylinder001", "Cylinder002", "Cylinder003", "Cylinder004", "Cylinder005",
  "Cylinder009", "Cylinder018", "Cylinder019", "Cylinder020", "Cylinder021", "Cylinder023", "Cylinder025",
  "Cylinder027", "Cylinder028", "Cylinder038", "Cylinder039", "Cylinder040", "PLUG_LOW003", "PLUG_LOW004",
  "Piston1001", "Piston1002", "Piston1003", "Piston1005", "Piston1007", "Piston1008", "Plane001", "Plane002",
  "Plane003", "Plane004", "Plane005", "Plane006", "Plane007", "Plane008", "Plane009", "Plane010",
  "hute_pulley_crank002",
]);
const CRANK = "Cylinder025", CRANK_GEAR = "Cylinder027";
const CAM = "Cylinder001", CAM_GEAR = "Cylinder020";
const VALVES = ["Cylinder002", "Cylinder004"];   // válvulas + molas + travas, uma peça por bancada
const ROCKERS = ["Cylinder009", "Cylinder018"];  // balancins + eixo, uma peça por bancada
const STAY = new Set(["PLUG_LOW003", "PLUG_LOW004"]); // velas ficam no lugar
const isPiston = (n) => n.startsWith("Piston1");
const isRod = (n) => n.startsWith("Bielle_Sup");

const T_EXPLODE = 2.5; // segundos para abrir/fechar
const MAX_REVS = 7;   // voltas por segundo NA TELA no giro máximo (o giro real não dá para ver)
const RPM_IDLE = 4000, RPM_MAX = 15000; // giro de motor de F1 (limitador em 15 000 rpm)
const RPM_DIAL = 16000;                  // fim do mostrador

// ---------- ajudantes de geometria ----------
function vertsOf(obj, rel, step = 1) {
  const out = [], v = new THREE.Vector3(), m = new THREE.Matrix4();
  obj.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    m.multiplyMatrices(rel, o.matrixWorld);
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i += step) out.push(v.fromBufferAttribute(p, i).applyMatrix4(m).clone());
  });
  return out;
}
function circleYZ(pts) { // círculo que melhor passa pelos pontos, no plano YZ
  let Sy = 0, Sz = 0, Syy = 0, Szz = 0, Syz = 0, Sb = 0, Syb = 0, Szb = 0;
  for (const p of pts) {
    const y = p.y, z = p.z, b = -(y * y + z * z);
    Sy += y; Sz += z; Syy += y * y; Szz += z * z; Syz += y * z; Sb += b; Syb += y * b; Szb += z * b;
  }
  const A = new THREE.Matrix3().set(Syy, Syz, Sy, Syz, Szz, Sz, Sy, Sz, pts.length);
  const r = new THREE.Vector3(Syb, Szb, Sb).applyMatrix3(A.invert());
  return new THREE.Vector2(-r.x / 2, -r.y / 2);
}
function lineYZ(pts) {
  const c = pts.reduce((a, p) => a.add(new THREE.Vector2(p.y, p.z)), new THREE.Vector2()).divideScalar(pts.length);
  let syy = 0, szz = 0, syz = 0;
  for (const p of pts) { const dy = p.y - c.x, dz = p.z - c.y; syy += dy * dy; szz += dz * dz; syz += dy * dz; }
  const ang = 0.5 * Math.atan2(2 * syz, syy - szz);
  return { c, d: new THREE.Vector2(Math.cos(ang), Math.sin(ang)) };
}
function intersect(a, b) {
  const det = a.d.x * -b.d.y - a.d.y * -b.d.x;
  const t = ((b.c.x - a.c.x) * -b.d.y - (b.c.y - a.c.y) * -b.d.x) / det;
  return a.c.clone().addScaledVector(a.d, t);
}
// eixo principal (a direção em que a peça é mais comprida)
function principalAxis(pts) {
  const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of pts) { const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z; xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z; }
  let v = new THREE.Vector3(1, 1, 1).normalize();
  for (let i = 0; i < 40; i++) { // iteração de potência
    v = new THREE.Vector3(xx * v.x + xy * v.y + xz * v.z, xy * v.x + yy * v.y + yz * v.z, xz * v.x + yz * v.y + zz * v.z).normalize();
  }
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { const t = p.clone().sub(c).dot(v); lo = Math.min(lo, t); hi = Math.max(hi, t); }
  return { c, axis: v, length: hi - lo, lo, hi };
}
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// textura do clarão (degradê redondo, desenhado num canvas)
function flashTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,250,235,1)");
  grd.addColorStop(0.18, "rgba(255,210,140,0.9)");
  grd.addColorStop(0.45, "rgba(255,120,40,0.35)");
  grd.addColorStop(1, "rgba(255,80,20,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function setupMotorV6(scene, viewer) {
  scene.updateMatrixWorld(true);
  const rel = new THREE.Matrix4().copy(scene.matrixWorld).invert(); // mundo → espaço do modelo
  const root = scene.getObjectByName("RootNode");
  if (!root) return null;

  // 1. tira o kit espalhado e o câmbio
  for (const p of [...root.children]) if (!ASSEMBLED.has(norm(p.name))) root.remove(p);
  scene.updateMatrixWorld(true);

  // controle de cada peça móvel: aplica um "delta" (matriz) no espaço do modelo
  const mover = (node) => {
    node.updateMatrixWorld(true);
    const parentRel = new THREE.Matrix4().multiplyMatrices(rel, node.parent.matrixWorld);
    const m = {
      node,
      parentInv: parentRel.clone().invert(),
      rel0: new THREE.Matrix4().multiplyMatrices(rel, node.matrixWorld),
      set(D) { node.matrix.multiplyMatrices(m.parentInv, D).multiply(m.rel0); node.matrixWorldNeedsUpdate = true; },
    };
    node.matrixAutoUpdate = false;
    return m;
  };
  const byName = (n) => root.children.find((c) => norm(c.name) === n);
  const centerOf = (o) => new THREE.Box3().setFromPoints(vertsOf(o, rel, 7)).getCenter(new THREE.Vector3());
  const rotAt = (center, ang) => new THREE.Matrix4().makeTranslation(0, center.x, center.y)
    .multiply(new THREE.Matrix4().makeRotationX(ang))
    .multiply(new THREE.Matrix4().makeTranslation(0, -center.x, -center.y));

  // separa uma peça em "pedaços soltos" (cada pedaço = triângulos ligados entre si)
  function splitComponents(node) {
    const pieces = [], originals = [];
    node.traverse((o) => { if (o.isMesh && o.geometry.index) originals.push(o); });
    for (const o of originals) {
      const g = o.geometry, pos = g.attributes.position, idx = g.index.array;
      const keyMap = new Map(), weld = new Int32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
        if (!keyMap.has(k)) keyMap.set(k, i);
        weld[i] = keyMap.get(k);
      }
      const parent = new Int32Array(pos.count).map((_, i) => i);
      const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (let t = 0; t < idx.length; t += 3) {
        const a = find(weld[idx[t]]); parent[find(weld[idx[t + 1]])] = a; parent[find(weld[idx[t + 2]])] = a;
      }
      const groups = new Map();
      const m = new THREE.Matrix4().multiplyMatrices(rel, o.matrixWorld), v = new THREE.Vector3();
      for (let t = 0; t < idx.length; t += 3) {
        const r = find(weld[idx[t]]);
        if (!groups.has(r)) groups.set(r, { tris: [], vset: new Set() });
        const gr = groups.get(r);
        gr.tris.push(idx[t], idx[t + 1], idx[t + 2]);
        gr.vset.add(idx[t]); gr.vset.add(idx[t + 1]); gr.vset.add(idx[t + 2]);
      }
      for (const gr of groups.values()) {
        const pts = [...gr.vset].map((i) => v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
        pieces.push({ src: o, tris: gr.tris, pts, n: pts.length, ...principalAxis(pts) });
      }
    }
    originals.forEach((o) => (o.visible = false));
    return pieces;
  }
  // cria uma malha nova só com os triângulos de alguns pedaços (do mesmo jeito que a original)
  function meshesFor(items) {
    const bySrc = new Map();
    for (const it of items) { if (!bySrc.has(it.src)) bySrc.set(it.src, []); bySrc.get(it.src).push(...it.tris); }
    return [...bySrc].map(([src, tris]) => {
      const g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(src.geometry.attributes)) g.setAttribute(k, a);
      g.setIndex(tris);
      const mesh = new THREE.Mesh(g, src.material);
      src.parent.add(mesh);
      mesh.position.copy(src.position); mesh.quaternion.copy(src.quaternion); mesh.scale.copy(src.scale);
      return mover(mesh);
    });
  }
  function clusterByX(pieces, gap) {
    const sorted = [...pieces].sort((a, b) => a.c.x - b.c.x), out = [];
    for (const p of sorted) {
      const last = out[out.length - 1];
      if (last && p.c.x - last.x1 < gap) { last.items.push(p); last.x1 = p.c.x; }
      else out.push({ items: [p], x1: p.c.x });
    }
    return out.map((cl) => ({ items: cl.items, x: cl.items.reduce((a, p) => a + p.c.x, 0) / cl.items.length }));
  }

  // 2. medidas do virabrequim, bielas e pistões
  const pistons = root.children.filter((c) => isPiston(norm(c.name))).map((node) => ({ node, c: centerOf(node) }));
  const banks = [pistons.filter((p) => p.c.z > 0.02), pistons.filter((p) => p.c.z <= 0.02)];
  const lines = banks.map((b) => lineYZ(b.map((p) => p.c)));
  const C = intersect(lines[0], lines[1]); // eixo do virabrequim (no plano YZ)
  lines.forEach((l, i) => {
    const mid = banks[i][0].c;
    if ((mid.y - C.x) * l.d.x + (mid.z - C.y) * l.d.y < 0) l.d.negate();
  });

  const rods = root.children.filter((c) => isRod(norm(c.name)));
  const cyl = pistons.map((p) => {
    const bank = p.c.z > 0.02 ? 0 : 1;
    const d = lines[bank].d;
    const rod = rods.reduce((best, r) => {
      const dx = Math.abs(centerOf(r).x - p.c.x);
      return dx < best.dx ? { r, dx } : best;
    }, { r: null, dx: 1e9 }).r;
    const rv = vertsOf(rod, rel, 2);
    const dist = rv.map((v) => Math.hypot(v.y - p.c.y, v.z - p.c.z));
    const maxd = Math.max(...dist);
    const B0 = circleYZ(rv.filter((_, i) => dist[i] > maxd * 0.62)); // centro da cabeça da biela
    const S0 = circleYZ(rv.filter((_, i) => dist[i] < maxd * 0.3));  // centro do pino do pistão
    const L = B0.distanceTo(S0);
    const v0 = B0.clone().sub(C);
    const sOf = (v) => { const a = v.dot(d); return a + Math.sqrt(Math.max(0, L * L - (v.lengthSq() - a * a))); };
    const s0 = sOf(v0);
    const pv = vertsOf(p.node, rel, 5);
    const crown = Math.max(...pv.map((v) => (v.y - p.c.y) * d.x + (v.z - p.c.z) * d.y));
    const radius = Math.max(...pv.map((v) => Math.abs(v.x - p.c.x))) || 0.04;
    const e = (p.c.y - C.x) * d.x + (p.c.z - C.y) * d.y - s0;
    return {
      bank, d, x: p.c.x, B0, S0, v0, L, s0, sOf, e, crown, radius,
      piston: mover(p.node), rod: mover(rod),
      prevS: s0, rising: false, fireNext: false, phase: 0, heat: 0,
    };
  });
  const rAvg = cyl.reduce((a, c) => a + c.v0.length(), 0) / cyl.length;
  cyl.sort((a, b) => a.x - b.x).forEach((c, i) => (c.fireNext = i % 2 === 0));

  const crank = [byName(CRANK), byName(CRANK_GEAR)].filter(Boolean).map(mover);
  const camNode = byName(CAM);
  const camCenter = camNode ? (() => { const c = new THREE.Box3().setFromPoints(vertsOf(camNode, rel, 3)).getCenter(new THREE.Vector3()); return new THREE.Vector2(c.y, c.z); })() : null;
  const cam = [camNode, byName(CAM_GEAR)].filter(Boolean).map(mover);

  // 3. válvulas: cada uma desce no SEU eixo (elas são inclinadas em relação ao cilindro)
  //    haste + cabeça + trava descem; a mola encolhe; a sede fica parada
  const valves = [];
  for (const vn of VALVES) {
    const node = byName(vn);
    if (!node) continue;
    const bank = centerOf(node).z > 0.02 ? 0 : 1;
    for (const cl of clusterByX(splitComponents(node), 0.012)) {
      const items = cl.items;
      const stem = items.reduce((a, b) => (b.length > a.length ? b : a));
      const axis = stem.axis.clone();
      const out = stem.c.clone().sub(new THREE.Vector3(stem.c.x, C.x, C.y));
      if (axis.dot(out) < 0) axis.negate(); // eixo apontando para fora (para cima)
      const proj = (p) => p.c.clone().sub(stem.c).dot(axis);
      const others = items.filter((p) => p !== stem);
      const spring = others.reduce((a, b) => (b.n > a.n ? b : a), others[0]);
      const rest = others.filter((p) => p !== spring);
      const top = rest.reduce((a, b) => (proj(b) > proj(a) ? b : a), rest[0]);
      const bottoms = rest.filter((p) => p !== top);
      const head = bottoms.reduce((a, b) => (b.n > a.n ? b : a), bottoms[0]);
      const moving = [stem, top, head].filter(Boolean);
      const fixed = bottoms.filter((p) => p !== head);
      // ponto de apoio da mola: a ponta de baixo dela
      let sLo = Infinity, sHi = -Infinity;
      for (const p of spring?.pts || []) { const t = p.clone().sub(stem.c).dot(axis); sLo = Math.min(sLo, t); sHi = Math.max(sHi, t); }
      const owner = cyl.filter((c) => c.bank === bank).reduce((a, c) => (Math.abs(c.x - cl.x) < Math.abs(a.x - cl.x) ? c : a));
      valves.push({
        owner, x: cl.x, bank, axis, stemLen: stem.length,
        tip: stem.c.clone().addScaledVector(axis, stem.length / 2), // ponta de cima (onde o balancim empurra)
        anchor: stem.c.clone().addScaledVector(axis, sLo), springLen: Math.max(1e-4, sHi - sLo),
        move: meshesFor(moving), spring: spring ? meshesFor([spring]) : [],
      });
      if (fixed.length) meshesFor(fixed);
    }
  }
  for (const c of cyl) {
    const mine = valves.filter((v) => v.owner === c).sort((a, b) => a.x - b.x);
    mine.forEach((v, i) => (v.kind = i === 0 ? "admissao" : "escape"));
  }

  // 4. balancins: giram no eixo deles e empurram a válvula para baixo
  const rockers = [];
  for (const rn of ROCKERS) {
    const node = byName(rn);
    if (!node) continue;
    const pieces = splitComponents(node);
    const shaft = pieces.reduce((a, b) => (b.length > a.length ? b : a));
    const pivot = new THREE.Vector2(shaft.c.y, shaft.c.z);
    const assigned = new Set([shaft]);
    const bank = shaft.c.z > 0.02 ? 0 : 1;
    for (const v of valves.filter((v) => v.bank === bank)) {
      const arm = pieces.filter((p) => !assigned.has(p) && Math.abs(p.c.x - v.x) < 0.01);
      if (!arm.length) continue;
      arm.forEach((p) => assigned.add(p));
      const armLen = Math.hypot(v.tip.y - pivot.x, v.tip.z - pivot.y) || 1;
      // sentido do giro que empurra a ponta da válvula para baixo
      const test = new THREE.Vector3(0, v.tip.y, v.tip.z).applyMatrix4(rotAt(pivot, 0.01));
      const sign = test.sub(new THREE.Vector3(0, v.tip.y, v.tip.z)).dot(v.axis) < 0 ? 1 : -1;
      rockers.push({ valve: v, pivot, k: sign / armLen, move: meshesFor(arm) });
    }
    meshesFor(pieces.filter((p) => !assigned.has(p)).concat([shaft])); // eixo e suportes ficam parados
  }

  // 5. peças de fora (afastam e somem)
  const moving = new Set([CRANK, CRANK_GEAR, CAM, CAM_GEAR, ...VALVES, ...ROCKERS]);
  const center = new THREE.Box3().setFromPoints(vertsOf(root, rel, 25)).getCenter(new THREE.Vector3());
  const outer = root.children
    .filter((c) => { const n = norm(c.name); return !moving.has(n) && !STAY.has(n) && !isPiston(n) && !isRod(n); })
    .map((node) => {
      const pc = centerOf(node);
      const dir = pc.clone().sub(center); dir.y = Math.max(dir.y, 0) + 0.15;
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      const mats = [];
      node.traverse((o) => {
        if (!o.isMesh) return;
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.push(m));
      });
      return { m: mover(node), dir: dir.normalize(), dist: pc.distanceTo(center), mats, node };
    })
    .sort((a, b) => b.dist - a.dist);
  outer.forEach((o, i) => (o.delay = (i / outer.length) * 0.9)); // as mais de fora saem primeiro

  // 6. clarão da combustão: luz + brilho redondo (sem bola sólida)
  const tex = flashTexture();
  for (const c of cyl) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const sprite = new THREE.Sprite(mat);
    const top = rAvg + c.L + c.e + c.crown + c.radius * 0.25;
    sprite.position.set(c.x, C.x + c.d.x * top, C.y + c.d.y * top);
    sprite.scale.setScalar(c.radius * 5);
    sprite.visible = false;
    scene.add(sprite);
    c.flash = sprite;
  }
  const lights = [0, 1].map(() => { const l = new THREE.PointLight(0xffb070, 0, rAvg * 8, 2); scene.add(l); return l; });

  // centro e tamanho do miolo, para a câmera enquadrar os pistões depois de abrir
  const coreBox = new THREE.Box3();
  for (const c of cyl) coreBox.expandByPoint(new THREE.Vector3(c.x, C.x, C.y)).expandByPoint(c.flash.position);
  for (const v of valves) coreBox.expandByPoint(v.tip);
  coreBox.expandByScalar(rAvg * 1.2);
  const coreCenter = coreBox.getCenter(new THREE.Vector3());
  const coreRadius = coreBox.getSize(new THREE.Vector3()).length() / 2;

  // 7. escapamento: as duas saídas (uma por bancada) e as chamas dos estouros
  const exhausts = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !/collector/i.test(o.name)) return;
    const pos = o.geometry.attributes.position, P = [], p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) P.push(p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
    const box = new THREE.Box3().setFromPoints(P), size = box.getSize(new THREE.Vector3());
    // a boca é a ponta traseira do coletor (a que fica mais longe da frente, onde estão as polias)
    const tip = P.filter((q) => q.x < box.min.x + size.x * 0.04);
    if (!tip.length) return;
    const mouth = tip.reduce((a, q) => a.add(q), new THREE.Vector3()).divideScalar(tip.length);
    const mid = box.getCenter(new THREE.Vector3());
    const dir = mouth.clone().sub(mid); dir.y = Math.min(dir.y, 0); dir.normalize();
    const len = size.x * 0.8;
    const g = new THREE.Group();
    const parts = [
      { at: 0.08, size: 0.32, color: 0x9fd8ff }, // miolo azulado (bem quente)
      { at: 0.25, size: 0.55, color: 0xfff1c0 },
      { at: 0.5, size: 0.75, color: 0xff9a3a },
      { at: 0.8, size: 0.85, color: 0xff5a1a },
    ].map((q) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: q.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      sp.userData = q;
      sp.scale.setScalar(1e-4); // pequeno e já na boca do escape até o 1º estouro (não atrapalha o enquadramento)
      sp.position.copy(mouth);
      g.add(sp);
      return sp;
    });
    const light = new THREE.PointLight(0xff8a3a, 0, len * 6, 2);
    g.add(light);
    g.visible = false;
    scene.add(g);
    exhausts.push({ g, parts, light, mouth, dir, len, life: 0, power: 0, jitter: new THREE.Vector3() });
  });

  // ---------- estado ----------
  let theta = 0, rpm = RPM_IDLE, revs = 0, time = 0, paused = false;
  let throttle = false, lastThrottle = false, limiter = 0, cutT = 0, overrun = 0, overrunT = 0, kick = 0;
  // segurar o motor no limitador por muito tempo: ele explode sozinho
  const LIMIT_BLOW = 5;      // segundos cortando giro até explodir
  let limitHold = 0;
  const REVS_IDLE = 3.6; // a marcha lenta já gira bem na tela (antes era o ritmo dos 8 500 rpm)
  const revsOf = (r) => REVS_IDLE + ((r - RPM_IDLE) / (RPM_MAX - RPM_IDLE)) * (MAX_REVS - REVS_IDLE);
  let k = 0, kTarget = 0;          // 0 = fechado, 1 = aberto (anda até kTarget)
  let basePos = null, camBase = null, tgtBase = null, dragging = false;
  let camFrom = null, camTo = null, camT = 1;
  viewer.controls?.addEventListener("start", () => (dragging = true));
  viewer.controls?.addEventListener("end", () => (dragging = false));
  const D = new THREE.Matrix4(), S = new THREE.Matrix4();
  // explosão de verdade (motor-boom.js): acontece quando o motor fica 5 s no limitador; depois volta no tempo
  const boom = createBoom({ scene, root, rel, viewer, tex });
  let uiLock = null; // o painel registra aqui como travar/soltar os botões
  function blowUp() {
    if (boom.active || !basePos) return false;
    throttle = false;
    uiLock?.(true);
    if (!boom.start(basePos)) { uiLock?.(false); return false; }
    limitHold = 0;
    sound?.setEnabled(false);
    return true;
  }

  // rastro de movimento: entra em rotação alta (só quando o visualizador tem pós-processamento)
  let trail = null, trailLevel = 0, vibFree = true, subMode = false;
  viewer.addPass?.((composer) => {
    trail = new AfterimagePass(0);
    composer.insertPass(trail, 1); // logo depois de desenhar a cena, antes do brilho
    return trail;
  });

  function setCrank(theta) {
    crank.forEach((m) => m.set(rotAt(C, theta)));
    if (camCenter) { const Dk = rotAt(camCenter, -theta / 2); cam.forEach((m) => m.set(Dk)); }
    for (const c of cyl) {
      const v = c.v0.clone().rotateAround(new THREE.Vector2(), theta);
      const s = c.sOf(v);
      D.makeTranslation(0, c.d.x * (s - c.s0), c.d.y * (s - c.s0));
      c.piston.set(D);
      const B = C.clone().add(v), Sp = C.clone().addScaledVector(c.d, s);
      const u0 = c.S0.clone().sub(c.B0), u = Sp.clone().sub(B);
      const ang = Math.atan2(u.y, u.x) - Math.atan2(u0.y, u0.x);
      D.makeTranslation(0, B.x, B.y).multiply(new THREE.Matrix4().makeRotationX(ang))
        .multiply(new THREE.Matrix4().makeTranslation(0, -c.B0.x, -c.B0.y));
      c.rod.set(D);
      c.s = s;
    }
  }

  function setValve(v, lift) {
    // haste, cabeça e trava descem ao longo do eixo da própria válvula
    D.makeTranslation(-v.axis.x * lift, -v.axis.y * lift, -v.axis.z * lift);
    v.move.forEach((m) => m.set(D));
    // mola encolhe a partir da ponta de baixo
    const k = (v.springLen - lift) / v.springLen, a = v.axis;
    S.set(
      1 + (k - 1) * a.x * a.x, (k - 1) * a.x * a.y, (k - 1) * a.x * a.z, 0,
      (k - 1) * a.y * a.x, 1 + (k - 1) * a.y * a.y, (k - 1) * a.y * a.z, 0,
      (k - 1) * a.z * a.x, (k - 1) * a.z * a.y, 1 + (k - 1) * a.z * a.z, 0,
      0, 0, 0, 1
    );
    D.makeTranslation(v.anchor.x, v.anchor.y, v.anchor.z).multiply(S)
      .multiply(new THREE.Matrix4().makeTranslation(-v.anchor.x, -v.anchor.y, -v.anchor.z));
    v.spring.forEach((m) => m.set(D));
    v.lift = lift;
  }

  function resetParts() {
    for (const o of outer) {
      o.m.set(new THREE.Matrix4());
      o.node.visible = true;
      o.mats.forEach((m) => { m.transparent = false; m.opacity = 1; m.depthWrite = true; m.needsUpdate = true; });
    }
  }

  // posição da câmera para o motor fechado e para o aberto
  function camGoal(open) {
    const cam = viewer.camera;
    if (!open) return { target: tgtBase.clone(), dist: camBase.distanceTo(tgtBase) };
    const coreWorld = scene.localToWorld(coreCenter.clone()).sub(scene.position).add(basePos);
    const vf = THREE.MathUtils.degToRad(cam.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * cam.aspect);
    return { target: coreWorld, dist: (coreRadius * scene.scale.x) / Math.sin(Math.min(vf, hf)) };
  }

  function setOpen(open) {
    kTarget = open ? 1 : 0;
    if (!camBase || !viewer.controls) return;
    camFrom = { target: viewer.controls.target.clone(), dist: viewer.camera.position.distanceTo(viewer.controls.target) };
    camTo = camGoal(open);
    camT = 0;
  }

  function update(dt) {
    const realDt = Math.min(dt, 0.1); // a explosão anda no tempo real, mesmo em celular mais lento
    dt = Math.min(dt, 0.05);
    if (paused) return;
    time += dt;
    if (!basePos) { basePos = scene.position.clone(); camBase = viewer.camera?.position.clone(); tgtBase = viewer.controls?.target.clone(); }
    if (boom.active) { // motor destruído: só a explosão anda; o giro cai a zero
      throttle = false;
      rpm = Math.max(0, rpm - 30000 * dt);
      limiter = 0;
      if (trail) trail.uniforms.damp.value = 0;
      gauge?.(dt);
      boom.update(realDt);
      return;
    }

    // giro: acelerador sobe, solto desce até a marcha lenta
    // pisou: embalo forte embaixo (4→8 mil em ~0,3 s), mais lento perto do limite (~1,3 s até 15 mil)
    if (throttle) rpm += (16000 - 9500 * (rpm - RPM_IDLE) / (RPM_MAX - RPM_IDLE)) * dt;
    else rpm -= (rpm > 9000 ? 6500 : 4200) * dt;
    if (rpm < RPM_IDLE) rpm = RPM_IDLE + Math.sin(time * 9) * 40; // marcha lenta "respirando"
    // limitador: bateu no máximo com o pé embaixo → corta a ignição, cai um pouco, volta, corta de novo
    cutT -= dt;
    if (throttle && rpm >= RPM_MAX) {
      rpm = RPM_MAX - 380 - Math.random() * 260;
      limiter = 0.3;
      kick = 1;
      if (cutT <= 0) { cutT = 0.055 + Math.random() * 0.05; sound?.cut(); if (Math.random() < 0.75) pop(1); }
    }
    limiter = Math.max(0, limiter - dt);
    // tempo cortando giro: sobe enquanto o pé segura no limitador, desce rápido quando solta
    if (throttle && limiter > 0) limitHold += dt;
    else limitHold = Math.max(0, limitHold - dt * 2);
    if (limitHold >= LIMIT_BLOW && blowUp()) return;
    // tirou o pé em giro alto: estalos do escapamento por um instante
    if (!throttle && rpm > 9500 && overrun <= 0 && lastThrottle) overrun = 0.5 + Math.random() * 0.4;
    lastThrottle = throttle;
    if (overrun > 0) {
      overrun -= dt; overrunT -= dt;
      if (overrunT <= 0) { overrunT = 0.06 + Math.random() * 0.14; if (Math.random() < 0.7) pop(0.6 + Math.random() * 0.3); }
    }
    revs = revsOf(rpm);
    gauge?.(dt);
    sound?.update(rpm, throttle, dt);
    const dTheta = revs * Math.PI * 2 * dt;
    theta += dTheta;
    setCrank(theta);
    const speed = revs / MAX_REVS; // 0..1

    // vibração ligada ao giro: cresce mais que proporcional e acompanha as 3 explosões por volta
    kick *= Math.exp(-dt * 18);
    const amp = rAvg * 0.05 * Math.pow(speed, 1.4) + rAvg * 0.03 * kick;
    // com borrão ligado, a vibração muda só uma vez por quadro (senão o motor inteiro fica fora de foco)
    if (!subMode || vibFree) {
    vibFree = false;
    scene.position.set(
      basePos.x + Math.sin(theta * 3) * amp * 0.4,
      basePos.y + Math.sin(theta * 3 + 1.1) * amp,
      basePos.z + Math.sin(theta * 1.5 + 2.3) * amp * 0.6
    );
    scene.rotation.set(Math.sin(theta * 3 + 0.5) * 0.004 * speed * speed, 0, Math.sin(theta * 1.5) * 0.003 * speed * speed);
    }

    // rastro de movimento só em rotação alta (some enquanto a pessoa gira a câmera, para não borrar tudo)
    if (trail) {
      const moving = dragging || camT < 1 || Math.abs(kTarget - k) > 1e-3; // sem rastro enquanto abre/fecha ou a câmera anda
      // o rastro é calculado por quadro: em telas de 120–144 Hz ele ficava longo demais e estourava o brilho.
      // Aqui o "tamanho" do rastro é medido a 60 quadros por segundo e convertido para a taxa real.
      const want = moving || k > 0.05 ? 0 : Math.max(0, (speed - 0.6) / 0.4) * 0.6; // aberto: sem rastro
      trailLevel += (want - trailLevel) * Math.min(1, dt * 3);
      trail.uniforms.damp.value = moving ? 0 : Math.pow(trailLevel, Math.min(4, dt * 60));
    }

    // chamas do escapamento (só com o motor fechado: aberto, os coletores saem de cena)
    for (const e of exhausts) {
      e.life = Math.max(0, e.life - dt);
      const t = e.life > 0 ? e.life / e.dur : 0;
      const a = t * e.power * (k < 0.05 ? 1 : 0);
      e.g.visible = a > 0.01;
      if (!e.g.visible) { e.light.intensity = 0; continue; }
      const L = e.len * (0.5 + 0.7 * e.power) * (0.6 + 0.4 * t);
      for (const sp of e.parts) {
        const q = sp.userData, wob = 1 + (Math.random() - 0.5) * 0.35;
        sp.position.copy(e.mouth).addScaledVector(e.dir, L * q.at).addScaledVector(e.jitter, L * q.at);
        sp.scale.setScalar(L * q.size * wob);
        sp.material.opacity = a * (q.at < 0.2 ? 1 : 0.85);
      }
      e.light.position.copy(e.mouth).addScaledVector(e.dir, L * 0.3);
      e.light.intensity = a * 4;
    }

    // abrir / fechar
    k += Math.sign(kTarget - k) * Math.min(Math.abs(kTarget - k), dt / T_EXPLODE);
    for (const o of outer) {
      const p = ease((k - o.delay * 0.5) / 0.6);
      const dist = p * rAvg * 14;
      D.makeTranslation(o.dir.x * dist, o.dir.y * dist, o.dir.z * dist);
      o.m.set(D);
      const fade = 1 - ease((p - 0.35) / 0.65);
      const see = fade > 0.999;
      o.mats.forEach((m) => {
        if (see === m.transparent) { m.transparent = !see; m.depthWrite = see; m.needsUpdate = true; }
        m.opacity = fade;
      });
      o.node.visible = fade > 0.01;
    }
    // câmera acompanha (mantém o ângulo que a pessoa escolheu, muda só alvo e distância)
    if (camT < 1 && camFrom && !dragging) {
      camT = Math.min(1, camT + dt / T_EXPLODE);
      const e = ease(camT), cam = viewer.camera, ctl = viewer.controls;
      const dir = cam.position.clone().sub(ctl.target).normalize();
      ctl.target.copy(camFrom.target).lerp(camTo.target, e);
      cam.position.copy(ctl.target).addScaledVector(dir, THREE.MathUtils.lerp(camFrom.dist, camTo.dist, e));
    }

    // combustão (ciclo de 4 tempos = 720°) e válvulas
    const open = k > 0.25; // só explode à vista com o motor aberto
    const lightHeat = [0, 0];
    for (const c of cyl) {
      c.phase += dTheta;
      const rising = c.s > c.prevS;
      if (c.rising && !rising) {
        if (c.fireNext) { c.phase = 0; if (open) c.heat = 1 - 0.65 * Math.max(0, (revs / MAX_REVS - 0.55) / 0.45); }
        c.fireNext = !c.fireNext;
      }
      c.rising = rising; c.prevS = c.s;
      c.heat *= Math.exp(-dt * 22); // clarão curto
      c.flash.visible = c.heat > 0.02;
      c.flash.material.opacity = c.heat;
      c.flash.scale.setScalar(c.radius * (3.5 + c.heat * 3));
      if (c.heat > lightHeat[c.bank]) { lightHeat[c.bank] = c.heat; lights[c.bank].position.copy(c.flash.position); }
    }
    lights.forEach((l, i) => (l.intensity = lightHeat[i] * 0.6));
    for (const v of valves) {
      const ph = ((v.owner.phase % (Math.PI * 4)) / Math.PI) * 180;
      const win = v.kind === "escape" ? [170, 370] : [350, 550];
      const x = (ph - win[0]) / (win[1] - win[0]);
      setValve(v, x > 0 && x < 1 ? Math.sin(x * Math.PI) * v.stemLen * 0.11 : 0);
    }
    for (const r of rockers) r.move.forEach((m) => m.set(rotAt(r.pivot, r.k * (r.valve.lift || 0))));
  }

  // um estouro no escapamento (as duas bancadas, às vezes só uma)
  function pop(power) {
    if (!exhausts.length) return;
    const both = Math.random() < 0.45;
    const first = Math.floor(Math.random() * exhausts.length);
    exhausts.forEach((e, i) => {
      if (!both && i !== first) return;
      e.dur = 0.07 + Math.random() * 0.07;
      e.life = e.dur;
      e.power = Math.min(1, power * (0.75 + Math.random() * 0.35));
      e.jitter.set(0, (Math.random() - 0.4) * 0.35, (Math.random() - 0.5) * 0.35);
    });
    kick = Math.max(kick, 0.6);
    onPop?.();
    sound?.pop(power);
  }
  let onPop = null;

  // som: nasce no primeiro toque (celular e navegador só deixam tocar depois de um toque)
  let sound = null, soundLoading = false, soundOn = true;
  function ensureSound() {
    if (sound || soundLoading || !soundOn) return;
    soundLoading = true;
    createEngineSound().then((s) => { sound = s; window.__motorSom = s; sound?.start(); }).catch((e) => console.warn("som:", e)).finally(() => (soundLoading = false));
  }
  // fora da tela: silêncio
  setInterval(() => { if (!sound) return; if (viewer.running && soundOn && !boom.active) sound.resume(); else sound.suspend(); }, 300);

  // painel de controles (fica fora do quadro 3D)
  function ui(panel) {
    const box = document.createElement("div");
    box.className = "engine-ui";
    // conta-giros desenhado em SVG (fica nítido em qualquer tela, sem imagem)
    const A0 = -225, A1 = 45; // ângulos do 0 e do fim (graus, 0 = direita, sentido horário)
    const ang = (r) => A0 + (r / RPM_DIAL) * (A1 - A0);
    const pt = (a, rad) => [100 + rad * Math.cos(a * Math.PI / 180), 100 + rad * Math.sin(a * Math.PI / 180)];
    let ticks = "", nums = "";
    for (let r = 0; r <= RPM_DIAL; r += 500) {
      const major = r % 2000 === 0, red = r >= 14000;
      const [x1, y1] = pt(ang(r), major ? 70 : 75), [x2, y2] = pt(ang(r), 82);
      ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="${red ? "tk red" : major ? "tk maj" : "tk"}"/>`;
      if (major) { const [tx, ty] = pt(ang(r), 58); nums += `<text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" class="${red ? "num red" : "num"}">${r / 1000}</text>`; }
    }
    const arc = (r0, r1, rad) => { const [x0, y0] = pt(ang(r0), rad), [x1, y1] = pt(ang(r1), rad); const big = ang(r1) - ang(r0) > 180 ? 1 : 0; return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${rad} ${rad} 0 ${big} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
    box.innerHTML = `
      <p class="panel-title">Controls</p>
      <div class="tacho" role="img" aria-label="tachometer">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="92" class="ring"/>
          <path d="${arc(14000, RPM_DIAL, 86)}" class="redzone"/>
          ${ticks}${nums}
          <text x="100" y="172" class="unit">x1000 RPM</text>
          <g class="needle"><line x1="100" y1="100" x2="100" y2="30"/></g>
          <circle cx="100" cy="100" r="9" class="hub"/>
        </svg>
        <output class="rpm">4000</output>
        <span class="lim">REV LIMITER</span>
      </div>
      <button type="button" class="pedal" data-a="gas" aria-label="Throttle: hold to accelerate">
        <svg viewBox="0 0 64 80" aria-hidden="true"><path class="arm" d="M32 4v20"/><rect class="pad" x="10" y="22" width="44" height="54" rx="9"/><path class="grip" d="M18 34h28M18 44h28M18 54h28M18 64h28"/></svg>
        <span>Throttle<small>hold</small></span>
      </button>
      <div class="row-btns"><button type="button" data-a="toggle">Explode</button><button type="button" data-a="sound" aria-pressed="true" title="Engine sound">🔊 Sound</button></div>`;
    const btn = box.querySelector('[data-a="toggle"]');
    const lock = (v) => { btn.disabled = v; gas.disabled = v; if (v) press(false); };
    uiLock = lock;
    boom.soundOn = () => soundOn;
    boom.onDone = () => { rpm = RPM_IDLE; lock(false); sound?.setEnabled(soundOn); };
    btn.addEventListener("click", () => {
      if (boom.active) return;
      const open = kTarget < 0.5;
      setOpen(open);
      btn.textContent = open ? "Implode" : "Explode";
    });
    // acelerador: segurar com o dedo/mouse, ou espaço/Enter com o botão em foco, ou ↑ / W com o motor na tela
    const gas = box.querySelector(".pedal");
    const press = (v) => { if (v && boom.active) return; if (v) ensureSound(); throttle = v; gas.classList.toggle("on", v); };
    const sbtn = box.querySelector('[data-a="sound"]');
    sbtn.addEventListener("click", () => {
      soundOn = !soundOn;
      sbtn.setAttribute("aria-pressed", String(soundOn));
      sbtn.textContent = soundOn ? "🔊 Sound" : "🔇 Muted";
      if (soundOn) ensureSound();
      sound?.setEnabled(soundOn);
    });
    gas.addEventListener("pointerdown", (e) => { e.preventDefault(); gas.setPointerCapture?.(e.pointerId); press(true); });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => gas.addEventListener(ev, () => press(false)));
    gas.addEventListener("contextmenu", (e) => e.preventDefault());
    gas.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); press(true); } });
    gas.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") press(false); });
    gas.addEventListener("blur", () => press(false));
    const keyOk = (e) => (e.key === "ArrowUp" || e.key === "w" || e.key === "W") && viewer.running && !e.target.closest?.("input,textarea");
    addEventListener("keydown", (e) => { if (keyOk(e)) { e.preventDefault(); press(true); } });
    addEventListener("keyup", (e) => { if (keyOk(e)) press(false); });
    addEventListener("blur", () => press(false));

    const needle = box.querySelector(".needle"), out = box.querySelector(".rpm"), tacho = box.querySelector(".tacho"), lim = box.querySelector(".lim");
    let shown = -1, textT = 0;
    gauge = (dt) => {
      const a = ang(Math.max(0, rpm)) + 90; // a agulha desenhada aponta para cima (−90°)
      needle.setAttribute("transform", `rotate(${a.toFixed(2)} 100 100)`);
      textT -= dt;
      if (textT <= 0) { textT = 0.08; const r = Math.round(rpm / 50) * 50; if (r !== shown) { shown = r; out.textContent = r.toLocaleString("en-US"); } }
      tacho.classList.toggle("limit", limiter > 0);
      // aviso antes de explodir sozinho
      const hot = limitHold > LIMIT_BLOW * 0.5;
      if (hot !== tacho.classList.contains("hot")) { tacho.classList.toggle("hot", hot); lim.textContent = hot ? "OVERHEAT!" : "REV LIMITER"; }
    };
    onPop = () => { tacho.classList.remove("pop"); void tacho.offsetWidth; tacho.classList.add("pop"); };
    panel.append(box);
  }
  let gauge = null;

  setCrank(0);
  // borrão de movimento: quantos desenhos da cena por quadro. Sobe com a rotação.
  // Versão leve: até 4; versão original: até 8. Se o PC não der conta (menos de ~40 FPS), reduz sozinho.
  const SUB_MAX = (document.documentElement.dataset.versao === "original" || new URLSearchParams(location.search).has("original")) ? 8 : 4;
  let subCap = SUB_MAX, emaDt = 1 / 60, coolT = 0;
  function subframes(dt) {
    if (paused || boom.active) return 1;
    // não borra enquanto abre/fecha ou a câmera anda (as peças voando ficariam duplicadas)
    if (dragging || camT < 1 || Math.abs(kTarget - k) > 1e-3) return 1;
    emaDt += (dt - emaDt) * 0.05;
    coolT += dt;
    if (coolT > 1) {
      if (emaDt > 1 / 38 && subCap > 2) { subCap--; coolT = 0; }
      else if (emaDt < 1 / 55 && subCap < SUB_MAX) { subCap++; coolT = 0; }
    }
    const speed = revs / MAX_REVS;
    const t = Math.min(1, Math.max(0, (speed - 0.5) / 0.4));
    const n = Math.max(1, Math.round(1 + (subCap - 1) * t));
    subMode = true; vibFree = true; // só o 1º subquadro mexe a vibração
    return n;
  }

  // tamanho do borrão: no máximo ~35° de virabrequim fechado e ~10° aberto (aberto precisa dar para ver as peças)
  function shutter(dt) {
    const span = revs * Math.PI * 2 * dt;                 // quanto o virabrequim gira neste quadro
    const maxSpan = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(35, 10, k));
    return Math.min(1, maxSpan / Math.max(span, 1e-6));
  }

  return { update, subframes, shutter, ui, setOpen, setPaused: (v) => (paused = v), info: { cylinders: cyl.length, valves: valves.length, rockers: rockers.length, outer: outer.length, valveAxes: valves.map((v) => v.axis.toArray().map((n) => +n.toFixed(2)).join(",")), bores: lines.map((l) => [+l.d.x.toFixed(2), +l.d.y.toFixed(2)].join(",")) } };
}
