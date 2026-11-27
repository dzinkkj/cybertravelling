// =====================================================================
//  viewer3d.js — modelos 3D interativos com three.js
//  Como usar: no HTML, coloque
//    <div class="viewer" data-model="assets/models/f1.glb" data-label="F1"></div>
//  Opcionais:  data-zoom="true"    libera o zoom pela rodinha do mouse
//              data-rotate="0"     desliga o giro automático da câmera
//              data-spin="0.3"     o objeto gira no próprio eixo (radianos por segundo)
//              data-angle="30"     ângulo inicial da câmera (graus, de lado)
//              data-bloom="true"   brilho em volta das luzes (bom com fogo/neon)
//  Especial:   data-model="engine:v6"  → motor V6 animado feito em código (engine.js)
//  Se o arquivo .glb não existir, aparece uma forma provisória no lugar.
//  Se o .glb tiver animações próprias, elas tocam em loop.
// =====================================================================
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder); // os modelos comprimidos (muralha, avião, trem) precisam disso
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- versão leve × versão original ----------
// index.html            → modelos leves (assets/models/)
// index.html?original   → modelos originais (assets/models/original/), com medidor de FPS
export const ORIGINAL = (document.documentElement.dataset.versao === "original" || new URLSearchParams(location.search).has("original"));
const ORIGINAL_BASE = document.documentElement.dataset.modelsOriginal || "assets/models/original/";
const toOriginal = (url) => url.replace(/^assets\/models\//, ORIGINAL_BASE);
// cenários 360° (HDRI): data-hdri="shanghai_bund"
//   leve     → assets/hdri/shanghai_bund_2k.jpg            (foto 360° comprimida)
//   original → assets/hdri/original/shanghai_bund_4k.exr   (o arquivo do Poly Haven, sem mexer)
const HDRI_BASE = document.documentElement.dataset.hdri || "assets/hdri/";
const HDRI_ORIGINAL_BASE = document.documentElement.dataset.hdriOriginal || "assets/hdri/original/";

const CY = 0x35e7ff, MG = 0xff4d9a, GD = 0xf0be55, BG = 0x0b0f1c;

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

function placeholder(accent) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0x1b2440, metalness: 0.4, roughness: 0.35, flatShading: true }));
  const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.02, 1),
    new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.55 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.015, 8, 96), new THREE.MeshBasicMaterial({ color: GD }));
  ring.rotation.x = Math.PI / 2.3;
  g.add(core, wire, ring);
  return g;
}

async function loadHdriTexture(name) {
  if (ORIGINAL) {
    try {
      const { EXRLoader } = await import("three/addons/loaders/EXRLoader.js");
      const tex = await new EXRLoader().loadAsync(HDRI_ORIGINAL_BASE + name + "_4k.exr");
      tex.mapping = THREE.EquirectangularReflectionMapping;
      return tex;
    } catch { /* sem o original: cai para a versão leve */ }
  }
  const tex = await new THREE.TextureLoader().loadAsync(HDRI_BASE + name + "_2k.jpg");
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

// centraliza o modelo e posiciona a câmera para ele caber
function fit(object, camera, controls, angleDeg, fitScale) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
  // considera a tela deitada ou em pé (no celular em pé o limite é a largura)
  const vf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hf = Math.atan(Math.tan(vf) * (camera.aspect || 1));
  const dist = (radius / Math.sin(Math.min(vf, hf))) * 0.82 * (fitScale || 1);
  const a = THREE.MathUtils.degToRad(angleDeg);
  camera.position.set(Math.sin(a) * dist, radius * 0.45, Math.cos(a) * dist);
  camera.near = dist / 100;
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = dist * 0.35;
  controls.maxDistance = dist * 2.5;
  controls.update();
}

