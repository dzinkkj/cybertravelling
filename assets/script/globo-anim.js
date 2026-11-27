// Globo (seção da Michio Ayumu): sombras de dia e noite, oceano que brilha com o sol,
// atmosfera azul em volta e um céu estrelado de fundo (assets/hdri/espaco_2k.jpg, gerado para o site).
import * as THREE from "three";

const ESPACO = (document.documentElement.dataset.hdri || "assets/hdri/") + "espaco_2k.jpg";

export function setupGlobe(root, viewer) {
  // 1. superfície: o modelo vinha "aceso" por inteiro (emissivo), por isso parecia chapado.
  //    Agora só o sol ilumina, e o oceano (onde o azul domina) fica liso e reflete o sol.
  let earth = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    earth = earth || o;
    const m = o.material;
    m.emissive?.setScalar(0);
    m.emissiveMap = null;
    m.normalMap = null; // o mapa de relevo deste modelo vem com a orientação errada (sombra torta)
    m.side = THREE.FrontSide;
    m.metalness = 0;
    m.envMapIntensity = 0.14; // quase sem luz ambiente: o lado da noite fica escuro de verdade
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         float ocean = smoothstep(0.02, 0.16, diffuseColor.b - max(diffuseColor.r, diffuseColor.g));
         roughnessFactor = mix(0.95, 0.32, ocean);`
      );
    };
    m.needsUpdate = true;
  });
  if (!earth) return null;

  // centro e raio do planeta, no espaço do modelo
  root.updateMatrixWorld(true);
  // raio pelo próprio desenho do planeta: a distância média dos vértices ao centro
  // (a caixa em volta do modelo exagera, porque o modelo vem rodado)
  const pos = earth.geometry.attributes.position, v = new THREE.Vector3();
  const pts = [];
  for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 4000))) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(earth.matrixWorld).clone());
  const center = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
  const R = pts.reduce((a, p) => a + p.distanceTo(center), 0) / pts.length;
  const sphere = { center, radius: R };
  console.info("globo: raio", R.toFixed(3), "vértices", pos.count);

  // 2. o sol: uma luz presa à câmera, vinda do alto à esquerda — o lado da frente fica de dia
  //    e a borda direita entra na noite (a linha do terminador aparece girando).
  const sunDirView = new THREE.Vector3(-0.75, 0.35, 1.2).normalize();
  const sun = new THREE.DirectionalLight(0xfff4e6, 4.6);
  sun.position.copy(sunDirView).multiplyScalar(10);
  viewer.camera.add(sun);
  viewer.camera.add(sun.target); // alvo junto da câmera: a direção do sol fica fixa na tela
  sun.target.position.set(0, 0, 0);
  viewer.scene.add(viewer.camera);
  viewer.scene.traverse((o) => { if (o.isHemisphereLight || (o.isDirectionalLight && o !== sun)) o.intensity *= 0.15; });

  // 3. atmosfera: um brilho fino na borda do planeta e um halo por fora, mais forte do lado do sol
  const atmoUniforms = { sunView: { value: sunDirView }, color: { value: new THREE.Color(0x4fb4ff) } };
  const vert = `varying vec3 vN; varying vec3 vV;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.012, 96, 64),
    new THREE.ShaderMaterial({
      uniforms: atmoUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: vert,
      fragmentShader: `uniform vec3 sunView; uniform vec3 color; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
          float lit = smoothstep(-0.4, 0.7, dot(normalize(vN.xy + 1e-5), normalize(sunView.xy)));
          gl_FragColor = vec4(color * f * (0.1 + 0.75 * lit), 1.0); }`,
    })
  );
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.13, 96, 64),
    new THREE.ShaderMaterial({
      uniforms: atmoUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
      vertexShader: vert,
      fragmentShader: `uniform vec3 sunView; uniform vec3 color; varying vec3 vN; varying vec3 vV;
        void main(){
          // 0 na borda de fora do halo, 1 encostado no planeta (0.47 = onde a vista tangencia o planeta)
          float t = clamp(-dot(vN, vV) / 0.47, 0.0, 1.0);
          float lit = smoothstep(-0.4, 0.7, dot(normalize(vN.xy + 1e-5), normalize(sunView.xy)));
          gl_FragColor = vec4(color * pow(t, 3.0) * (0.25 + 1.0 * lit), 1.0); }`,
    })
  );
  rim.position.copy(sphere.center);
  halo.position.copy(sphere.center);
  root.add(rim, halo);

  // 4. céu estrelado de fundo (só fundo: não muda a luz do planeta)
  new THREE.TextureLoader().load(ESPACO, (t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    viewer.scene.background = t;
    viewer.scene.backgroundIntensity = 1.4;
    viewer.scene.backgroundBlurriness = 0;
    viewer.el.classList.add("has-hdri");
  });

  return { update() {}, info: { radius: R } };
}
