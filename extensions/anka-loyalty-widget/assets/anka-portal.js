(function () {
  const PROXY = "/apps/anka/portal";

  const MOVEMENT_LABELS = {
    earn: "Earned",
    redeem: "Redeemed",
    refund_reversal: "Refund",
    cancel_reversal: "Cancelled order",
    expired: "Expired",
    manual: "Adjustment",
  };

  class AnkaPortal {
    constructor(root) {
      this.root = root;
      this.locale = root.dataset.locale || "en";
      this.currency = root.dataset.currency || "USD";
      this.data = null;
    }

    fmt(n) {
      return new Intl.NumberFormat(this.locale).format(n);
    }

    fmtDate(iso) {
      if (!iso) return "—";
      try {
        return new Intl.DateTimeFormat(this.locale, {
          dateStyle: "medium",
        }).format(new Date(iso));
      } catch {
        return iso;
      }
    }

    fmtMoney(n) {
      try {
        return new Intl.NumberFormat(this.locale, {
          style: "currency",
          currency: this.currency,
          maximumFractionDigits: 0,
        }).format(n);
      } catch {
        return "$" + Math.round(n);
      }
    }

    applyTheme(settings) {
      this.root.style.setProperty("--anka-primary", settings.primary_color);
      this.root.style.setProperty("--anka-bg", settings.background_color);
      this.root.style.setProperty("--anka-text", settings.text_color);
      this.root.style.setProperty(
        "--anka-surface",
        `color-mix(in srgb, ${settings.background_color} 90%, #000)`,
      );
    }

    async init() {
      this.root.innerHTML =
        '<div class="anka-portal-loading">Loading your rewards…</div>';
      try {
        const params = new URLSearchParams({
          locale: this.locale,
          currency: this.currency,
        });
        const res = await fetch(`${PROXY}?${params}`, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const data = await res.json();
        if (!data.ok) {
          this.renderGuest(data.error || "Sign in to view rewards.");
          return;
        }
        this.data = data;
        this.applyTheme(data.widget.settings);
        this.render();
      } catch {
        this.renderGuest("Could not load rewards. Try again later.");
      }
    }

    renderGuest(message) {
      this.root.innerHTML = `
        <div class="anka-portal-card anka-portal-guest">
          <h2>My Rewards</h2>
          <p>${message}</p>
          <a class="anka-portal-btn" href="/account/login">Sign in</a>
        </div>`;
    }

    tierHint(member) {
      const c = this.data.widget.copy;
      if (!member.nextTierName) return c.top_tier;
      return c.spend_to_next
        .replace("{{amount}}", this.fmtMoney(member.spendToNext))
        .replace("{{tier}}", member.nextTierName);
    }

    render() {
      const { widget, member, ledger, coupons, referral } = this.data;
      const m = widget.member;
      const c = widget.copy;

      this.root.innerHTML = `
        <div class="anka-portal">
          <header class="anka-portal-hero">
            <p class="anka-portal-eyebrow">${c.launcher_label}</p>
            <div class="anka-portal-balance">${this.fmt(m.balance)}</div>
            <p class="anka-portal-balance-label">${c.points_label}</p>
            ${
              m.tierName
                ? `<div class="anka-portal-tier">
                <span class="anka-portal-tier-name">${m.tierName}</span>
                <div class="anka-portal-progress"><div style="width:${m.progressPercent}%"></div></div>
                <p class="anka-portal-tier-hint">${this.tierHint(m)}</p>
              </div>`
                : ""
            }
          </header>

          <section class="anka-portal-section">
            <h3>Your coupons</h3>
            ${
              coupons.length === 0
                ? `<p class="anka-portal-muted">Redeem points from the store widget to create coupons.</p>`
                : `<ul class="anka-portal-coupons">
                ${coupons
                  .map(
                    (cp) => `
                  <li>
                    <div>
                      <strong>${cp.label}</strong>
                      <span class="anka-portal-code">${cp.code}</span>
                    </div>
                    <span class="anka-portal-muted">${this.fmtDate(cp.createdAt)} · −${this.fmt(cp.points)} pts</span>
                  </li>`,
                  )
                  .join("")}
              </ul>`
            }
          </section>

          <section class="anka-portal-section">
            <h3>Points history</h3>
            <ul class="anka-portal-ledger">
              ${ledger
                .slice(0, 30)
                .map(
                  (row) => `
                <li>
                  <div class="anka-portal-ledger-main">
                    <span class="anka-portal-ledger-type">${MOVEMENT_LABELS[row.movementType] || row.movementType}</span>
                    <span class="anka-portal-ledger-desc">${row.description || ""}</span>
                  </div>
                  <div class="anka-portal-ledger-meta">
                    <span class="anka-portal-ledger-points ${row.points >= 0 ? "is-positive" : "is-negative"}">
                      ${row.points >= 0 ? "+" : ""}${this.fmt(row.points)}
                    </span>
                    <span class="anka-portal-muted">${this.fmtDate(row.createdAt)}</span>
                  </div>
                </li>`,
                )
                .join("")}
            </ul>
          </section>

          <section class="anka-portal-section anka-portal-referral">
            <h3>Refer a friend</h3>
            <p class="anka-portal-muted">${referral.message}</p>
          </section>

          <footer class="anka-portal-stats">
            <div><span>Member since</span><strong>${this.fmtDate(member.memberSince)}</strong></div>
            <div><span>Orders</span><strong>${this.fmt(member.orderCount)}</strong></div>
            <div><span>Total spend</span><strong>${this.fmtMoney(member.totalSpend)}</strong></div>
          </footer>
        </div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("anka-portal-root");
    if (!root) return;
    new AnkaPortal(root).init();
  });
})();
