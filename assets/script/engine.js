// =====================================================================
//  engine.js — motor V6 turbo (estilo F1) feito 100% em código
//  Pistões, bielas e virabrequim seguem a cinemática real
//  (pistão = r·cos φ + √(L² − r²·sen² φ)), e cada cilindro "explode"
//  no tempo de combustão (ciclo de 4 tempos = 720°).
//  A explosão é um shader próprio (GLSL) + luz pontual + escapamento que esquenta.
// =====================================================================
import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);

// ---------- shader da explosão (bola de fogo com ruído) ----------
const NOISE = /* glsl */ `
vec3 hash3(vec3 p){p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
  return -1.0+2.0*fract(sin(p)*43758.5453123);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
  return mix(mix(mix(dot(hash3(i),f),dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                 mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)),dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
             mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)),dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                 mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)),dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z);}`;

const fireVert = /* glsl */ `
uniform float uTime; uniform float uHeat;
varying vec3 vN; varying vec3 vView; varying float vNoise;
${NOISE}
void main(){
  float n = noise(position*4.0 + vec3(0.0,-uTime*7.0,uTime*3.0)) + 0.5*noise(position*9.0 - uTime*5.0);
  vNoise = n;
  vec3 p = position + normal * n * 0.45 * uHeat;
  vec4 mv = modelViewMatrix * vec4(p,1.0);
  vN = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const fireFrag = /* glsl */ `
