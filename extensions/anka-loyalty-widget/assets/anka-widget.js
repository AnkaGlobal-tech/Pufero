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

  function parseHex(hex) {
    const raw = String(hex || "").replace("#", "").trim();
    if (raw.length === 3) {
      return [
        parseInt(raw[0] + raw[0], 16),
        parseInt(raw[1] + raw[1], 16),
        parseInt(raw[2] + raw[2], 16),
      ];
    }
    if (raw.length !== 6) return null;
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
    ];
  }

  function luminance(hex) {
    const rgb = parseHex(hex);
    if (!rgb) return 0.5;
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastOn(hex) {
    return luminance(hex) > 0.62 ? "#111111" : "#ffffff";
  }

  class AnkaWidget {
    constructor(root) {
      this.root = root;
      this.locale = root.dataset.locale || "en";
      this.currency = root.dataset.currency || "USD";
      this.state = null;
      this.open = false;
      this.tab = "earn";
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

    features() {
      const s = this.state?.settings || {};
      return {
        tier: s.show_tier_progress !== false,
        earn: s.show_earn_tab !== false,
        redeem: s.show_redeem_tab !== false,
        nudge: s.nudge_enabled !== false,
      };
    }

    hasTabs() {
      const f = this.features();
      return f.earn && f.redeem;
    }

    hasBody() {
      const f = this.features();
      return f.earn || f.redeem;
    }

    isCompact() {
      return !this.hasBody();
    }

    syncDefaultTab() {
      const f = this.features();
      if (f.redeem && !f.earn) this.tab = "spend";
      else if (f.earn) this.tab = "earn";
      else this.tab = "spend";
    }

    async init() {
      try {
        await this.refresh();
        if (!this.state?.enabled) {
          this.root.innerHTML = "";
          return;
        }
        this.syncDefaultTab();
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
      this.syncDefaultTab();
    }

    applyTheme() {
      const s = this.state.settings;
      this.root.style.setProperty("--anka-primary", s.primary_color);
      this.root.style.setProperty("--anka-bg", s.background_color);
      this.root.style.setProperty("--anka-text", s.text_color);
      this.root.style.setProperty(
        "--anka-surface",
        `color-mix(in srgb, ${s.background_color} 88%, #000)`,
      );
      this.root.style.setProperty(
        "--anka-surface-2",
        `color-mix(in srgb, ${s.background_color} 76%, #000)`,
      );
      this.root.style.setProperty(
        "--anka-btn-text",
        contrastOn(s.primary_color),
      );
      this.root.style.setProperty(
        "--anka-muted",
        `color-mix(in srgb, ${s.text_color} 55%, transparent)`,
      );
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
            <div class="anka-card anka-redeem-card">
              <div class="anka-redeem-row">
                <div>
                  <div class="anka-card-title">${r.name}</div>
                  <div class="anka-card-meta">${this.fmt(r.points_cost)} ${c.points_label}</div>
                </div>
                <button class="anka-btn anka-btn-inline" type="button" data-redeem="${r.id}"
                  ${!r.canAfford || this.loading ? "disabled" : ""}>
                  ${this.loading ? c.creating_coupon : c.create_coupon}
                </button>
              </div>
            </div>`,
            )
            .join("")}
        </div>
      `;
    }

    renderTierBlock(m) {
      const c = this.copy();
      const f = this.features();
      if (!f.tier || !m.tierName) return "";

      const tierHint = m.nextTierName
        ? tpl(c.spend_to_next, {
            amount: this.fmtMoney(m.spendToNext),
            tier: m.nextTierName,
          })
        : c.top_tier;

      return `
        <div class="anka-tier">
          <div class="anka-tier-badge"><span class="anka-tier-dot"></span>${m.tierName}</div>
          <div class="anka-progress"><div class="anka-progress-fill" style="width:${m.progressPercent}%"></div></div>
          <div class="anka-tier-hint">${tierHint}</div>
        </div>`;
    }

    renderPanelBody(isMember) {
      const f = this.features();
      if (!isMember || this.isCompact()) return "";

      const c = this.copy();
      let tabs = "";
      if (this.hasTabs()) {
        tabs = `
        <div class="anka-tabs" role="tablist">
          <button class="anka-tab ${this.tab === "earn" ? "is-active" : ""}" type="button" data-tab="earn" role="tab">${c.tab_earn}</button>
          <button class="anka-tab ${this.tab === "spend" ? "is-active" : ""}" type="button" data-tab="spend" role="tab">${c.tab_spend}</button>
          <span class="anka-tab-indicator" data-tab-active="${this.tab}"></span>
        </div>`;
      }

      let content = "";
      if (f.earn && f.redeem) {
        content = this.tab === "earn" ? this.renderEarnTab() : this.renderSpendTab();
      } else if (f.earn) {
        content = this.renderEarnTab();
      } else if (f.redeem) {
        content = this.renderSpendTab();
      }

      return `
        ${tabs}
        <div class="anka-body">
          ${this.message ? `<div class="anka-success">${this.message}</div>` : ""}
          ${this.error ? `<div class="anka-error">${this.error}</div>` : ""}
          ${content}
        </div>`;
    }

    renderPanelContent(isMember) {
      const c = this.copy();
      const compact = isMember && this.isCompact();

      if (!isMember) {
        const g = this.state.guest;
        return `
          <div class="anka-panel-header">
            <div class="anka-panel-header-top">
              <h2 class="anka-panel-title">${c.launcher_label}</h2>
              <button class="anka-close" type="button" data-close aria-label="${c.close_label}">
                <span class="anka-close-icon"></span>
              </button>
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

      return `
        <div class="anka-panel-header ${compact ? "anka-panel-header--compact" : ""}">
          <div class="anka-panel-header-top">
            <h2 class="anka-panel-title">${c.launcher_label}</h2>
            <button class="anka-close" type="button" data-close aria-label="${c.close_label}">
              <span class="anka-close-icon"></span>
            </button>
          </div>
          <div class="anka-balance-row">
            <div class="anka-balance-value">${this.fmt(m.balance)}</div>
            <div class="anka-balance-label">${c.points_label}</div>
          </div>
          ${this.renderTierBlock(m)}
        </div>
        ${this.renderPanelBody(true)}`;
    }

    launcherIcon() {
      return `
        <span class="anka-launcher-icon" aria-hidden="true">
          <svg class="anka-icon anka-icon-star" viewBox="0 0 24 24" width="20" height="20">
            <path fill="currentColor" d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z"/>
          </svg>
          <svg class="anka-icon anka-icon-close" viewBox="0 0 24 24" width="18" height="18">
            <path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"/>
          </svg>
        </span>`;
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
      const f = this.features();
      const showNudge =
        !this.open &&
        f.nudge &&
        this.state.isMember &&
        (this.state.member?.balance ?? 0) > 0;

      const compact = this.state.isMember && this.isCompact();

      this.root.className = "anka-root";

      this.root.innerHTML = `
        ${this.open ? `<div class="anka-backdrop" data-close></div>` : ""}
        <div class="${this.stackClasses()}">
          ${
            this.open
              ? `<div class="anka-panel ${compact ? "anka-panel--compact" : ""}" role="dialog" aria-label="${c.launcher_label}">
              ${this.renderPanelContent(this.state.isMember)}
            </div>`
              : ""
          }
          <div class="anka-launcher-wrap">
            ${showNudge ? `<div class="anka-nudge" data-toggle role="status">${this.nudgeText()}</div>` : ""}
            <button class="anka-launcher ${this.open ? "is-open" : ""}" type="button" data-toggle aria-expanded="${this.open}" aria-label="${c.launcher_label}">
              ${this.launcherIcon()}
              <span class="anka-launcher-label">${c.launcher_label}</span>
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
          this.setTab(el.getAttribute("data-tab") || "earn"),
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