class Viewer {
  constructor(el) {
    this.el = el;
    this.lightUrl = el.dataset.model || "";
    this.url = ORIGINAL && this.lightUrl.endsWith(".glb") ? toOriginal(this.lightUrl) : this.lightUrl;
    this.frames = 0; this.fpsT = 0;
    this.angle = Number(el.dataset.angle ?? 35);
    this.bloom = el.dataset.bloom === "true";
    this.accent = el.closest(".e2") ? MG : CY;
    this.object = null;     // modelo carregado (fica guardado entre entradas/saídas da tela)
    this.renderer = null;   // só existe enquanto o bloco está na tela
    this.mixer = null;      // animações do .glb
    this.custom = null;     // objeto animado por código (motor)
    this.running = false;
    this.clock = new THREE.Clock();

    el.insertAdjacentHTML("beforeend",
      `<span class="tag"></span><span class="hint">drag to rotate</span><span class="msg" hidden></span><span class="load"></span>`);
    el.querySelector(".tag").textContent = el.dataset.label || "3D model";
    this.msg = el.querySelector(".msg");
    this.bar = el.querySelector(".load");

    this.scene = new THREE.Scene();
    if (this.bloom) this.scene.background = new THREE.Color(BG); // o brilho precisa de fundo sólido
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
    this.hemi = new THREE.HemisphereLight(0xdfeaff, 0x0b0f1c, 0.8);
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(4, 6, 5);
    this.rim = new THREE.DirectionalLight(this.accent, 1.4);
    this.rim.position.set(-5, 2, -4);
    this.scene.add(this.hemi, key, this.rim);
    this.hdri = el.dataset.hdri || null;
    this.hdriTex = null;
  }

