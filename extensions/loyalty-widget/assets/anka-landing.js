(function () {
  const PROXY = "/apps/loyalty/landing";

  class AnkaLanding {
    constructor(root) {
      this.root = root;
      this.locale = root.dataset.locale || "en";
    }

    fmt(n) {
      return new Intl.NumberFormat(this.locale).format(n);
    }

    fmtMoney(n) {
      try {
        return new Intl.NumberFormat(this.locale, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(n);
      } catch {
        return "$" + Math.round(n);
      }
    }

    applyTheme(settings) {
      this.root.style.setProperty("--anka-primary", settings.primaryColor);
      this.root.style.setProperty("--anka-bg", settings.backgroundColor);
      this.root.style.setProperty("--anka-text", settings.textColor);
      this.root.style.setProperty(
        "--anka-surface",
        `color-mix(in srgb, ${settings.backgroundColor} 88%, #000)`,
      );
    }

    async init() {
      this.root.innerHTML =
        '<div class="anka-landing-loading">Loading rewards program…</div>';
      try {
        const res = await fetch(PROXY, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const data = await res.json();
        if (!data.ok) {
          this.root.innerHTML = `<p class="anka-landing-error">${data.error || "Unavailable"}</p>`;
          return;
        }
        this.data = data;
        this.applyTheme(data.settings);
        this.render();
      } catch {
        this.root.innerHTML =
          '<p class="anka-landing-error">Could not load program details.</p>';
      }
    }

    render() {
      const { pointsPerDollar, pointsToDollarRatio, tiers, faq, programPaused } =
        this.data;

      this.root.innerHTML = `
        <div class="anka-landing">
          <header class="anka-landing-hero">
            <h2>Loyalty Rewards</h2>
            ${
              programPaused
                ? `<p class="anka-landing-paused">The rewards program is temporarily paused.</p>`
                : `<p>Earn <strong>${this.fmt(pointsPerDollar)}</strong> points per $1 spent.
                   Redeem <strong>${this.fmt(pointsToDollarRatio)}</strong> points for $1 off.</p>`
            }
          </header>

          ${
            tiers.length > 0
              ? `<section class="anka-landing-section">
            <h3>VIP tiers</h3>
            <div class="anka-landing-table-wrap">
              <table class="anka-landing-table">
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Spend threshold</th>
                    <th>Discount</th>
                    <th>Points multiplier</th>
                  </tr>
                </thead>
                <tbody>
                  ${tiers
                    .map(
                      (t) => `
                    <tr>
                      <td><strong>${t.name}</strong></td>
                      <td>${this.fmtMoney(t.thresholdSpend)}+</td>
                      <td>${t.discountPercent ? t.discountPercent + "%" : "—"}</td>
                      <td>${t.pointsMultiplier}x</td>
                    </tr>`,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </section>`
              : ""
          }

          <section class="anka-landing-section">
            <h3>FAQ</h3>
            <div class="anka-landing-faq">
              ${faq
                .map(
                  (item) => `
                <details class="anka-landing-faq-item">
                  <summary>${item.question}</summary>
                  <p>${item.answer}</p>
                </details>`,
                )
                .join("")}
            </div>
          </section>
        </div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("anka-landing-root");
    if (!root) return;
    new AnkaLanding(root).init();
  });
})();