uniform float uHeat; varying vec3 vN; varying vec3 vView; varying float vNoise;
void main(){
  float core = abs(dot(vN, vView));
  float t = clamp(uHeat*1.1 + vNoise*0.6, 0.0, 1.0);
  vec3 col = mix(vec3(0.85,0.08,0.02), vec3(1.0,0.5,0.05), smoothstep(0.1,0.55,t));
  col = mix(col, vec3(1.0,0.95,0.8), smoothstep(0.6,1.0,t*core));
  float a = uHeat * (0.25 + core) * (0.6 + 0.4*vNoise);
  gl_FragColor = vec4(col * (0.7 + 1.5*uHeat), clamp(a,0.0,1.0));
}`;

// material da bola de fogo — reaproveitado pelo motor do modelo baixado (motor-v6-anim.js)
export function makeFireMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHeat: { value: 0 } },
    vertexShader: fireVert, fragmentShader: fireFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

export function createEngine({ bank = 90, throws = 3 } = {}) {
  // medidas (unidades da cena)
  const r = 0.42;        // raio da manivela (metade do curso)
  const L = 1.35;        // comprimento da biela
  const bore = 0.8;      // diâmetro do cilindro
  const pitch = 1.1;     // distância entre moentes
  const off = 0.22;      // deslocamento esquerda/direita no mesmo moente
  const half = THREE.MathUtils.degToRad(bank / 2);
  const len = throws * pitch;

  const root = new THREE.Group();

  // ---------- materiais ----------
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9d2de, metalness: 1, roughness: 0.25 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x3a4255, metalness: 0.9, roughness: 0.4 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf0be55, metalness: 1, roughness: 0.3 });
  const shell = new THREE.MeshStandardMaterial({
    color: 0x35e7ff, metalness: 0, roughness: 0.6, transparent: true, opacity: 0.06,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x35e7ff, transparent: true, opacity: 0.4 });

  const withEdges = (mesh) => {
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), edgeMat));
    return mesh;
  };

  // ---------- virabrequim (gira em torno do eixo Z) ----------
  const crank = new THREE.Group();
  root.add(crank);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, len + 0.9, 24), steel);
  shaft.rotation.x = Math.PI / 2;
  crank.add(shaft);

  const throwsData = [];
  for (let k = 0; k < throws; k++) {
    const alpha = (k * 2 * Math.PI) / throws; // moentes a 120°
    const zc = (k - (throws - 1) / 2) * pitch;
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, off * 2 + 0.34, 20), steel);
    pin.rotation.x = Math.PI / 2;
    pin.position.set(r * Math.sin(alpha), r * Math.cos(alpha), zc);
    crank.add(pin);
    // braços + contrapesos
    for (const side of [-1, 1]) {
      const web = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, r + 0.34, 0.11), darkSteel);
      arm.position.y = r / 2;
      const cw = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.11, 28, 1, false, Math.PI / 2, Math.PI), darkSteel);
      cw.rotation.x = Math.PI / 2;
      web.add(arm, cw);
      web.position.z = zc + side * (off + 0.23);
      web.rotation.z = -alpha;
      crank.add(web);
    }
    throwsData.push({ alpha, zc });
  }
  // volante (atrás) e polia (na frente)
  const fly = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 48), gold);
  fly.rotation.x = Math.PI / 2;
  fly.position.z = len / 2 + 0.45;
  const fly2 = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 48), darkSteel);
  fly2.position.z = len / 2 + 0.45;
  const pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 32), darkSteel);
  pulley.rotation.x = Math.PI / 2;
  pulley.position.z = -len / 2 - 0.45;
  crank.add(fly, fly2, pulley);

  // ---------- cilindros ----------
  const heatLights = [new THREE.PointLight(0xff7a1a, 0, 4, 2), new THREE.PointLight(0xff7a1a, 0, 4, 2)];
  root.add(...heatLights);

  const cyl = [];
  throwsData.forEach(({ alpha, zc }, k) => {
    for (const s of [-1, 1]) {
      const beta = s * half;
      const d = new THREE.Vector3(Math.sin(beta), Math.cos(beta), 0);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, d);
      const z = zc + s * off;

      // pistão (com 2 anéis)
      const piston = new THREE.Mesh(new THREE.CylinderGeometry(bore / 2, bore / 2, 0.5, 32), steel);
      for (const y of [0.12, 0.2]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(bore / 2, 0.012, 6, 32), darkSteel);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        piston.add(ring);
      }
      piston.quaternion.copy(q);
      root.add(piston);

      // biela
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1, 12), gold);
      root.add(rod);

      // camisa do cilindro (vidro) — do ponto morto inferior até a câmara
      const bottom = L - r - 0.1, top = r + L + 0.62;
      const liner = withEdges(new THREE.Mesh(new THREE.CylinderGeometry(bore / 2 + 0.03, bore / 2 + 0.03, top - bottom, 32, 1, true), shell));
      liner.quaternion.copy(q);
      liner.position.copy(d).multiplyScalar((top + bottom) / 2).setZ(z);
      root.add(liner);

      // vela de ignição
      const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 10), gold);
      plug.quaternion.copy(q);
      plug.position.copy(d).multiplyScalar(r + L + 1.05).setZ(z);
      root.add(plug);

      // bola de fogo (shader)
      const fireMat = makeFireMaterial();
      const fire = new THREE.Mesh(new THREE.SphereGeometry(bore * 0.36, 32, 16), fireMat);
      fire.position.copy(d).multiplyScalar(r + L + 0.4).setZ(z);
      fire.visible = false;
      root.add(fire);

      // escapamento (esquenta a cada explosão)
      const out = new THREE.Vector3(Math.sign(s), 0, 0);
      const start = d.clone().multiplyScalar(r + L + 0.42).addScaledVector(out, 0.5).setZ(z);
      const curve = new THREE.CatmullRomCurve3([
        start,
        start.clone().addScaledVector(out, 0.45).add(new THREE.Vector3(0, -0.15, 0)),
        new THREE.Vector3(out.x * 1.75, 0.9, z + 0.2),
        new THREE.Vector3(out.x * 1.8, 0.4, len / 2 + 0.9),
      ]);
      const pipeMat = new THREE.MeshStandardMaterial({
        color: 0x3a4255, metalness: 0.9, roughness: 0.35, emissive: 0xff5a10, emissiveIntensity: 0,
      });
      const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.065, 10), pipeMat);
      root.add(pipe);

      // fase do ciclo de 4 tempos: metade dos cilindros dispara na volta seguinte
      const cycle = ((k + (s > 0 ? 1 : 0)) % 2) * Math.PI * 2;
      cyl.push({ alpha, beta, d, z, piston, rod, fire, fireMat, pipeMat, side: s, cycle, heat: 0, prev: 0 });
    }
  });

  // cabeçotes (um por bancada)
  for (const s of [-1, 1]) {
    const beta = s * half;
    const d = new THREE.Vector3(Math.sin(beta), Math.cos(beta), 0);
    const head = withEdges(new THREE.Mesh(new THREE.BoxGeometry(bore + 0.25, 0.5, len + 0.35), shell));
    head.quaternion.setFromUnitVectors(UP, d);
    head.position.copy(d).multiplyScalar(r + L + 0.82).setZ(s * off);
    root.add(head);
  }
  // cárter
  const sump = withEdges(new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, len + 0.5), shell));
  sump.position.y = -0.55;
  root.add(sump);

  // turbo no meio do "V"
  const turbo = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.14, 12, 32), darkSteel);
  const wheel = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.12), steel);
    fin.position.y = 0.16;
    const holder = new THREE.Group();
    holder.rotation.z = (i / 10) * Math.PI * 2;
    holder.add(fin);
    wheel.add(holder);
  }
  turbo.add(housing, wheel);
  turbo.position.set(0, r + L + 0.7, -len / 2 - 0.35);
  root.add(turbo);

  // ---------- estado ----------
  let theta = 0;
  let rpm = 6000, rpmNow = 0, running = true, xray = true, time = 0;
  const tmpPin = new THREE.Vector3(), tmpTop = new THREE.Vector3(), tmpDir = new THREE.Vector3();
  const TWO_PI = Math.PI * 2, CYCLE = Math.PI * 4;

  function setXray(on) {
    xray = on;
    shell.transparent = on;
    shell.opacity = on ? 0.06 : 1;
    shell.color.set(on ? 0x35e7ff : 0x2a3142);
    shell.roughness = on ? 0.6 : 0.35;
    shell.metalness = on ? 0 : 0.85;
    shell.depthWrite = !on;
    shell.needsUpdate = true;
    edgeMat.opacity = on ? 0.4 : 0.15;
  }

  function update(dt) {
    dt = Math.min(dt, 0.05);
    time += dt;
    rpmNow += ((running ? rpm : 0) - rpmNow) * Math.min(1, dt * 2.5);
    // velocidade "de vitrine": rápido o bastante para parecer vivo, lento o bastante para enxergar
    const revPerSec = rpmNow < 50 ? 0 : 0.15 + (rpmNow / 12000) * 2.4;
    theta += revPerSec * TWO_PI * dt;
    crank.rotation.z = -theta;
    wheel.rotation.z += revPerSec * 9 * dt;

    const lightHeat = [0, 0];
    for (const c of cyl) {
      const phi = theta + c.alpha - c.beta; // ângulo entre moente e eixo do cilindro
      const sinp = Math.sin(phi), cosp = Math.cos(phi);
      const s = r * cosp + Math.sqrt(L * L - r * r * sinp * sinp);
      // moente (no mundo)
      const a = theta + c.alpha;
      tmpPin.set(r * Math.sin(a), r * Math.cos(a), c.z);
      // pino do pistão
      tmpTop.copy(c.d).multiplyScalar(s).setZ(c.z);
      c.piston.position.copy(tmpTop).addScaledVector(c.d, 0.12);
      // biela entre os dois pontos
      tmpDir.subVectors(tmpTop, tmpPin);
      const rl = tmpDir.length();
      c.rod.position.addVectors(tmpTop, tmpPin).multiplyScalar(0.5);
      c.rod.quaternion.setFromUnitVectors(UP, tmpDir.normalize());
      c.rod.scale.set(1, rl, 1);

      // ignição: quando a fase de 720° "dá a volta", o cilindro dispara
      const phase = (((phi + c.cycle) % CYCLE) + CYCLE) % CYCLE;
      if (running && rpmNow > 300 && phase < c.prev) c.heat = 1;
      c.prev = phase;
      c.heat *= Math.exp(-dt * 7);

      c.fire.visible = c.heat > 0.02;
      c.fireMat.uniforms.uHeat.value = c.heat;
      c.fireMat.uniforms.uTime.value = time;
      c.fire.scale.setScalar(0.6 + c.heat * 0.6);
      c.pipeMat.emissiveIntensity = Math.max(c.pipeMat.emissiveIntensity * Math.exp(-dt * 2), c.heat * 0.9);

      const li = c.side < 0 ? 0 : 1;
      if (c.heat > lightHeat[li]) {
        lightHeat[li] = c.heat;
        heatLights[li].position.copy(c.fire.position);
      }
    }
    heatLights.forEach((l, i) => (l.intensity = lightHeat[i] * 3));
  }

  // ---------- painel de controle (HTML por cima do canvas) ----------
  function ui(container) {
    const box = document.createElement("div");
    box.className = "engine-ui";
    box.innerHTML = `
      <p class="panel-title">Controles</p>
      <button type="button" data-a="power">Desligar</button>
      <button type="button" data-a="xray">Raio-X: ligado</button>
      <label class="range">Rotação <output>${rpm} rpm</output>
        <input type="range" min="2000" max="12000" step="100" value="${rpm}" aria-label="Rotação">
        <span class="ends"><span>2.000</span><span>12.000</span></span>
      </label>`;
    // não deixa o arraste dos controles girar a câmera
    box.addEventListener("pointerdown", (e) => e.stopPropagation());
    const range = box.querySelector("input"), out = box.querySelector("output");
    range.addEventListener("input", () => { rpm = +range.value; out.textContent = `${rpm} rpm`; });
    box.querySelector('[data-a="power"]').addEventListener("click", (e) => {
      running = !running;
      e.currentTarget.textContent = running ? "Desligar" : "Ligar";
    });
    box.querySelector('[data-a="xray"]').addEventListener("click", (e) => {
      setXray(!xray);
      e.currentTarget.textContent = `Raio-X: ${xray ? "ligado" : "desligado"}`;
    });
    container.append(box);
  }

  setXray(true);
  return { object: root, update, ui };
}
