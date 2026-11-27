// =====================================================================
//  motor-boom.js — botão "Explode (Real)": o motor V6 explode de verdade (meme)
//    1. no clique, cada peça de cima do modelo vira um "estilhaço" com velocidade,
//       giro e gravidade; a trajetória inteira é calculada na hora e guardada quadro a quadro
//    2. bola de fogo, faíscas, fumaça, clarão e tremor (tudo em função do tempo t)
//    3. no fim aparece "Rewind": o mesmo filme toca de trás para frente até o motor
//       voltar exatamente à posição original
//  Como tudo depende só de t, voltar no tempo é só diminuir t.
// =====================================================================
import * as THREE from "three";

const T_SIM = 4;          // segundos de explosão (depois disso as peças já pararam)
const FPS = 60;           // quadros gravados por segundo
const REWIND_SPEED = 1.7; // o retrocesso é mais rápido que a explosão

// pseudoaleatório com semente: a mesma explosão pode ser recalculada igualzinha
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function smokeTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.5, "rgba(255,255,255,0.35)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createBoom({ scene, root, rel, viewer, tex }) {
  const smokeTex = smokeTexture();
  const fx = new THREE.Group();
  fx.visible = false;
  scene.add(fx);

  // ---------- botões e camadas por cima do quadro 3D ----------
  const el = viewer.el;
  const flash = document.createElement("div");
  flash.className = "boom-flash";
  const rewindBtn = document.createElement("button");
  rewindBtn.type = "button";
  rewindBtn.className = "boom-rewind";
  rewindBtn.textContent = "◀◀ Rewind";
  rewindBtn.hidden = true;
  const label = document.createElement("span");
  label.className = "boom-label";
  label.textContent = "◀◀ REWIND";
  label.hidden = true;
  el.append(flash, rewindBtn, label);

  // ---------- estado ----------
  let state = "idle"; // idle → boom → dead → rewind → idle
  let t = 0, chunks = [], frames = 0, effects = null, basePos = null, cam0 = null;
  let audio = null, onDone = null, soundOn = () => true;
  const tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3();

  // caixa de um objeto no espaço do modelo (rootRel = raiz → modelo)
  function boxOf(obj, toModel) {
    const box = new THREE.Box3(), v = new THREE.Vector3(), m = new THREE.Matrix4();
    obj.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      m.multiplyMatrices(toModel, o.matrixWorld);
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 500));
      for (let i = 0; i < pos.count; i += step) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
    });
    return box;
  }

  // ---------- 1. explode: monta os estilhaços e calcula o filme inteiro ----------
  function start(base) {
    if (state !== "idle") return false;
    basePos = base.clone();
    scene.position.copy(basePos);
    scene.rotation.set(0, 0, 0);
    scene.updateMatrixWorld(true);

    // mundo → modelo, medido agora (o enquadramento pode ter mudado a escala da cena)
    const rootRel = new THREE.Matrix4().multiplyMatrices(rel, root.matrixWorld);
    const toModel = rootRel.clone().multiply(new THREE.Matrix4().copy(root.matrixWorld).invert());
    const rootRelInv = rootRel.clone().invert();

    chunks = [];
    const all = new THREE.Box3();
    for (const node of root.children) {
      if (node.matrixAutoUpdate) node.updateMatrix();
      const box = boxOf(node, toModel);
      if (box.isEmpty()) continue;
      all.union(box);
      chunks.push({
        node, box, local0: node.matrix.clone(), auto0: node.matrixAutoUpdate,
        cur0: rootRel.clone().multiply(node.matrix), rootRelInv,
        c: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()),
      });
    }
    if (!chunks.length) return false;
    const S = all.getSize(new THREE.Vector3()).length();
    const center = all.getCenter(new THREE.Vector3());
    const origin = center.clone().add(new THREE.Vector3(0, -all.getSize(new THREE.Vector3()).y * 0.15, 0));
    const floor = all.min.y;
    const g = S * 3.2;
    const rand = rng(Date.now());
    frames = Math.round(T_SIM * FPS) + 1;
    const dt = 1 / FPS;

    for (const ch of chunks) {
      const dir = ch.c.clone().sub(origin);
      if (dir.lengthSq() < 1e-8) dir.set(rand() - 0.5, 1, rand() - 0.5);
      dir.y = 0; dir.normalize();
      const f = Math.sqrt(Math.min(2.2, Math.max(0.45, (S * 0.22) / (ch.size.length() + 1e-6)))); // peça grande voa menos
      const vel = new THREE.Vector3(
        dir.x * S * (0.5 + rand() * 1.1) * f + (rand() - 0.5) * S * 0.3,
        S * (1.1 + rand() * 1.4) * f,
        dir.z * S * (0.5 + rand() * 1.1) * f + (rand() - 0.5) * S * 0.3
      );
      const axis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      let spin = (4 + rand() * 12) * f;
      const half = Math.max(ch.size.y * 0.45, ch.size.length() * 0.12);
      const pos = new THREE.Vector3(), rot = new THREE.Quaternion(), dq = new THREE.Quaternion();
      ch.track = new Float32Array(frames * 7);
      for (let i = 0; i < frames; i++) {
        ch.track.set([pos.x, pos.y, pos.z, rot.x, rot.y, rot.z, rot.w], i * 7);
        vel.y -= g * dt;
        vel.multiplyScalar(1 - 0.15 * dt);
        pos.addScaledVector(vel, dt);
        rot.premultiply(dq.setFromAxisAngle(axis, spin * dt));
        // chão: quica, perde força e para de girar aos poucos
        if (ch.c.y + pos.y - half < floor) {
          pos.y = floor + half - ch.c.y;
          if (vel.y < 0) { vel.y *= vel.y < -S * 0.25 ? -0.32 : 0; vel.x *= 0.6; vel.z *= 0.6; spin *= 0.55; }
          vel.x *= 1 - 4 * dt; vel.z *= 1 - 4 * dt; spin *= 1 - 3 * dt;
        }
      }
      ch.node.matrixAutoUpdate = false;
    }
    buildEffects(S, origin, floor, rand);
    cam0 = viewer.controls ? viewer.camera.position.distanceTo(viewer.controls.target) : null;
    fx.visible = true;
    state = "boom";
    t = 0;
    flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go");
    if (soundOn()) playBoom();
    apply();
    return true;
  }

  // ---------- 2. efeitos: fogo, faíscas, fumaça, focos de incêndio, luz ----------
  function buildEffects(S, origin, floor, rand) {
    fx.clear();
    const add = (o) => (fx.add(o), o);
    const fire = [0xffffff, 0xfff0b0, 0xffc060, 0xff8a30, 0xff5a18, 0xff3a10, 0xffd890].map((color) => ({
      sp: add(new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }))),
      off: new THREE.Vector3(rand() - 0.5, rand() * 0.6, rand() - 0.5).multiplyScalar(S * 0.25),
      delay: rand() * 0.12, size: S * (0.45 + rand() * 0.55),
    }));
    const smoke = Array.from({ length: 14 }, () => ({
      sp: add(new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: new THREE.Color().setHSL(0.07, 0.1, 0.06 + rand() * 0.08), transparent: true, depthWrite: false, opacity: 0 }))),
      off: new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).multiplyScalar(S * 0.35),
      drift: new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).multiplyScalar(S * 0.12),
      start: 0.08 + rand() * 0.35, rise: S * (0.25 + rand() * 0.25), size: S * (0.35 + rand() * 0.35),
    }));
    // faíscas: cada uma é um tiro balístico com vida curta
    const N = 260;
    const spark = { v: new Float32Array(N * 3), life: new Float32Array(N) };
    for (let i = 0; i < N; i++) {
      const a = rand() * Math.PI * 2, up = 0.2 + rand() * 0.9, sp = S * (1.5 + rand() * 3);
      spark.v.set([Math.cos(a) * sp * (1 - up * 0.5), up * sp, Math.sin(a) * sp * (1 - up * 0.5)], i * 3);
      spark.life[i] = 0.4 + rand() * 1.1;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    sg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const points = add(new THREE.Points(sg, new THREE.PointsMaterial({ map: tex, size: S * 0.035, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    // focos de incêndio nas 3 maiores peças, depois que caem
    const big = [...chunks].sort((a, b) => b.size.length() - a.size.length()).slice(0, 3);
    const burns = big.map((ch) => ({
      ch, sps: [0xff6a20, 0xffb040, 0xfff0c0].map((color, j) => add(new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })))),
      seed: rand() * 10,
    }));
    const light = add(new THREE.PointLight(0xff9a40, 0, S * 8, 2));
    light.position.copy(origin);
    effects = { S, origin, floor, fire, smoke, spark, points, burns, light };
  }

  // posição de uma peça no tempo t (interpola entre dois quadros gravados)
  function poseAt(ch, time) {
    const f = Math.min(frames - 1, Math.max(0, time * FPS)), i = Math.floor(f), j = Math.min(frames - 1, i + 1), w = f - i;
    const A = ch.track, a = i * 7, b = j * 7;
    p.set(A[a] + (A[b] - A[a]) * w, A[a + 1] + (A[b + 1] - A[a + 1]) * w, A[a + 2] + (A[b + 2] - A[a + 2]) * w);
    q.set(A[a + 3], A[a + 4], A[a + 5], A[a + 6]).slerp(new THREE.Quaternion(A[b + 3], A[b + 4], A[b + 5], A[b + 6]), w);
  }

  // ---------- 3. desenha tudo no tempo t ----------
  function apply() {
    for (const ch of chunks) {
      poseAt(ch, t);
      // B = vai até o centro da peça, gira, volta, e soma o deslocamento
      tmp.makeTranslation(ch.c.x + p.x, ch.c.y + p.y, ch.c.z + p.z)
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
        .multiply(new THREE.Matrix4().makeTranslation(-ch.c.x, -ch.c.y, -ch.c.z));
      ch.node.matrix.copy(ch.rootRelInv).multiply(tmp).multiply(ch.cur0);
      ch.node.matrixWorldNeedsUpdate = true;
    }
    const { S, origin, fire, smoke, spark, points, burns, light } = effects;
    for (const f of fire) {
      const u = t - f.delay;
      f.sp.visible = u > 0 && u < 1.6;
      if (!f.sp.visible) continue;
      f.sp.position.copy(origin).add(f.off).addScaledVector(new THREE.Vector3(0, 1, 0), S * 0.25 * u);
      f.sp.scale.setScalar(f.size * (0.2 + 0.8 * smooth(0, 0.3, u)) * (1 + 0.3 * u));
      f.sp.material.opacity = 1 - smooth(0.2, 1.5, u);
    }
    for (const s of smoke) {
      const u = t - s.start;
      s.sp.visible = u > 0;
      if (!s.sp.visible) continue;
      s.sp.position.copy(origin).add(s.off).addScaledVector(s.drift, u).add(new THREE.Vector3(0, s.rise * u, 0));
      s.sp.scale.setScalar(s.size * (1 + u * 0.9));
      s.sp.material.opacity = 0.75 * smooth(0, 0.4, u) * (1 - smooth(1.6, T_SIM, u)) + 0.12 * smooth(1, 2, u);
    }
    const pos = points.geometry.attributes.position, col = points.geometry.attributes.color;
    for (let i = 0; i < spark.life.length; i++) {
      const L = spark.life[i], u = Math.min(t, L);
      const vx = spark.v[i * 3], vy = spark.v[i * 3 + 1], vz = spark.v[i * 3 + 2];
      pos.setXYZ(i, origin.x + vx * u, Math.max(effects.floor, origin.y + vy * u - 0.5 * S * 3.2 * u * u), origin.z + vz * u);
      const fade = t < L ? 1 - t / L : 0;
      col.setXYZ(i, fade, fade * 0.65, fade * 0.25);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    // focos de incêndio: acompanham a peça e acendem depois que ela cai
    const now = performance.now() / 1000;
    let burnLevel = 0;
    for (const b of burns) {
      poseAt(b.ch, t);
      const lv = smooth(0.9, 1.6, t);
      burnLevel = Math.max(burnLevel, lv);
      b.sps.forEach((sp, j) => {
        const fl = 1 + 0.25 * Math.sin(now * (9 + j * 3) + b.seed) + 0.15 * Math.sin(now * 23 + j);
        sp.visible = lv > 0.01;
        sp.position.set(b.ch.c.x + p.x, b.ch.c.y + p.y + b.ch.size.y * (0.35 + j * 0.12), b.ch.c.z + p.z);
        sp.scale.setScalar(S * (0.08 - j * 0.018) * fl);
        sp.material.opacity = lv * (0.9 - j * 0.15);
      });
    }
    light.intensity = 90 * Math.exp(-t * 4.5) + burnLevel * 4 * (1 + 0.3 * Math.sin(now * 13));
    // tremor da cena (deterministico) e câmera afastando para caber os estilhaços
    const shake = S * 0.035 * Math.exp(-t * 7);
    scene.position.set(basePos.x + Math.sin(t * 91) * shake, basePos.y + Math.sin(t * 77 + 1) * shake, basePos.z + Math.sin(t * 63 + 2) * shake);
    if (cam0 && viewer.controls && !viewer.dragging) {
      const cam = viewer.camera, ctl = viewer.controls;
      const dir = cam.position.clone().sub(ctl.target).normalize();
      cam.position.copy(ctl.target).addScaledVector(dir, cam0 * (1 + 1.1 * smooth(0, 1.1, t)));
    }
  }

  // ---------- 4. volta tudo ao lugar original ----------
  function finish() {
    for (const ch of chunks) {
      ch.node.matrix.copy(ch.local0);
      ch.node.matrixAutoUpdate = ch.auto0;
      ch.node.matrixWorldNeedsUpdate = true;
    }
    fx.visible = false;
    scene.position.copy(basePos);
    el.classList.remove("rewinding");
    label.hidden = true;
    state = "idle";
    chunks = [];
    onDone?.();
  }

  function rewind() {
    if (state !== "dead") return;
    rewindBtn.hidden = true;
    label.hidden = false;
    el.classList.add("rewinding");
    state = "rewind";
    if (soundOn()) playRewind();
  }
  rewindBtn.addEventListener("click", rewind);

  function update(dt) {
    if (state === "boom") {
      t = Math.min(T_SIM, t + dt);
      if (t >= T_SIM) { state = "dead"; rewindBtn.hidden = false; }
    } else if (state === "rewind") {
      t = Math.max(0, t - dt * REWIND_SPEED);
    }
    apply();
    if (state === "rewind" && t <= 0) finish();
  }

  // ---------- som: estrondo e "fita voltando" (sintetizados, sem arquivo) ----------
  function ctx() {
    if (!audio) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; audio = new AC(); }
    if (audio.state !== "running") audio.resume();
    return audio;
  }
  function noiseBuffer(ac, secs, shape) {
    const n = Math.floor(ac.sampleRate * secs), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * shape(i / n);
    return buf;
  }
  function playBoom() {
    const ac = ctx(); if (!ac) return;
    const now = ac.currentTime, out = ac.createGain();
    out.gain.value = 0.9;
    out.connect(ac.destination);
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, 2.6, (x) => Math.pow(1 - x, 2.5));
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(5000, now);
    lp.frequency.exponentialRampToValueAtTime(160, now + 1.8);
    src.connect(lp).connect(out);
    src.start(now);
    const osc = ac.createOscillator(), og = ac.createGain();
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.7);
    og.gain.setValueAtTime(1.1, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    osc.connect(og).connect(out);
    osc.start(now); osc.stop(now + 1);
  }
  function playRewind() {
    const ac = ctx(); if (!ac) return;
    const now = ac.currentTime, dur = T_SIM / REWIND_SPEED, out = ac.createGain();
    out.gain.value = 0.6;
    out.connect(ac.destination);
    // o estrondo ao contrário: começa baixinho e termina "sugando"
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, dur, (x) => Math.pow(x, 2.5));
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(200, now);
    lp.frequency.exponentialRampToValueAtTime(5000, now + dur);
    src.connect(lp).connect(out);
    src.start(now);
    // chiado de fita rebobinando
    const osc = ac.createOscillator(), bp = ac.createBiquadFilter(), og = ac.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(1400, now + dur);
    bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 2;
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.12, now + 0.2);
    og.gain.setValueAtTime(0.12, now + dur - 0.1);
    og.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(bp).connect(og).connect(out);
    osc.start(now); osc.stop(now + dur + 0.05);
  }

  const api = {
    start,
    update,
    get active() { return state !== "idle"; },
    get state() { return state; },
    set onDone(fn) { onDone = fn; },
    set soundOn(fn) { soundOn = fn; },
  };
  el.boom = api; // acesso pelo console, para testes
  return api;
}
