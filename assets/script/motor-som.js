// Som do motor (Red Bull RB16B, sons de um mod do Assetto Corsa).
// Vários trechos gravados em giros diferentes tocam em repetição; conforme o rpm muda,
// o site mistura os dois trechos mais próximos e acelera/desacelera cada um para acertar o tom.
//
// Versão leve:     assets/audio/<nome>.wav          (mono, ~2,5 s por trecho)
// Versão original: assets/audio/original/<nome>.ogg (os arquivos do mod, inteiros)   → ?original

const BASE = document.documentElement.dataset.audio || "assets/audio/";
const ORIGINAL = (document.documentElement.dataset.versao === "original" || new URLSearchParams(location.search).has("original"));

// trechos com o pé embaixo (on) e com o pé fora (off), e o giro em que cada um foi gravado
// acelerando não usa a marcha lenta: o trecho de 6 800 rpm (com carga) tocado mais grave já "berra" desde os 4 000
const ON = [["on_6800", 6800], ["on_8400", 8400], ["on_9500", 9500], ["on_11350", 11350], ["on_13650", 13650]];
const OFF = [["idle", 3800], ["off_8060", 8060], ["off_10580", 10580]];
const POPS = ["pop1", "pop2", "pop3", "pop4", "pop5", "pop7", "pop8", "pop9"];

async function fetchBuf(ctx, name) {
  const tries = [];
  if (ORIGINAL) tries.push(() => fetch(BASE + "original/" + name + ".ogg").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())));
  tries.push(() => fetch(BASE + name + ".wav").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())));
  // plano B (prévia do Claude): o mesmo .wav guardado como texto base64
  tries.push(() => fetch(BASE + name + ".wav.b64.txt").then((r) => (r.ok ? r.text() : Promise.reject())).then((t) => {
    const bin = atob(t.trim()), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }));
  for (const t of tries) {
    try { return await ctx.decodeAudioData(await t()); } catch {}
  }
  return null;
}

export async function createEngineSound() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  const engineBus = ctx.createGain(); // corta durante o limitador
  engineBus.connect(master);

  const names = [...new Set([...ON, ...OFF].map((l) => l[0]))];
  const bufs = {};
  await Promise.all([...names, ...POPS].map(async (n) => (bufs[n] = await fetchBuf(ctx, n))));

  // cada trecho vira uma "voz" tocando em repetição, com volume e velocidade próprios
  const voices = {};
  const makeVoice = (key, name, ref) => {
    if (!bufs[name]) return;
    const src = ctx.createBufferSource();
    src.buffer = bufs[name];
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(engineBus);
    src.start(0, Math.random() * bufs[name].duration);
    voices[key] = { src, g, ref };
  };
  ON.forEach(([n, r]) => makeVoice("on:" + n, n, r));
  OFF.forEach(([n, r]) => makeVoice("off:" + n, n, r));

  let enabled = true, load = 0;
  const T = 0.04; // suavização (segundos)

  function weights(list, rpm) {
    const w = {};
    if (rpm <= list[0][1]) { w[list[0][0]] = 1; return w; }
    for (let i = 0; i < list.length - 1; i++) {
      const [a, ra] = list[i], [b, rb] = list[i + 1];
      if (rpm <= rb) { const t = (rpm - ra) / (rb - ra); w[a] = Math.cos(t * Math.PI / 2); w[b] = Math.sin(t * Math.PI / 2); return w; }
    }
    w[list[list.length - 1][0]] = 1;
    return w;
  }

  return {
    ctx,
    get enabled() { return enabled; },
    setEnabled(v) {
      enabled = v;
      master.gain.setTargetAtTime(v ? 0.55 : 0, ctx.currentTime, 0.05);
      if (v && ctx.state !== "running") ctx.resume();
    },
    start() { if (ctx.state !== "running") ctx.resume(); if (enabled) master.gain.setTargetAtTime(0.55, ctx.currentTime, 0.1); },
    pause() { master.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => ctx.state === "running" && !enabled && ctx.suspend(), 300); },
    suspend() { if (ctx.state === "running") ctx.suspend(); },
    resume() { if (enabled && ctx.state !== "running") ctx.resume(); },
    // chamado a cada quadro com o giro atual e se o pé está no acelerador
    update(rpm, throttle, dt) {
      if (ctx.state !== "running") return;
      load += ((throttle ? 1 : 0) - load) * Math.min(1, dt * (throttle ? 22 : 9)); // pisou: entra na hora
      const now = ctx.currentTime;
      const loud = (0.6 + 0.4 * Math.min(1, (rpm - 3800) / 6000)) * (0.8 + 0.35 * load); // sobe rápido e fica mais alto com o pé embaixo
      const won = weights(ON, rpm), woff = weights(OFF, rpm);
      for (const [key, v] of Object.entries(voices)) {
        const [kind, name] = key.split(":");
        const w = kind === "on" ? (won[name] || 0) * load : (woff[name] || 0) * (1 - load) * 0.7;
        v.g.gain.setTargetAtTime(w * loud, now, T);
        v.src.playbackRate.setTargetAtTime(Math.min(2, Math.max(0.5, rpm / v.ref)), now, T);
      }
    },
    // corte de ignição do limitador: o ronco some por um instante
    cut() {
      if (ctx.state !== "running") return;
      const now = ctx.currentTime;
      engineBus.gain.cancelScheduledValues(now);
      engineBus.gain.setValueAtTime(engineBus.gain.value, now);
      engineBus.gain.linearRampToValueAtTime(0.25, now + 0.012);
      engineBus.gain.linearRampToValueAtTime(1, now + 0.06);
    },
    pop(power = 1) {
      if (ctx.state !== "running" || !enabled) return;
      const name = POPS[Math.floor(Math.random() * POPS.length)];
      if (!bufs[name]) return;
      const src = ctx.createBufferSource();
      src.buffer = bufs[name];
      src.playbackRate.value = 0.9 + Math.random() * 0.25;
      const g = ctx.createGain();
      g.gain.value = 0.55 + 0.45 * power;
      src.connect(g).connect(master);
      src.start();
    },
  };
}
