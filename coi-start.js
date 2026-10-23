(function () {
  if (window.crossOriginIsolated || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  var KEY = 'griplock.coi-reload', once;
  try { once = sessionStorage.getItem(KEY); } catch (e) { return; }
  if (once) return;
  var reload = function () { try { sessionStorage.setItem(KEY, '1'); } catch (e) { return; } location.reload(); };
  navigator.serviceWorker.register('./coi-sw.js').then(function () {
    if (navigator.serviceWorker.controller) reload();
    else navigator.serviceWorker.addEventListener('controllerchange', reload);
  }).catch(function () {});
})();
