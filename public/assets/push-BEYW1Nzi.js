const VAPID_PUBLIC = "BAXWJq3g8zOOVLspWN9oGS0N15QpTsiRcZ2aa-0Bdv4V1WeM12mp9q9hgqORTlMKPO11-ATur-imxNDapUmJjy8";
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return reg;
  } catch {
    return null;
  }
}
async function subscribeToPush(token) {
  if (!("PushManager" in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
    });
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    await fetch("/api/push-subscribe", {
      method: "POST",
      headers,
      body: JSON.stringify({ subscription })
    });
    return true;
  } catch {
    return false;
  }
}
function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
async function requestPushPermission() {
  if (!isPushSupported()) return false;
  const perm = await Notification.requestPermission();
  return perm === "granted";
}
export {
  isPushSupported,
  registerServiceWorker,
  requestPushPermission,
  subscribeToPush
};
