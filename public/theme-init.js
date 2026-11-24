/* Runs before manifest is parsed so a new installation sees the chosen icon. */
(function () {
  var allowed = ['purple','orange','coral','mint','energy-green','aqua-blue'];
  var accent = 'purple';
  try { var stored = localStorage.getItem('relay.accent'); if (allowed.includes(stored)) accent = stored; } catch (_) {}
  document.documentElement.dataset.accent = accent;
  document.documentElement.dataset.accentReady = 'true';
  var manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) manifest.href = '/manifest-' + accent + '.webmanifest';
  var icon = document.querySelector('link[data-relay-icon]');
  if (icon) icon.href = '/icons/' + accent + '-32.png';
  var apple = document.querySelector('link[rel="apple-touch-icon"]');
  if (apple) apple.href = '/icons/' + accent + '-apple.png';
})();
