function initAnalytics() {
  try {
    const key = void 0;
    if (!key || window.posthog) return;
    const script = document.createElement("script");
    script.src = "https://app.posthog.com/static/array.js";
    script.async = true;
    script.onload = () => {
      try {
        window.posthog?.init(key, {
          api_host: "https://app.posthog.com",
          capture_pageview: true,
          autocapture: false,
          persistence: "memory",
          loaded: (ph) => {
            ph.capture("$pageview");
          }
        });
      } catch {
      }
    };
    document.head.appendChild(script);
  } catch {
  }
}
function trackEvent(event, props) {
  try {
    window.posthog?.capture(event, props);
  } catch {
  }
}
function identifyUser(id, props) {
  try {
    window.posthog?.identify(id, props);
  } catch {
  }
}
function trackSearch(q, count, score) {
  trackEvent("product_searched", { query: q, result_count: count, deal_score: score });
}
function trackPrimeUpgrade(tier) {
  trackEvent("prime_upgrade_clicked", { tier });
}
function trackPurchase(q, price, store) {
  trackEvent("purchase_completed", { query: q, price, store });
}
export {
  identifyUser,
  initAnalytics,
  trackEvent,
  trackPrimeUpgrade,
  trackPurchase,
  trackSearch
};
