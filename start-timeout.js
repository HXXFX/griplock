setTimeout(function () {
  if (window.__app && window.__app.ready) return;
  var p = document.getElementById('cover-phase');
  if (!p) return;
  p.textContent = 'The app did not start.';
  document.getElementById('cover-pct').innerHTML = 'It needs an internet connection for its 3D drawing library (three.js), and must be opened from ' +
    'a web server, not as a file. Press F12 for the error.';
}, 20000);
