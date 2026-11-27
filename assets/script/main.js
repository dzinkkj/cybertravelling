// main.js — gavetas, barra de progresso, entrada ao rolar e vídeos
{
  // ---------- gavetas: sumário (esquerda) e equipe (direita) ----------
  const overlay = document.getElementById("overlay");
  const drawers = document.querySelectorAll(".drawer");
  const closeAll = () => {
    drawers.forEach((d) => d.classList.remove("open"));
    overlay.classList.remove("show");
  };
  document.querySelectorAll("[data-open]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const d = document.getElementById(btn.dataset.open);
      const wasOpen = d.classList.contains("open");
      closeAll();
      if (!wasOpen) { d.classList.add("open"); overlay.classList.add("show"); }
    })
  );
  overlay.addEventListener("click", closeAll);
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeAll());
  document.querySelectorAll(".drawer a").forEach((a) => a.addEventListener("click", closeAll));

  // ---------- barra de progresso no topo ----------
  const bar = document.getElementById("progress");
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + "%";
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---------- blocos entram ao rolar ----------
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("show"); revealIO.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el) => revealIO.observe(el));

  // ---------- vídeos: placeholder até carregar; só tocam quando visíveis ----------
  const videoIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const v = e.target;
      if (e.isIntersecting) v.play().catch(() => {});
      else v.pause();
    });
  }, { threshold: 0.25 });

  // de onde vêm os vídeos: a pasta definida em <html data-media="..."> (pode ser outro site)
  // também aceita ?media=https://... no endereço (útil para mandar por QR Code sem mexer no código)
  const qMedia = new URLSearchParams(location.search).get("media");
  const MEDIA = (qMedia && /^https:\/\//.test(qMedia) ? qMedia.replace(/\/?$/, "/") : null)
    || document.documentElement.dataset.media || "assets/media/";
  const mediaUrl = (f) => (/^(https?:)?\/\//.test(f) ? f : MEDIA + f);
  document.querySelectorAll("video[data-src]").forEach((v) => {
    if (v.dataset.fallback) v.poster = mediaUrl(v.dataset.fallback); // photo shows while the video loads
    v.muted = true;
    v.src = mediaUrl(v.dataset.src);
  });

  // fotos (no lugar dos modelos que não foram encontrados): mesmo endereço dos vídeos
  document.querySelectorAll(".photo img[data-src]").forEach((img) => {
    const fig = img.closest(".photo");
    fig.dataset.file = img.dataset.src;
    fig.classList.add("missing");
    img.addEventListener("load", () => fig.classList.remove("missing"));
    img.addEventListener("error", () => fig.classList.add("missing"));
    img.src = mediaUrl(img.dataset.src);
  });

  // photo strips, logos: same address as the videos; hide a shot if its file is missing
  document.querySelectorAll(".shot img[data-src], .michio-logo img[data-src], img.logo-img[data-src]").forEach((img) => {
    img.addEventListener("load", () => img.closest(".brand")?.classList.add("has-logo"));
    img.addEventListener("error", () => { const f = img.closest(".shot"); if (f) f.hidden = true; });
    img.src = mediaUrl(img.dataset.src);
  });

  // a video that doesn't exist yet shows a photo from the presentation in its place
  const useFallback = (fig, v) => {
    if (!v.dataset.fallback || fig.querySelector("img.fb")) return;
    const img = new Image();
    img.className = "fb";
    img.alt = "";
    img.addEventListener("load", () => { fig.classList.remove("missing"); fig.classList.add("has-fb"); });
    img.src = mediaUrl(v.dataset.fallback);
    fig.append(img);
  };

  document.querySelectorAll(".media").forEach((fig) => {
    const v = fig.querySelector("video");
    if (!v) return;
    fig.dataset.file = v.dataset.src || "no file";
    fig.classList.add("missing");
    v.muted = true; // autoplay só funciona sem som
    v.addEventListener("loadeddata", () => fig.classList.remove("missing"));
    v.addEventListener("error", () => { fig.classList.add("missing"); useFallback(fig, v); });
    videoIO.observe(v);
  });

  // ---------- tabelas no celular: cada célula ganha o nome da coluna ----------
  document.querySelectorAll("table.stack").forEach((t) => {
    const heads = [...t.rows[0].cells].map((c) => c.textContent);
    [...t.tBodies[0].rows].forEach((r) => [...r.cells].forEach((c, i) => (c.dataset.l = heads[i] || "")));
  });

  // ---------- etapas no cabeçalho: marca onde o visitante está ----------
  const route = document.getElementById("route");
  const links = [...route.querySelectorAll("a")];
  let lastOn = null;
  const markRoute = () => {
    const hh = document.getElementById("topbar").offsetHeight;
    let on = null;
    for (const a of links) {
      if (a.hidden) continue;
      const sec = document.querySelector(a.getAttribute("href"));
      if (!sec || sec.closest("[hidden]")) continue;
      if (sec.getBoundingClientRect().top <= hh + 120) on = a;
    }
    if (on === lastOn) return;
    lastOn = on;
    links.forEach((a) => a.classList.toggle("on", a === on));
    if (on) route.scrollTo({ left: on.offsetLeft - route.clientWidth / 2 + on.offsetWidth / 2, behavior: "smooth" });
  };
  addEventListener("scroll", markRoute, { passive: true });
  markRoute();

  // ---------- light × original version ----------
  // the "site-original" folder marks <html data-versao="original">; "site-leve" marks "leve"
  const isOriginal = document.documentElement.dataset.versao === "original" || new URLSearchParams(location.search).has("original");
  const sw = document.getElementById("mode-switch");
  if (isOriginal) {
    document.getElementById("mode-badge").hidden = false;
    if (sw) { sw.href = location.pathname; sw.textContent = "back to the light version"; }
  }
  if (sw && document.documentElement.dataset.versao) sw.hidden = true; // two-folder build: each folder is one version

  // ---------- countdowns (departure / early-bird deadline) ----------
  const counters = [...document.querySelectorAll("[data-count]")];
  const tick = () => {
    const now = Date.now();
    counters.forEach((el) => {
      const ms = new Date(el.dataset.count).getTime() - now;
      if (ms <= 0) { el.textContent = "ended"; el.classList.add("ended"); return; }
      const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
      el.textContent = `${d} days · ${h} h · ${m} min to go`;
    });
  };
  tick();
  setInterval(tick, 30000);

  // ---------- demo forms (contact / careers): nothing is sent or stored ----------
  document.querySelectorAll(".demo-form").forEach((form) =>
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      form.reset();
      (window.showToast || alert)(form.dataset.ok || "Simulated — nothing was sent.");
    })
  );
}
