(function () {
  const CART_PROXY = "/apps/loyalty/cart";
  const REDEEM_PROXY = "/apps/loyalty/cart-redeem";

  const DRAWER_SELECTORS = [
    "cart-drawer",
    "#CartDrawer",
    ".cart-drawer",
    "[data-cart-drawer]",
    "#cart-drawer",
  ];

  const INLINE_MOUNT_SELECTORS = [
    "form[action='/cart'] .cart__items",
    "form[action='/cart']",
    "#main-cart-items",
    ".cart__contents",
  ];

  class AnkaCartSlider {
    constructor() {
      this.dock = null;
      this.inlineRoot = null;
      this.data = null;
      this.points = 0;
      this.loading = false;
      this.message = null;
      this.error = null;
      this.popoverOpen = false;
      this.drawerOpen = false;
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

    applyTheme(el) {
      if (!el || !this.data) return;
      const s = this.data.settings;
      el.style.setProperty("--anka-primary", s.primaryColor);
      el.style.setProperty("--anka-bg", s.backgroundColor);
      el.style.setProperty("--anka-text", s.textColor);
      el.style.setProperty(
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

    findCartDrawer() {
      for (const sel of DRAWER_SELECTORS) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    }

    isDrawerOpen(drawer) {
      if (!drawer) return false;
      if (drawer.hasAttribute("open")) return true;
      if (drawer.classList.contains("active")) return true;
      if (drawer.classList.contains("is-open")) return true;
      if (drawer.classList.contains("drawer--is-open")) return true;
      if (drawer.getAttribute("aria-hidden") === "false") return true;

      const style = window.getComputedStyle(drawer);
      if (style.display === "none" || style.visibility === "hidden") return false;

      const rect = drawer.getBoundingClientRect();
      return rect.width > 80 && rect.right > window.innerWidth * 0.45;
    }

    setDrawerOpenState(open) {
      if (open === this.drawerOpen) return;
      this.drawerOpen = open;
      if (!open) this.popoverOpen = false;
      document.body.classList.toggle("anka-cart-drawer-open", open);
      document.dispatchEvent(
        new CustomEvent("anka:cart-drawer", { detail: { open } }),
      );
    }

    positionDock(drawer) {
      if (!this.dock || !drawer) return;
      const rect = drawer.getBoundingClientRect();
      const top = Math.min(
        Math.max(rect.top + 72, 72),
        window.innerHeight - 120,
      );
      this.dock.style.top = `${top}px`;
      this.dock.style.left = `${Math.max(12, rect.left - 4)}px`;
    }

    ensureDock() {
      if (this.dock) return;
      this.dock = document.createElement("div");
      this.dock.className = "anka-cart-dock";
      this.dock.id = "anka-cart-dock";
      document.body.appendChild(this.dock);
      this.applyTheme(this.dock);
    }

    canRedeem() {
      const d = this.data;
      if (!d) return false;
      return d.isMember && d.maxPoints >= d.minPoints && d.balance >= d.minPoints;
    }

    renderSliderContent(compact) {
      const d = this.data;
      if (!d) return "";

      const discount = this.fmtMoney(this.dollarValue(this.points));

      if (!d.isMember) {
        return `
          <p class="anka-cart-popover-title">Redeem points</p>
          <p class="anka-cart-muted"><a href="/account/login">Sign in</a> to apply points.</p>`;
      }

      if (!this.canRedeem()) {
        return `
          <p class="anka-cart-popover-title">Your balance</p>
          <p class="anka-cart-muted">${this.fmt(d.balance)} pts — not enough yet.</p>`;
      }

      const applyLabel = compact ? "Apply" : "Apply to cart";

      return `
        <p class="anka-cart-popover-title">Redeem points</p>
        <div class="anka-cart-popover-row">
          <strong>${this.fmt(this.points)}</strong>
          <span class="anka-cart-muted">≈ ${discount}</span>
        </div>
        <input type="range" class="anka-cart-range" min="${d.minPoints}" max="${d.maxPoints}" step="${d.step}" value="${this.points}" ${this.loading ? "disabled" : ""} />
        <div class="anka-cart-slider-limits">
          <span>${this.fmt(d.minPoints)}</span>
          <span>${this.fmt(d.maxPoints)}</span>
        </div>
        ${this.message ? `<div class="anka-cart-success">${this.message}</div>` : ""}
        ${this.error ? `<div class="anka-cart-error">${this.error}</div>` : ""}
        <button type="button" class="anka-cart-apply" ${this.loading ? "disabled" : ""}>
          ${this.loading ? "…" : applyLabel}
        </button>`;
    }

    bindSliderEvents(root) {
      root.querySelector(".anka-cart-range")?.addEventListener("input", (e) => {
        this.points = Number(e.target.value);
        this.error = null;
        this.render();
      });

      root.querySelector(".anka-cart-apply")?.addEventListener("click", () =>
        this.apply(),
      );

      root.querySelector("[data-anka-cart-close]")?.addEventListener("click", () => {
        this.popoverOpen = false;
        this.render();
      });

      root.querySelector(".anka-cart-tab")?.addEventListener("click", () => {
        this.popoverOpen = !this.popoverOpen;
        this.render();
      });
    }

    renderDock() {
      if (!this.dock || !this.data?.enabled) return;

      const d = this.data;
      const tabPts = d.isMember ? this.fmt(d.balance) : "★";
      const popoverClass = this.popoverOpen ? " is-open" : "";

      this.dock.classList.toggle("is-visible", this.drawerOpen);
      if (!this.drawerOpen) {
        this.dock.innerHTML = "";
        return;
      }

      this.applyTheme(this.dock);

      this.dock.innerHTML = `
        <div class="anka-cart-dock-inner">
          <button type="button" class="anka-cart-tab" aria-expanded="${this.popoverOpen}" aria-label="Redeem loyalty points">
            <span class="anka-cart-tab-icon">★</span>
            <span class="anka-cart-tab-label">${tabPts}</span>
          </button>
          <div class="anka-cart-popover${popoverClass}" role="dialog" aria-label="Redeem points">
            <button type="button" class="anka-cart-popover-close" data-anka-cart-close aria-label="Close">×</button>
            ${this.renderSliderContent(true)}
          </div>
        </div>`;

      this.bindSliderEvents(this.dock);
    }

    renderInline() {
      if (!this.data?.enabled) return;
      if (this.drawerOpen) {
        if (this.inlineRoot) this.inlineRoot.remove();
        this.inlineRoot = null;
        return;
      }
      if (!window.location.pathname.includes("/cart")) {
        if (this.inlineRoot) this.inlineRoot.remove();
        this.inlineRoot = null;
        return;
      }

      let mount = null;
      for (const sel of INLINE_MOUNT_SELECTORS) {
        mount = document.querySelector(sel);
        if (mount) break;
      }
      if (!mount) return;

      if (!this.inlineRoot) {
        this.inlineRoot = document.createElement("div");
        this.inlineRoot.className = "anka-cart-inline-root";
        mount.prepend(this.inlineRoot);
      }

      this.applyTheme(this.inlineRoot);

      this.inlineRoot.innerHTML = `
        <div class="anka-cart-inline">
          ${this.renderSliderContent(false)}
        </div>`;

      this.bindSliderEvents(this.inlineRoot);
    }

    render() {
      if (!this.data?.enabled) return;
      this.renderDock();
      this.renderInline();
    }

    sync() {
      const drawer = this.findCartDrawer();
      this.setDrawerOpenState(this.isDrawerOpen(drawer));
      if (this.drawerOpen && drawer) this.positionDock(drawer);
      this.render();
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

        this.popoverOpen = false;
        await this.applyDiscountToCart(data.code);
      } catch (err) {
        this.error = err instanceof Error ? err.message : "Error";
        this.loading = false;
        this.render();
      }
    }

    async init() {
      try {
        this.data = await this.fetchConfig();
        if (!this.data?.enabled) return;

        this.points = Math.min(
          this.data.maxPoints || this.data.minPoints,
          this.data.balance || this.data.minPoints,
        );

        this.sync();

        const observer = new MutationObserver(() => this.sync());
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ["class", "open", "aria-hidden"],
          childList: true,
          subtree: true,
        });

        window.addEventListener("resize", () => this.sync());
        document.addEventListener("cart:open", () => this.sync());
        document.addEventListener("drawerOpen", () => this.sync());

        document.addEventListener("click", (e) => {
          if (!this.popoverOpen || !this.dock) return;
          if (this.dock.contains(e.target)) return;
          this.popoverOpen = false;
          this.render();
        });
      } catch (err) {
        console.error("[anka-cart-slider]", err);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    new AnkaCartSlider().init();
  });
})();
