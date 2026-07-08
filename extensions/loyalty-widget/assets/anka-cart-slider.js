(function () {
  const CART_PROXY = "/apps/loyalty/cart";
  const REDEEM_PROXY = "/apps/loyalty/cart-redeem";

  const MOUNT_SELECTORS = [
    "#CartDrawer",
    "cart-drawer",
    ".cart-drawer",
    "[data-cart-drawer]",
    "#cart-drawer",
    "form[action='/cart']",
    ".cart__contents",
    "#main-cart-items",
  ];

  class AnkaCartSlider {
    constructor() {
      this.root = null;
      this.data = null;
      this.points = 0;
      this.loading = false;
      this.message = null;
      this.error = null;
      this.locale = document.documentElement.lang || "en";
    }

    fmt(n) {
      return new Intl.NumberFormat(this.locale).format(n);
    }

    fmtMoney(n) {
      try {
        return new Intl.NumberFormat(this.locale, {
          style: "currency",
          currency: window.Shopify?.currency?.active || "USD",
          maximumFractionDigits: 2,
        }).format(n);
      } catch {
        return "$" + n.toFixed(2);
      }
    }

    dollarValue(points) {
      if (!this.data) return 0;
      return points / this.data.pointsToDollarRatio;
    }

    applyTheme() {
      if (!this.root || !this.data) return;
      const s = this.data.settings;
      this.root.style.setProperty("--anka-primary", s.primaryColor);
      this.root.style.setProperty("--anka-bg", s.backgroundColor);
      this.root.style.setProperty("--anka-text", s.textColor);
      this.root.style.setProperty(
        "--anka-surface",
        `color-mix(in srgb, ${s.backgroundColor} 88%, #000)`,
      );
    }

    async fetchConfig() {
      const res = await fetch(CART_PROXY, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      return res.json();
    }

    findMount() {
      for (const sel of MOUNT_SELECTORS) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      if (window.location.pathname.includes("/cart")) {
        return document.querySelector("main") || document.body;
      }
      return null;
    }

    render() {
      if (!this.root || !this.data?.enabled) return;

      const d = this.data;
      const discount = this.fmtMoney(this.dollarValue(this.points));

      if (!d.isMember) {
        this.root.innerHTML = `
          <div class="anka-cart-slider anka-cart-slider--guest">
            <p class="anka-cart-slider-title">Use loyalty points</p>
            <p class="anka-cart-muted"><a href="/account/login">Sign in</a> to apply points at checkout.</p>
          </div>`;
        return;
      }

      if (d.maxPoints < d.minPoints || d.balance < d.minPoints) {
        this.root.innerHTML = `
          <div class="anka-cart-slider">
            <p class="anka-cart-slider-title">Rewards balance</p>
            <p class="anka-cart-muted">${this.fmt(d.balance)} points — not enough to redeem yet.</p>
          </div>`;
        return;
      }

      this.root.innerHTML = `
        <div class="anka-cart-slider">
          <div class="anka-cart-slider-head">
            <p class="anka-cart-slider-title">Apply points</p>
            <span class="anka-cart-balance">${this.fmt(d.balance)} pts</span>
          </div>
          <div class="anka-cart-slider-values">
            <strong>${this.fmt(this.points)} pts</strong>
            <span class="anka-cart-muted">≈ ${discount} off</span>
          </div>
          <input type="range" class="anka-cart-range" min="${d.minPoints}" max="${d.maxPoints}" step="${d.step}" value="${this.points}" ${this.loading ? "disabled" : ""} />
          <div class="anka-cart-slider-limits">
            <span>${this.fmt(d.minPoints)} min</span>
            <span>${this.fmt(d.maxPoints)} max</span>
          </div>
          ${this.message ? `<div class="anka-cart-success">${this.message}</div>` : ""}
          ${this.error ? `<div class="anka-cart-error">${this.error}</div>` : ""}
          <button type="button" class="anka-cart-apply" ${this.loading ? "disabled" : ""}>
            ${this.loading ? "Applying…" : "Apply discount to cart"}
          </button>
        </div>`;

      const range = this.root.querySelector(".anka-cart-range");
      range?.addEventListener("input", (e) => {
        this.points = Number(e.target.value);
        this.error = null;
        this.render();
      });

      this.root.querySelector(".anka-cart-apply")?.addEventListener("click", () =>
        this.apply(),
      );
    }

    async applyDiscountToCart(code) {
      const res = await fetch("/cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ discount: code }),
      });
      if (!res.ok) {
        const err = await fetch("/discount/" + encodeURIComponent(code), {
          method: "POST",
          headers: { Accept: "application/json" },
        });
        if (!err.ok) throw new Error("Could not apply discount to cart.");
      }

      document.dispatchEvent(new CustomEvent("anka:cart:updated"));
      if (typeof window.publish === "function") {
        try {
          window.publish("cart-update", { source: "anka-loyalty" });
        } catch (_) {}
      }
      window.location.reload();
    }

    async apply() {
      this.loading = true;
      this.error = null;
      this.message = null;
      this.render();

      try {
        const body = new FormData();
        body.set("points", String(this.points));
        const res = await fetch(REDEEM_PROXY, {
          method: "POST",
          credentials: "same-origin",
          body,
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Redeem failed");

        await this.applyDiscountToCart(data.code);
        this.message = `Applied ${data.code} (−${this.fmt(data.pointsDeducted)} pts)`;
      } catch (err) {
        this.error = err instanceof Error ? err.message : "Error";
        this.loading = false;
        this.render();
      }
    }

    mountInto(container) {
      if (this.root?.parentElement === container) return;
      if (this.root) this.root.remove();
      this.root = document.createElement("div");
      this.root.className = "anka-cart-slider-root";
      this.root.id = "anka-cart-slider-mount";
      container.prepend(this.root);
      this.applyTheme();
      this.render();
    }

    async init() {
      try {
        this.data = await this.fetchConfig();
        if (!this.data?.enabled) return;

        this.points = this.data.maxPoints || this.data.minPoints;

        const tryMount = () => {
          const target = this.findMount();
          if (target) this.mountInto(target);
        };

        tryMount();

        const observer = new MutationObserver(() => tryMount());
        observer.observe(document.body, { childList: true, subtree: true });

        document.addEventListener("cart:open", tryMount);
        document.addEventListener("drawerOpen", tryMount);
      } catch (err) {
        console.error("[anka-cart-slider]", err);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    new AnkaCartSlider().init();
  });
})();
