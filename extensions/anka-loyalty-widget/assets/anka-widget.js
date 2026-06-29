(function () {
  const PROXY_BASE = "/apps/anka";

  function fmt(n) {
    return new Intl.NumberFormat("tr-TR").format(n);
  }

  function fmtMoney(n) {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  }

  class AnkaWidget {
    constructor(root) {
      this.root = root;
      this.state = null;
      this.open = false;
      this.tab = "spend";
      this.message = null;
      this.error = null;
      this.loading = false;
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

    async refresh() {
      const res = await fetch(`${PROXY_BASE}/widget`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error("Widget yüklenemedi");
      }
      this.state = await res.json();
    }

    applyTheme() {
      const s = this.state.settings;
      this.root.style.setProperty("--anka-primary", s.primary_color);
      this.root.style.setProperty("--anka-bg", s.background_color);
      this.root.style.setProperty("--anka-text", s.text_color);
    }

    nudgeText() {
      const s = this.state.settings;
      const balance = this.state.member?.balance ?? 0;
      return s.nudge_text.replace(/\{\{balance\}\}/g, fmt(balance));
    }

    toggle(open) {
      this.open = open ?? !this.open;
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
        const res = await fetch(`${PROXY_BASE}/redeem`, {
          method: "POST",
          credentials: "same-origin",
          body,
        });
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.error || "Kupon oluşturulamadı");
        }
        this.message = `Kupon kodunuz: ${data.code} (−${fmt(data.pointsDeducted)} puan)`;
        await this.refresh();
      } catch (err) {
        this.error = err instanceof Error ? err.message : "Bir hata oluştu";
      } finally {
        this.loading = false;
        this.render();
      }
    }

    renderEarnTab() {
      const ratio = this.state.pointsToDollarRatio || 100;
      const perDollar = this.state.pointsPerDollar || 1;
      const dollarValue =
        this.state.member?.balance != null
          ? this.state.member.balance / ratio
          : 0;

      return `
        <div class="anka-list">
          <div class="anka-card">
            <div class="anka-card-title">Her $1 = ${fmt(perDollar)} puan</div>
            <div class="anka-card-meta">Satın almalarınızdan otomatik kazanırsınız.</div>
          </div>
          <div class="anka-card">
            <div class="anka-card-title">Puan değeri</div>
            <div class="anka-card-meta">${fmt(ratio)} puan ≈ $1 indirim</div>
          </div>
          ${
            this.state.member
              ? `<div class="anka-card">
            <div class="anka-card-title">Tahmini değer</div>
            <div class="anka-card-meta">Bakiyeniz ≈ ${fmtMoney(dollarValue)}</div>
          </div>`
              : ""
          }
        </div>
      `;
    }

    renderSpendTab() {
      const member = this.state.member;
      if (!member) {
        return `<p class="anka-card-meta">Harca sekmesi için giriş yapın.</p>`;
      }

      if (member.redemptions.length === 0) {
        return `<p class="anka-card-meta">Henüz aktif kupon kademesi yok.</p>`;
      }

      return `
        <div class="anka-list">
          ${member.redemptions
            .map(
              (r) => `
            <div class="anka-card">
              <div class="anka-card-title">${r.name}</div>
              <div class="anka-card-meta">${fmt(r.points_cost)} puan</div>
              <button
                class="anka-btn"
                type="button"
                data-redeem="${r.id}"
                ${!r.canAfford || this.loading ? "disabled" : ""}
              >
                ${this.loading ? "Oluşturuluyor…" : "Kupon oluştur"}
              </button>
            </div>
          `,
            )
            .join("")}
        </div>
      `;
    }

    renderMemberPanel() {
      const m = this.state.member;
      const pos =
        this.state.settings.position === "bottom-left"
          ? "anka-pos-left"
          : "anka-pos-right";

      return `
        <div class="${pos}">
          <div class="anka-backdrop" data-close></div>
          <div class="anka-panel" role="dialog" aria-label="Sadakat programı">
            <div class="anka-panel-header">
              <h2 class="anka-panel-title">${this.state.settings.launcher_label}</h2>
              <button class="anka-close" type="button" data-close aria-label="Kapat">×</button>
            </div>
            <div class="anka-balance">
              <div class="anka-balance-value">${fmt(m.balance)}</div>
              <div class="anka-balance-label">puan</div>
            </div>
            ${
              m.tierName
                ? `<div class="anka-tier">
              <div class="anka-tier-name">${m.tierName}</div>
              <div class="anka-progress"><div class="anka-progress-fill" style="width:${m.progressPercent}%"></div></div>
              ${
                m.nextTierName
                  ? `<div class="anka-tier-hint">${fmtMoney(m.spendToNext)} daha harcayın → ${m.nextTierName}</div>`
                  : `<div class="anka-tier-hint">En üst seviyedesiniz 🎉</div>`
              }
            </div>`
                : ""
            }
            <div class="anka-tabs">
              <button class="anka-tab ${this.tab === "earn" ? "is-active" : ""}" type="button" data-tab="earn">Kazan</button>
              <button class="anka-tab ${this.tab === "spend" ? "is-active" : ""}" type="button" data-tab="spend">Harca</button>
            </div>
            <div class="anka-body">
              ${this.message ? `<div class="anka-success">${this.message}</div>` : ""}
              ${this.error ? `<div class="anka-error">${this.error}</div>` : ""}
              ${this.tab === "earn" ? this.renderEarnTab() : this.renderSpendTab()}
            </div>
          </div>
        </div>
      `;
    }

    renderGuestPanel() {
      const g = this.state.guest;
      const pos =
        this.state.settings.position === "bottom-left"
          ? "anka-pos-left"
          : "anka-pos-right";

      return `
        <div class="${pos}">
          <div class="anka-backdrop" data-close></div>
          <div class="anka-panel" role="dialog" aria-label="Sadakat programı">
            <div class="anka-panel-header">
              <h2 class="anka-panel-title">${this.state.settings.launcher_label}</h2>
              <button class="anka-close" type="button" data-close aria-label="Kapat">×</button>
            </div>
            <div class="anka-body anka-guest">
              <h3>${g.headline}</h3>
              <p>${g.body}</p>
              <a class="anka-btn" href="${g.registerUrl}">Hesap oluştur</a>
              <a class="anka-btn anka-btn-secondary" href="${g.loginUrl}">Giriş yap</a>
            </div>
          </div>
        </div>
      `;
    }

    render() {
      if (!this.state?.enabled || this.state.programPaused) {
        this.root.innerHTML = "";
        return;
      }

      this.applyTheme();
      const pos =
        this.state.settings.position === "bottom-left"
          ? "anka-pos-left"
          : "anka-pos-right";
      const showNudge =
        !this.open &&
        this.state.settings.nudge_enabled &&
        this.state.isMember &&
        (this.state.member?.balance ?? 0) > 0;

      this.root.className = `anka-root ${pos}`;
      this.root.innerHTML = `
        ${
          showNudge
            ? `<div class="anka-nudge" role="status">${this.nudgeText()}</div>`
            : ""
        }
        <button class="anka-launcher" type="button" data-toggle aria-expanded="${this.open}">
          ★ ${this.state.settings.launcher_label}
        </button>
        ${this.open ? (this.state.isMember ? this.renderMemberPanel() : this.renderGuestPanel()) : ""}
      `;

      this.root.querySelector("[data-toggle]")?.addEventListener("click", () =>
        this.toggle(true),
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
    const widget = new AnkaWidget(root);
    widget.init();
  });
})();
