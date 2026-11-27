// store.js — demo cart + Premium reveal + early-bird promotion
// Nothing here makes a real payment: "Pay" only simulates it.
{
  // prices are in US dollars, converted from the BRL sale price at US$ 1 = R$ 5.744
  // (Brazil commercial close, Nov 26, 2026)
  const EARLY_END = new Date("2026-12-19T23:59:59-03:00"); // early-bird deadline (Brasília time)
  const EARLY_OFF = 0.10;
  const INSTALLMENTS = 36;

  const fmt = (v, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (v) => (Number.isFinite(v) ? `US$ ${fmt(v, Math.round(v * 100) % 100 ? 2 : 0)}` : "US$ —");
  const earlyOn = () => new Date() <= EARLY_END;
  const finalPrice = (p) => (earlyOn() ? Math.round(p * (1 - EARLY_OFF)) : p);

  const cart = []; // { plan, name, price }
  const $ = (id) => document.getElementById(id);
  const count = $("cart-count"), items = $("cart-items"), total = $("cart-total");
  const empty = $("cart-empty"), full = $("cart-full"), done = $("cart-done");
  const drawer = $("cart-drawer"), overlay = $("overlay");
  const toast = $("toast");

  // ---------- prices on the package cards ----------
  document.querySelectorAll(".price-box").forEach((box) => {
    const p = +box.dataset.price;
    const f = finalPrice(p);
    box.innerHTML = (earlyOn() ? `<p class="was">${money(p)}</p>` : "")
      + `<p class="price">${money(f)}<small>per person${earlyOn() ? " · early bird −10%" : ""}</small></p>`
      + `<p class="inst">or ${INSTALLMENTS}× ${money(Math.round(f / INSTALLMENTS * 100) / 100)} · no installment in January</p>`;
  });
  const status = $("promo-status");
  if (status) status.textContent = earlyOn() ? "early bird active" : "early bird ended";
  if (!earlyOn()) document.querySelectorAll(".promo.hot").forEach((el) => el.classList.add("ended"));

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => (toast.hidden = true), 2600);
  }
  window.showToast = showToast;

  function openCart() {
    document.querySelectorAll(".drawer.open").forEach((d) => d.classList.remove("open"));
    drawer.classList.add("open");
    overlay.classList.add("show");
  }
  function closeCart() {
    drawer.classList.remove("open");
    overlay.classList.remove("show");
  }

  function render() {
    count.hidden = cart.length === 0;
    count.textContent = cart.length;
    done.hidden = true;
    empty.hidden = cart.length > 0;
    full.hidden = cart.length === 0;
    items.innerHTML = "";
    let sum = 0;
    cart.forEach((it, i) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = it.name;
      const price = document.createElement("b");
      price.textContent = money(it.price);
      const rm = document.createElement("button");
      rm.className = "linkbtn";
      rm.textContent = "remove";
      rm.addEventListener("click", () => { cart.splice(i, 1); render(); });
      li.append(name, price, rm);
      items.append(li);
      sum += it.price;
      if (earlyOn()) {
        const d = document.createElement("li");
        d.className = "discount";
        const dn = document.createElement("span"); dn.textContent = "Early bird −10% (until Dec 19, 2026)";
        const dp = document.createElement("b"); dp.textContent = "− " + money(it.price - finalPrice(it.price));
        d.append(dn, dp);
        items.append(d);
        sum -= it.price - finalPrice(it.price);
      }
    });
    sum = Math.round(sum * 100) / 100;
    total.textContent = money(sum);
    $("cart-usd").textContent = cart.length ? "per person · US$ 1 = R$ 5.744 (Nov 26, 2026)" : "";
    $("cart-inst").textContent = cart.length ? `or ${INSTALLMENTS}× ${money(Math.round(sum / INSTALLMENTS * 100) / 100)}, no installment in January` : "";
  }

  // "Add to cart" — one package at a time (choosing another replaces it)
  document.querySelectorAll(".add").forEach((btn) =>
    btn.addEventListener("click", () => {
      const price = parseFloat(btn.dataset.price);
      cart.length = 0;
      cart.push({ plan: btn.dataset.plan, name: btn.dataset.name, price });
      render();
      showToast(`${btn.dataset.name} added to cart`);
      const cb = document.querySelector(".cart-btn");
      cb.classList.remove("bump"); void cb.offsetWidth; cb.classList.add("bump");
      openCart();
    })
  );

  let lastPlan = "";
  // ---------- "Pay" (simulated) ----------
  const payBtn = $("pay-btn");
  payBtn.addEventListener("click", () => {
    if (!cart.length) return;
    payBtn.disabled = true;
    payBtn.textContent = "Processing…";
    setTimeout(() => {
      const isPremium = cart.some((it) => it.plan === "premium");
      lastPlan = cart[0]?.plan || "";
      document.querySelectorAll(".after-buy").forEach((el) => (el.hidden = false)); // "See you in Beijing" is for buyers
      cart.length = 0;
      render();
      payBtn.disabled = false;
      payBtn.textContent = "Pay";
      const isIntermediate = lastPlan === "intermediate";
      if (isPremium) {
        closeCart();
        playIntro().then(unlockPremium);
      } else if (isIntermediate) {
        closeCart();
        unlockComputex();
      } else {
        empty.hidden = true;
        done.hidden = false;
      }
    }, 1200);
  });
  $("cart-close").addEventListener("click", closeCart);

  // ---------- full-screen intro ----------
  function playIntro() {
    return new Promise((resolve) => {
      const intro = $("premium-intro");
      const video = $("premium-video");
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        intro.classList.add("out");
        setTimeout(() => { intro.hidden = true; intro.classList.remove("out", "has-video"); video.pause(); resolve(); }, 700);
      };
      intro.hidden = false;
      document.body.style.overflow = "hidden";
      $("intro-skip").onclick = finish;

      if (video.readyState >= 2) {
        intro.classList.add("has-video");
        video.currentTime = 0;
        video.play().catch(() => {});
        video.onended = finish;
      } else {
        intro.classList.remove("has-video");
        intro.querySelector(".intro-ph").style.animation = "none";
        void intro.offsetWidth;
        intro.querySelector(".intro-ph").style.animation = "";
        setTimeout(finish, 4500);
      }
    }).finally(() => (document.body.style.overflow = ""));
  }

  // Intermediate: only the Taipei / Computex / Tech Credit block of the second leg
  function unlockComputex() {
    const sec = $("premium");
    if (!sec.hidden && !sec.classList.contains("only-computex")) return; // Premium already open
    sec.hidden = false;
    sec.classList.add("only-computex");
    [...sec.children].forEach((el) => (el.hidden = el.id !== "taipei"));
    document.querySelector('#route a[href="#taipei"]').hidden = false;
    document.querySelectorAll(".after-buy").forEach((el) => (el.hidden = false));
    showToast("Intermediate: your Computex leg is unlocked");
    requestAnimationFrame(() => $("taipei").scrollIntoView({ behavior: "smooth" }));
  }

  function unlockPremium() {
    const sec = $("premium");
    sec.hidden = false;
    sec.classList.remove("only-computex");
    [...sec.children].forEach((el) => (el.hidden = false));
    document.querySelectorAll(".premium-only, .seg-premium").forEach((el) => (el.hidden = false));
    document.querySelectorAll(".public-only").forEach((el) => (el.hidden = true));
    document.querySelectorAll(".after-buy").forEach((el) => (el.hidden = false));
    document.querySelector(".plan.premium")?.classList.add("unlocked");
    requestAnimationFrame(() => sec.scrollIntoView({ behavior: "smooth" }));
  }

  // rehearsal shortcut: press "P" then "R"
  let last = "";
  document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input,textarea,select")) return;
    const k = e.key.toLowerCase();
    if (last === "p" && k === "r") playIntro().then(unlockPremium);
    last = k;
  });

  $("reset-demo").addEventListener("click", () => location.reload());

  // ---------- top selector: marks the current section ----------
  const segs = [...document.querySelectorAll(".segnav a")];
  const zones = [
    ["about", $("about")],
    ["route", $("flight")],
    ["packages", $("promotions")],
    ["premium", $("premium")],
    ["careers", $("careers")],
    ["contact", $("contact")],
  ];
  addEventListener("scroll", () => {
    let current = "about";
    for (const [name, el] of zones) {
      if (el && !el.hidden && el.getBoundingClientRect().top < innerHeight * 0.4) current = name;
    }
    if (scrollY < innerHeight * 0.5) current = "";
    segs.forEach((a) => a.classList.toggle("on", a.dataset.seg === current));
  }, { passive: true });

  render();
}
