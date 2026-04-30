function initSentry() {
  return;
}
function reportError(err, context) {
  try {
    console.error("[SmartScan Error]", err, context);
  } catch {
  }
}
export {
  initSentry,
  reportError
};
