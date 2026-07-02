(function () {
  const PROXY_BASE = "/apps/anka";

  const LOCALE_MAP = {
    en: "en-US",
    tr: "tr-TR",
    de: "de-DE",
    fr: "fr-FR",
    es: "es-ES",
    it: "it-IT",
    nl: "nl-NL",
    pt: "pt-PT",
  };

  function intlLocale(code) {
    const base = (code || "en").toLowerCase().split("-")[0];
    return LOCALE_MAP[base] || code || "en-US";
  }

  function tpl(str, vars) {
    return String(str || "").replace(/\{\{(\w+)\}\}/g, (_, k) =>
      vars[k] != null ? String(vars[k]) : "",
    );
  }

  class AnkaWidget {
    constructor(root) {
      this.root = root;
      this.locale = root.dataset.locale || "en";
      this.currency = root.dataset.currency || "USD";
      this.state = null;
      this.open = false;
      this.tab = "spend";
      this.message = null;
      this.error = null;
      this.loading = false;
    }

    fmt(n) {
      return new Intl.NumberFormat(intlLocale(this.state?.locale || this.locale)).format(n);
    }

    fmtMoney(n) {
      try {
        return new Intl.NumberFormat(intlLocale(this.state?.locale || this.locale), {
          style: "currency",
          currency: this.state?.currency || this.currency,
          maximumFractionDigits: 0,
        }).format(n);
      } catch {
        return "$" + Math.round(n);
      }
    }

    copy() {
      return this.state?.copy || {};
    }

    async init() {
      try {
        await this.refresh();
        if (!this.state?.enabled) {
          this.root.innerHTML = "";
          return;
        }
        this.render();
      } catch (err) {
        console.error("[anka-widget] init failed", err);
      }
    }

    widgetUrl() {
      const params = new URLSearchParams({
        locale: this.locale,
        currency: this.currency,
      });
      return `${PROXY_BASE}/widget?${params}`;
    }

    async refresh() {
      const res = await fetch(this.widgetUrl(), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("Widget load failed");
      this.state = await res.json();
      if (this.state.locale) this.locale = this.state.locale;
    }

    applyTheme() {
      const s = this.state.settings;
      this.root.style.setProperty("--anka-primary", s.primary_color);
      this.root.style.setProperty("--anka-bg", s.background_color);
      this.root.style.setProperty("--anka-text", s.text_color);
    }

    nudgeText() {
      const c = this.copy();
      const balance = this.state.member?.balance ?? 0;
      return tpl(c.nudge_text, { balance: this.fmt(balance) });
    }

    toggle(open) {
      this.open = open ?? !this.open;
      if (!this.open) {
        this.message = null;
        this.error = null;
      }
      this.render();
    }

    setTab(tab) {
      this.tab = tab;
      this.render();
    }

    async redeem(redemptionId) {
      this.loading = true;
      this.error = null;
      this.message = null;
      this.render();

      try {
        const body = new FormData();
        body.set("redemption_id", redemptionId);
        const params = new URLSearchParams({ locale: this.locale });
        const res = await fetch(`${PROXY_BASE}/redeem?${params}`, {
          method: "POST",
          credentials: "same-origin",
          body,
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Redeem failed");
        const c = this.copy();
        this.message = tpl(c.coupon_success, {
          code: data.code,
          points: this.fmt(data.pointsDeducted),
        });
        await this.refresh();
      } catch (err) {
        this.error = err instanceof Error ? err.message : "Error";
      } finally {
        this.loading = false;
        this.render();
      }
    }

    renderEarnTab() {
      const c = this.copy();
      const ratio = this.state.pointsToDollarRatio || 100;
      const perDollar = this.state.pointsPerDollar || 1;
      const dollarValue =
        this.state.member?.balance != null
          ? this.state.member.balance / ratio
          : 0;

      return `
        <div class="anka-list">
          <div class="anka-card">
            <div class="anka-card-title">${tpl(c.earn_per_dollar, { points: this.fmt(perDollar) })}</div>
            <div class="anka-card-meta">${c.earn_per_dollar_hint}</div>
          </div>
          <div class="anka-card">
            <div class="anka-card-title">${c.points_value_title}</div>
            <div class="anka-card-meta">${tpl(c.points_value_hint, { ratio: this.fmt(ratio) })}</div>
          </div>
          ${
            this.state.member
              ? `<div class="anka-card">
            <div class="anka-card-title">${c.estimated_value}</div>
            <div class="anka-card-meta">${tpl(c.estimated_value_hint, { amount: this.fmtMoney(dollarValue) })}</div>
          </div>`
              : ""
          }
        </div>
      `;
    }

    renderSpendTab() {
      const c = this.copy();
      const member = this.state.member;
      if (!member) {
        return `<p class="anka-card-meta">${c.login_for_spend}</p>`;
      }
      if (member.redemptions.length === 0) {
        return `<p class="anka-card-meta">${c.no_redemptions}</p>`;
      }

      return `
        <div class="anka-list">
          ${member.redemptions
            .map(
              (r) => `
            <div class="anka-card">
              <div class="anka-card-title">${r.name}</div>
              <div class="anka-card-meta">${this.fmt(r.points_cost)} ${c.points_label}</div>
              <button class="anka-btn" type="button" data-redeem="${r.id}"
                ${!r.canAfford || this.loading ? "disabled" : ""}>
                ${this.loading ? c.creating_coupon : c.create_coupon}
              </button>
            </div>`,
            )
            .join("")}
        </div>
      `;
    }

    renderPanelContent(isMember) {
      const c = this.copy();
      if (!isMember) {
        const g = this.state.guest;
        return `
          <div class="anka-panel-header">
            <div class="anka-panel-header-top">
              <h2 class="anka-panel-title">${c.launcher_label}</h2>
              <button class="anka-close" type="button" data-close aria-label="${c.close_label}">×</button>
            </div>
          </div>
          <div class="anka-body anka-guest">
            <h3>${g.headline}</h3>
            <p>${g.body}</p>
            <a class="anka-btn" href="${g.registerUrl}">${c.register_cta}</a>
            <a class="anka-btn anka-btn-secondary" href="${g.loginUrl}">${c.login_cta}</a>
          </div>`;
      }

      const m = this.state.member;
      const tierHint = m.nextTierName
        ? tpl(c.spend_to_next, {
            amount: this.fmtMoney(m.spendToNext),
            tier: m.nextTierName,
          })
        : c.top_tier;

      return `
        <div class="anka-panel-header">
          <div class="anka-panel-header-top">
            <h2 class="anka-panel-title">${c.launcher_label}</h2>
            <button class="anka-close" type="button" data-close aria-label="${c.close_label}">×</button>
          </div>
          <div class="anka-balance-row">
            <div class="anka-balance-value">${this.fmt(m.balance)}</div>
            <div class="anka-balance-label">${c.points_label}</div>
          </div>
          ${
            m.tierName
              ? `<div class="anka-tier">
              <div class="anka-tier-badge"><span class="anka-tier-dot"></span>${m.tierName}</div>
              <div class="anka-progress"><div class="anka-progress-fill" style="width:${m.progressPercent}%"></div></div>
              <div class="anka-tier-hint">${tierHint}</div>
            </div>`
              : ""
          }
        </div>
        <div class="anka-tabs">
          <button class="anka-tab ${this.tab === "earn" ? "is-active" : ""}" type="button" data-tab="earn">${c.tab_earn}</button>
          <button class="anka-tab ${this.tab === "spend" ? "is-active" : ""}" type="button" data-tab="spend">${c.tab_spend}</button>
        </div>
        <div class="anka-body">
          ${this.message ? `<div class="anka-success">${this.message}</div>` : ""}
          ${this.error ? `<div class="anka-error">${this.error}</div>` : ""}
          ${this.tab === "earn" ? this.renderEarnTab() : this.renderSpendTab()}
        </div>`;
    }

    stackClasses() {
      const s = this.state.settings;
      const pos = s.position === "bottom-left" ? "anka-pos-left" : "anka-pos-right";
      const dir = `anka-dir-${s.panel_direction || "up"}`;
      return `anka-stack ${pos} ${dir}`;
    }

    render() {
      if (!this.state?.enabled || this.state.programPaused) {
        this.root.innerHTML = "";
        return;
      }

      this.applyTheme();
      const c = this.copy();
      const s = this.state.settings;
      const showNudge =
        !this.open &&
        s.nudge_enabled &&
        this.state.isMember &&
        (this.state.member?.balance ?? 0) > 0;

      this.root.className = "anka-root";

      this.root.innerHTML = `
        ${this.open ? `<div class="anka-backdrop" data-close></div>` : ""}
        <div class="${this.stackClasses()}">
          ${
            this.open
              ? `<div class="anka-panel" role="dialog" aria-label="${c.launcher_label}">
              ${this.renderPanelContent(this.state.isMember)}
            </div>`
              : ""
          }
          <div class="anka-launcher-wrap">
            ${showNudge ? `<div class="anka-nudge" data-toggle role="status">${this.nudgeText()}</div>` : ""}
            <button class="anka-launcher ${this.open ? "is-open" : ""}" type="button" data-toggle aria-expanded="${this.open}">
              <span class="anka-launcher-icon">${this.open ? "×" : "★"}</span>
              <span>${this.open ? c.close_label : c.launcher_label}</span>
            </button>
          </div>
        </div>`;

      this.root.querySelectorAll("[data-toggle]").forEach((el) =>
        el.addEventListener("click", () => this.toggle()),
      );
      this.root.querySelectorAll("[data-close]").forEach((el) =>
        el.addEventListener("click", () => this.toggle(false)),
      );
      this.root.querySelectorAll("[data-tab]").forEach((el) =>
        el.addEventListener("click", () =>
          this.setTab(el.getAttribute("data-tab") || "spend"),
        ),
      );
      this.root.querySelectorAll("[data-redeem]").forEach((el) =>
        el.addEventListener("click", () =>
          this.redeem(el.getAttribute("data-redeem") || ""),
        ),
      );
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("anka-loyalty-root");
    if (!root) return;
    new AnkaWidget(root).init();
  });
})();
