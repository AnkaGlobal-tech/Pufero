(function () {
  const PROXY = "/apps/loyalty/referral-landing";

  class AnkaReferralLanding {
    constructor(root) {
      this.root = root;
    }

    applyTheme(settings) {
      if (!settings) return;
      this.root.style.setProperty("--anka-primary", settings.primaryColor);
      this.root.style.setProperty("--anka-bg", settings.backgroundColor);
      this.root.style.setProperty("--anka-text", settings.textColor);
      this.root.style.setProperty(
        "--anka-surface",
        `color-mix(in srgb, ${settings.backgroundColor} 88%, #fff)`,
      );
    }

    refFromUrl() {
      return new URLSearchParams(window.location.search).get("ref") || "";
    }

    async init() {
      const ref = this.refFromUrl();
      this.root.innerHTML =
        '<div class="anka-ref-loading">Loading referral offer…</div>';

      if (!ref) {
        this.renderInvalid("This referral link is missing a code.");
        return;
      }

      try {
        const res = await fetch(
          `${PROXY}?${new URLSearchParams({ ref })}`,
          { credentials: "same-origin", headers: { Accept: "application/json" } },
        );
        const data = await res.json();
        if (!data.ok) {
          this.renderInvalid(data.error || "Invalid referral link.");
          return;
        }
        this.applyTheme(data.settings);
        this.render(data, ref);
      } catch {
        this.renderInvalid("Could not load referral offer. Try again later.");
      }
    }

    renderInvalid(message) {
      this.root.innerHTML = `
        <div class="anka-ref-card">
          <h1>Referral link</h1>
          <p class="anka-ref-muted">${message}</p>
          <a class="anka-ref-btn" href="/">Continue shopping</a>
        </div>`;
    }

    render(data, ref) {
      if (data.programPaused || !data.valid) {
        this.renderInvalid("This referral link is no longer valid.");
        return;
      }

      const name = data.referrerFirstName
        ? `${data.referrerFirstName} invited you`
        : "You were invited";

      this.root.innerHTML = `
        <div class="anka-ref-card">
          <p class="anka-ref-eyebrow">Referral reward</p>
          <h1>${name}</h1>
          <p class="anka-ref-lead">
            Create an account and get
            <strong>${data.refereeDiscountPercent}% off</strong> your first order.
          </p>
          <div class="anka-ref-perks">
            <div>
              <span>For you</span>
              <strong>${data.refereeDiscountPercent}% off</strong>
            </div>
            <div>
              <span>For your friend</span>
              <strong>+${data.referrerRewardPoints} pts</strong>
            </div>
          </div>
          <a class="anka-ref-btn" href="/account/register?ref=${encodeURIComponent(ref)}">Create account</a>
          <p class="anka-ref-muted anka-ref-foot">
            Already have an account?
            <a href="/account/login?ref=${encodeURIComponent(ref)}">Sign in</a>
            to claim your discount.
          </p>
        </div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("anka-referral-root");
    if (!root) return;
    new AnkaReferralLanding(root).init();
  });
})();