  async start() {
    if (this.renderer) { this.running = true; this.loop(); return; }
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: !this.bloom });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = Number(this.el.dataset.exposure || 1); // data-exposure="0.7" escurece
    this.el.prepend(r.domElement);
    this.renderer = r;

    // reflexos de "estúdio" (deixa metal com cara de metal)
    // reflexos: do cenário 360° (se tiver) ou de um "estúdio" genérico
    this.setEnvironment();
    if (this.hdri && !this.hdriTex) this.loadHdri();

    const c = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true;
    c.enablePan = false;
    c.enableZoom = this.el.dataset.zoom === "true";
    c.autoRotate = !reduceMotion && this.el.dataset.rotate !== "0";
    c.autoRotateSpeed = 1.2;
    let idle;
    c.addEventListener("start", () => { c.autoRotate = false; clearTimeout(idle); });
    c.addEventListener("end", () => {
      if (reduceMotion || this.el.dataset.rotate === "0") return;
      idle = setTimeout(() => (c.autoRotate = true), 3000);
    });
    this.controls = c;

    if (this.bloom) await this.setupBloom();
    if (!this.renderer) return; // saiu da tela enquanto carregava

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.resize();

    if (this.object) fit(this.object, this.camera, c, this.angle, Number(this.el.dataset.fit || 1));
    else this.load();

    this.running = true;
    this.clock.getDelta();
    this.loop();
  }

  setEnvironment() {
    if (!this.renderer) return;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex?.dispose();
    if (this.hdriTex) {
      this.envTex = pmrem.fromEquirectangular(this.hdriTex).texture;
      this.scene.environmentIntensity = 1;
      this.scene.background = this.hdriTex;
      this.scene.backgroundBlurriness = Number(this.el.dataset.blur ?? 0.03);
      this.scene.backgroundIntensity = Number(this.el.dataset.bgIntensity ?? 1);
      this.hemi.intensity = 0.25; // a luz agora vem do cenário
      this.rim.intensity = 0.3;
      this.el.classList.add("has-hdri");
    } else {
      this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.7;
    }
    this.scene.environment = this.envTex;
    pmrem.dispose();
  }

  async loadHdri() {
    try {
      this.hdriTex = await loadHdriTexture(this.hdri);
      this.setEnvironment();
    } catch { /* cenário não encontrado: fica o fundo escuro */ }
  }

  async setupBloom() {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/UnrealBloomPass.js"),
      import("three/addons/postprocessing/OutputPass.js"),
    ]);
    if (!this.renderer) return; // saiu da tela enquanto carregava
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(await this.makeScenePass(RenderPass));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.3, 0.95);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    for (const make of this.extraPasses || []) make(this.composer);
  }

  // Desenho da cena. Se o modelo pedir "subquadros" (motor girando rápido), a cena é desenhada
  // várias vezes dentro do mesmo quadro, com a animação avançando um pouco em cada uma, e as
  // imagens são somadas: é o borrão de movimento de verdade (como o obturador de uma câmera).
  async makeScenePass(RenderPass) {
    const { Pass, FullScreenQuad } = await import("three/addons/postprocessing/Pass.js");
    const view = this;
    const plain = new RenderPass(this.scene, this.camera);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, w: { value: 1 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: "uniform sampler2D map; uniform float w; varying vec2 vUv; void main(){ gl_FragColor = texture2D(map, vUv) * w; }",
      depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    class AccumPass extends Pass {
      constructor() {
        super();
        this.needsSwap = false;
        this.quad = new FullScreenQuad(mat);
        this.tmp = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
      }
      setSize(w, h) { this.tmp.setSize(w, h); plain.setSize?.(w, h); }
      render(renderer, writeBuffer, readBuffer, dt, mask) {
        const n = view.subN || 1;
        if (n <= 1) return plain.render(renderer, writeBuffer, readBuffer, dt, mask);
        const step = view.subStep;
        const oldAuto = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setRenderTarget(readBuffer);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        mat.uniforms.map.value = this.tmp.texture;
        mat.uniforms.w.value = 1 / n;
        for (let i = 0; i < n; i++) {
          if (i > 0) view.custom.update(step); // o 1º passo já foi dado no loop
          renderer.setRenderTarget(this.tmp);
          renderer.clear();
          renderer.render(view.scene, view.camera);
          renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
          this.quad.render(renderer);
        }
        renderer.autoClear = oldAuto;
      }
      dispose() { this.tmp.dispose(); this.quad.dispose(); }
    }
    return new AccumPass();
  }

  // um modelo pode pedir efeitos extras (ex.: rastro de movimento); refeitos sempre que o 3D volta à tela
  addPass(make) {
    (this.extraPasses ||= []).push(make);
    if (this.composer) make(this.composer);
  }

  async load() {
    const done = (obj, missing) => {
      // data-spin="0.25": o objeto gira no próprio eixo (voltas por… ver loop), mesmo com o giro da câmera
      if (this.el.dataset.spin) {
        const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
        obj.position.sub(c);
        const pivot = new THREE.Group();
        pivot.add(obj);
        this.spinner = pivot;
        obj = pivot;
        // luz presa à câmera: o lado virado para quem olha fica sempre iluminado
        // (o globo traz o próprio sol, em globo-anim.js)
        const sun = new THREE.DirectionalLight(0xffffff, this.custom ? 0 : 2.4);
        sun.position.set(-2, 1.5, 3);
        this.camera.add(sun);
        this.scene.add(this.camera);
      }
      this.object = obj;
      this.scene.add(obj);
      fit(obj, this.camera, this.controls, this.angle, Number(this.el.dataset.fit || 1));
      this.bar.style.width = "0";
      if (missing) {
        this.msg.hidden = false;
        this.msg.textContent = `put ${this.url || "a .glb"} here`;
      }
    };

    // modelo feito em código
    if (this.url.startsWith("engine:")) {
      const { createEngine } = await import("./engine.js");
      this.custom = createEngine();
      this.mountUI();
      this.el.querySelector(".hint").textContent = "drag to rotate · scroll = zoom";
      return done(this.custom.object, false);
    }
    if (!this.url) return done(placeholder(this.accent), true);

    const ok = async (gltf) => {
      // animação feita em código para um modelo específico (data-anim="motor-v6")
      if (this.el.dataset.anim === "motor-v6") {
        try {
          const { setupMotorV6 } = await import("./motor-v6-anim.js");
          this.custom = setupMotorV6(gltf.scene, this);
          this.mountUI();
          if (this.custom) { console.info("motor-v6:", this.custom.info); window.__motorV6 = this.custom; window.__motorV6View = this; }
        } catch (err) { console.error("motor-v6:", err); }
      }
      if (this.el.dataset.anim === "globo") {
        try {
          const { setupGlobe } = await import("./globo-anim.js");
          this.custom = setupGlobe(gltf.scene, this);
        } catch (err) { console.error("globo:", err); }
      }
      if (gltf.animations.length) {
        this.mixer = new THREE.AnimationMixer(gltf.scene);
        gltf.animations.forEach((clip) => this.mixer.clipAction(clip).play());
      }
      done(gltf.scene, false);
    };
    // plano B: o mesmo modelo guardado como texto (base64) em "nome.glb.b64.txt".
    // Só serve para a prévia publicada, que não aceita arquivos .glb. No seu PC, use o .glb normal.
    const tryText = async () => {
      try {
        const res = await fetch(this.url + ".b64.txt");
        if (!res.ok) throw new Error();
        const bin = Uint8Array.from(atob((await res.text()).trim()), (c) => c.charCodeAt(0));
        loader.parse(bin.buffer, "", ok, () => done(placeholder(this.accent), true));
      } catch { done(placeholder(this.accent), true); }
    };
    // mostra tamanho e tempo de carregamento (útil para comparar as duas versões)
    const t0 = performance.now();
    let bytes = 0;
    const okStats = (gltf) => {
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const mb = (bytes / 1048576).toFixed(1);
      this.el.querySelector(".tag").textContent =
        `${this.el.dataset.label || "3D model"} · ${mb} MB in ${secs} s${this.url !== this.lightUrl ? " · original" : ""}`;
      ok(gltf);
    };
    const load = (url, onFail) => loader.load(
      url,
      okStats,
      (e) => { bytes = e.loaded; if (e.total) this.bar.style.width = (e.loaded / e.total) * 100 + "%"; },
      onFail
    );
    // original → (se não achar) leve → (se não achar) texto base64 → forma provisória
    if (this.url !== this.lightUrl) load(this.url, () => { this.url = this.lightUrl; load(this.lightUrl, tryText); });
    else load(this.url, tryText);
  }

  // painel de controles fora do quadro 3D, à esquerda (no celular, em cima)
  mountUI() {
    if (!this.custom?.ui || this.panel) return;
    const wrap = document.createElement("div");
    wrap.className = "viewer-wrap";
    this.el.parentNode.insertBefore(wrap, this.el);
    this.panel = document.createElement("aside");
    this.panel.className = "viewer-panel";
    wrap.append(this.panel, this.el);
    this.custom.ui(this.panel);
  }

  resize() {
    if (!this.renderer) return;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  loop() {
    if (!this.running || this.raf) return;
    const tick = () => {
      this.raf = null;
      if (!this.running || !this.renderer) return;
      const dt = this.clock.getDelta();
      if (ORIGINAL) {
        this.frames++; this.fpsT += dt;
        if (this.fpsT >= 1) {
          this.el.querySelector(".hint").textContent = `${Math.round(this.frames / this.fpsT)} FPS`;
          this.frames = 0; this.fpsT = 0;
        }
      }
      this.mixer?.update(dt);
      // quantos subquadros neste quadro (o motor decide pela rotação e pelo desempenho do PC)
      // subquadros: só a última fatia do quadro ("obturador") é dividida e somada.
      // Obturador curto = borrão curto; o modelo decide o tamanho (ex.: menor com o motor aberto).
      this.subN = this.composer && this.custom?.subframes ? this.custom.subframes(dt) : 1;
      const fdt = Math.min(dt, 0.05);
      if (this.subN > 1) {
        const shutter = this.custom.shutter ? this.custom.shutter(fdt) : 1;
        this.subStep = (fdt * shutter) / this.subN;
        this.custom.update(fdt - this.subStep * (this.subN - 1));
      } else this.custom?.update(dt);
      if (this.spinner) this.spinner.rotation.y += dt * Number(this.el.dataset.spin);
      this.controls.update();
      if (this.composer) this.composer.render(dt);
      else this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  // libera o WebGL quando sai da tela (o navegador aguenta ~16 ao mesmo tempo)
  stop() {
    this.running = false;
    if (!this.renderer) return;
    cancelAnimationFrame(this.raf); this.raf = null;
    this.ro?.disconnect();
    this.controls.dispose();
    this.composer?.dispose(); this.composer = null;
    this.envTex?.dispose(); this.scene.environment = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.renderer = null;
  }
}

{
  const els = document.querySelectorAll(".viewer");
  if (!webglOk()) {
    els.forEach((el) => (el.innerHTML = '<span class="msg">Your browser can’t show 3D (WebGL is off).</span>'));
  } else {
    const viewers = new Map();
    els.forEach((el) => viewers.set(el, new Viewer(el)));
    const viewerIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const v = viewers.get(e.target);
        e.isIntersecting ? v.start() : v.stop();
      }
    }, { rootMargin: "150px 0px" });
    els.forEach((el) => viewerIO.observe(el));
  }
}
