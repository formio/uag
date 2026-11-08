// The demo's visitor: a guest user of the demo's Form.io project, registered on
// its `guestRegister` form when the visitor starts a demo, never on page load.
// The token Form.io returns is an ordinary Form.io user token: the demo apps give
// it to formio.js (Formio.setToken), and formio.js and @formio/uag-js send it to
// the UAG, exactly as an application sends its signed-in users' tokens.
//
// Registration goes through the UAG, which forwards it to the project, as it
// forwards every other save. Guests and what they submit are deleted after a day.
//
// Settings come from data attributes the build writes on <html> or <body>:
// data-uag-url, data-uag-project-url, data-project-url.
(function () {
  if (window.UAGDemoGuest) return;
  // Where the guest is kept in localStorage.
  var STORED_AS = 'uag-demo-guest';
  // A token this close to expiring is not used: a demo started now would fail part way.
  var MARGIN_MS = 5 * 60 * 1000;

  function settings() {
    var el = document.documentElement.dataset.uagUrl ? document.documentElement : document.body || document.documentElement;
    return el.dataset || {};
  }

  function read() {
    try {
      var guest = JSON.parse(localStorage.getItem(STORED_AS) || 'null');
      if (guest && guest.token && guest.expires > Date.now() + MARGIN_MS) return guest;
    }
    catch (e) { /* storage unavailable */ }
    return null;
  }

  function save(guest) {
    try { localStorage.setItem(STORED_AS, JSON.stringify(guest)); } catch (e) { /* storage unavailable */ }
  }

  /** When a Form.io token expires, from its `exp` claim; an hour from now if it cannot be read. */
  function expiresOf(token) {
    try {
      var payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var exp = JSON.parse(atob(payload)).exp;
      if (exp) return exp * 1000;
    }
    catch (e) { /* not a JWT */ }
    return Date.now() + 60 * 60 * 1000;
  }

  function random(bytes) {
    var values = new Uint8Array(bytes);
    crypto.getRandomValues(values);
    return Array.prototype.map.call(values, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  var pending = null;

  /** The guest's token, registering a guest first if there is none. */
  function start() {
    var guest = read();
    if (guest) return Promise.resolve(guest.token);
    if (pending) return pending;
    var project = settings().uagProjectUrl;
    var data = { email: 'guest-' + random(12) + '@guest.invalid', password: random(24) };
    var send = window.UAGFlowLog ? window.UAGFlowLog.fetch : window.fetch.bind(window);
    pending = send(project + '/guest/register/submission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: data }),
    }, { label: 'Register a guest through the UAG' }).then(function (response) {
      var token = response.headers.get('x-jwt-token');
      if (!response.ok || !token) throw new Error('Registration answered ' + response.status + '.');
      save({ token: token, expires: expiresOf(token) });
      return token;
    }).finally(function () { pending = null; });
    return pending;
  }

  function clear() {
    try { localStorage.removeItem(STORED_AS); } catch (e) { /* storage unavailable */ }
    if (window.Formio && typeof window.Formio.setToken === 'function') {
      try { window.Formio.setToken(null); } catch (e) { /* formio.js not ready */ }
    }
  }

  // A token the UAG refuses has expired (or the guest was deleted): forget it, and
  // tell the example page around this frame, which offers to start again.
  window.addEventListener('uag-flow', function (event) {
    var e = event.detail || {};
    if (e.phase !== 'response' || e.kind === 'auth' || (e.status !== 401 && e.status !== 440)) return;
    if (!read()) return;
    clear();
    if (window.parent !== window) window.parent.postMessage({ type: 'uag-demo', code: 'guest_expired' }, location.origin);
  });

  window.UAGDemoGuest = {
    settings: settings,
    token: function () { var guest = read(); return guest ? guest.token : null; },
    start: start,
    clear: clear,
  };
})();
