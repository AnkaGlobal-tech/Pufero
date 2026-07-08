(function () {
  const CART_PROXY = "/apps/loyalty/cart";
  const REDEEM_PROXY = "/apps/loyalty/cart-redeem";

  const DRAWER_SELECTORS = ["cart-drawer", "#CartDrawer", ".cart-drawer", "#cart-drawer"];

  const FOOTER_SELECTORS = [
    ".cart-drawer__footer",
    "#CartDrawer-CartFooter",
    ".drawer__footer",
    ".cart__footer",
    "[data-cart-footer]",
  ];

  const INLINE_MOUNT_SELECTORS = [
    "form[action='/cart'] .cart__blocks",
    "form[action='/cart'] .cart__footer",
    "form[action='/cart']",
    "#main-cart-footer",
  ];

  class AnkaCartSlider {
    constructor() {
      this.drawerRoot = null;
      this.inlineRoot = null;
      this.data = null;
      this.points = 0;
      this.loading = false;
      this.message = null;
      this.error = null;
      this.expanded = false;
      this.drawerOpen = false;
      this.renderKey = "";
      this.syncScheduled = false;
      this.drawerObserver = null;
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
        `color-mix(in srgb, ${s.backgroundColor} 92%, #fff)`,
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

    queryInDrawer(drawer, selector) {
      if (drawer.shadowRoot) {
        const hit = drawer.shadowRoot.querySelector(selector);
        if (hit) return hit;
      }
      return drawer.querySelector(selector);
    }

    findCartDrawer() {
      for (const sel of DRAWER_SELECTORS) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    }

    findDrawerFooter(drawer) {
      for (const sel of FOOTER_SELECTORS) {
        const el = this.queryInDrawer(drawer, sel);
        if (el) return el;
      }
      return null;
    }

    isDrawerOpen(drawer) {
      if (!drawer) return false;
      return (
        drawer.hasAttribute("open") ||
        drawer.classList.contains("active") ||
        drawer.classList.contains("is-open") ||
        drawer.getAttribute("aria-hidden") === "false"
      );
    }

    scheduleSync() {
      if (this.syncScheduled) return;
      this.syncScheduled = true;
      requestAnimationFrame(() => {
        this.syncScheduled = false;
        this.sync();
      });
    }

    setDrawerOpenState(open) {
      const changed = open !== this.drawerOpen;
      this.drawerOpen = open;
      if (!open) {
        this.expanded = false;
        if (this.drawerRoot) {
          this.drawerRoot.remove();
          this.drawerRoot = null;
        }
      }
      document.body.classList.toggle("anka-cart-drawer-open", open);
      if (changed) {
        document.dispatchEvent(
          new CustomEvent("anka:cart-drawer", { detail: { open } }),
        );
      }
    }

    canRedeem() {
      const d = this.data;
      if (!d) return false;
      return (
        d.isMember && d.maxPoints >= d.minPoints && d.balance >= d.minPoints
      );
    }

    renderPanelContent() {
      const d = this.data;
      if (!d) return "";

      if (!d.isMember) {
        return `<p class="anka-cart-muted"><a href="/account/login">Sign in</a> to redeem points at checkout.</p>`;
      }

      if (!this.canRedeem()) {
        return `<p class="anka-cart-muted">${this.fmt(d.balance)} points — not enough to redeem yet.</p>`;
      }

      const discount = this.fmtMoney(this.dollarValue(this.points));

      return `
        <div class="anka-cart-popover-row">
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
          ${this.loading ? "Applying…" : "Apply discount"}
        </button>`;
    }

    renderWidgetHtml() {
      const d = this.data;
      if (!d) return "";

      const discountHint = d.isMember
        ? `≈ ${this.fmtMoney(this.dollarValue(Math.min(d.balance, d.maxPoints || d.balance)))} off`
        : "Earn on every order";

      const toggleLabel = d.isMember
        ? `<strong>${this.fmt(d.balance)} pts</strong> <span class="anka-cart-muted">${discountHint}</span>`
        : `<span class="anka-cart-muted">Rewards members save at checkout</span>`;

      const action = this.canRedeem()
        ? this.expanded
          ? "Close"
          : "Redeem"
        : d.isMember
          ? ""
          : "Join";

      return `
        <div class="anka-cart-inline-drawer">
          <button type="button" class="anka-cart-redeem-toggle" aria-expanded="${this.expanded}">
            <span class="anka-cart-redeem-icon" aria-hidden="true">★</span>
            <span class="anka-cart-redeem-copy">${toggleLabel}</span>
            ${action ? `<span class="anka-cart-redeem-action">${action}</span>` : ""}
          </button>
          ${
            this.expanded
              ? `<div class="anka-cart-redeem-panel">${this.renderPanelContent()}</div>`
              : ""
          }
        </div>`;
    }

    bindEvents(root) {
      root.querySelector(".anka-cart-redeem-toggle")?.addEventListener("click", () => {
        if (!this.data?.isMember) return;
        if (!this.canRedeem() && !this.expanded) return;
        this.expanded = !this.expanded;
        this.renderKey = "";
        this.render();
      });

      root.querySelector(".anka-cart-range")?.addEventListener("input", (e) => {
        this.points = Number(e.target.value);
        this.error = null;
        this.renderKey = "";
        this.render();
      });

      root.querySelector(".anka-cart-apply")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.apply();
      });
    }

    mountDrawerWidget(drawer) {
      const footer = this.findDrawerFooter(drawer);
      if (!footer) return;

      if (this.drawerRoot && !this.drawerRoot.isConnected) {
        this.drawerRoot = null;
      }

      if (!this.drawerRoot) {
        this.drawerRoot = document.createElement("div");
        this.drawerRoot.className = "anka-cart-drawer-root";
        footer.prepend(this.drawerRoot);
      } else if (this.drawerRoot.parentElement !== footer) {
        footer.prepend(this.drawerRoot);
      }

      this.applyTheme(this.drawerRoot);

      const key = [
        "drawer",
        this.expanded,
        this.points,
        this.loading,
        this.message,
        this.error,
        this.data?.balance,
      ].join("|");

      if (this.renderKey === key) return;
      this.renderKey = key;

      this.drawerRoot.innerHTML = this.renderWidgetHtml();
      this.bindEvents(this.drawerRoot);
    }

    mountPageWidget() {
      if (this.drawerOpen) return;

      let mount = null;
      for (const sel of INLINE_MOUNT_SELECTORS) {
        mount = document.querySelector(sel);
        if (mount) break;
      }
      if (!mount) return;

      if (!this.inlineRoot) {
        this.inlineRoot = document.createElement("div");
        this.inlineRoot.className = "anka-cart-page-root";
        mount.prepend(this.inlineRoot);
      }

      this.applyTheme(this.inlineRoot);

      const key = [
        "page",
        this.expanded,
        this.points,
        this.loading,
        this.message,
        this.error,
        this.data?.balance,
      ].join("|");

      if (this.renderKey === key && this.inlineRoot.innerHTML) return;
      this.renderKey = key;

      this.inlineRoot.innerHTML = this.renderWidgetHtml();
      this.bindEvents(this.inlineRoot);
    }

    render() {
      if (!this.data?.enabled) return;

      if (this.drawerOpen) {
        const drawer = this.findCartDrawer();
        if (drawer) this.mountDrawerWidget(drawer);
      } else if (window.location.pathname.includes("/cart")) {
        this.mountPageWidget();
      }
    }

    sync() {
      const drawer = this.findCartDrawer();
      const open = this.isDrawerOpen(drawer);
      this.setDrawerOpenState(open);
      this.render();
    }

    watchDrawer() {
      const drawer = this.findCartDrawer();
      if (!drawer || drawer.dataset.ankaCartWatch) return;
      drawer.dataset.ankaCartWatch = "1";

      this.drawerObserver = new MutationObserver(() => this.scheduleSync());
      this.drawerObserver.observe(drawer, {
        attributes: true,
        attributeFilter: ["class", "open", "aria-hidden"],
      });
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
      window.location.reload();
    }

    async apply() {
      this.loading = true;
      this.error = null;
      this.message = null;
      this.renderKey = "";
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

        this.expanded = false;
        await this.applyDiscountToCart(data.code);
      } catch (err) {
        this.error = err instanceof Error ? err.message : "Error";
        this.loading = false;
        this.renderKey = "";
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
        this.watchDrawer();

        document.addEventListener("cart:open", () => {
          this.scheduleSync();
          setTimeout(() => this.scheduleSync(), 120);
        });
        document.addEventListener("drawerOpen", () => this.scheduleSync());
      } catch (err) {
        console.error("[anka-cart-slider]", err);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    new AnkaCartSlider().init();
  });
})();
