(function () {
  const STORAGE_KEY = "anka_ref";
  const PROXY_CLAIM = "/apps/anka/referral-claim";

  function captureRefFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref) {
        localStorage.setItem(STORAGE_KEY, ref.trim());
      }
    } catch {
      /* ignore */
    }
  }

  function getStoredRef() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function clearStoredRef() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  async function tryClaimReferral() {
    const code = getStoredRef();
    if (!code) return;

    try {
      const body = new FormData();
      body.set("referral_code", code);
      const res = await fetch(PROXY_CLAIM, {
        method: "POST",
        credentials: "same-origin",
        body,
        headers: { Accept: "application/json" },
      });
      const data = await res.json();
      if (data.ok) {
        clearStoredRef();
        if (data.welcomeCode) {
          document.dispatchEvent(
            new CustomEvent("anka:referral-claimed", { detail: data }),
          );
        }
      }
    } catch {
      /* retry on next page load */
    }
  }

  captureRefFromUrl();
  document.addEventListener("DOMContentLoaded", tryClaimReferral);
})();
