// What every demo app does before it renders, and nothing more: point formio.js
// at the demo's Form.io project and give it the visitor's guest token
// (js/guest.js). @formio/uag-js, loaded from the UAG with
// <script src="{UAG}/uag-js/uag.use.js">, has already registered itself; from
// here on the apps are ordinary formio.js code, as in any application.
//
// It also tells the example page around the frame when a call shows the demo
// cannot run: the UAG did not answer, or answered that Agentic Formflow needs a
// license (a local UAG only; the hosted project needs none).
(function () {
  var settings = document.documentElement.dataset;

  function tell(code, error) {
    if (window.parent !== window) window.parent.postMessage({ type: 'uag-demo', code: code, error: error }, location.origin);
  }

  window.addEventListener('uag-flow', function (event) {
    var e = event.detail || {};
    if (e.phase !== 'response') return;
    if (e.status === 0) tell('unavailable');
    else if (e.status === 403 && /"license_required"/.test(e.detail || '')) tell('license_required');
  });

  /** Opened on its own with no guest yet: send the visitor to the example page, which starts the demo. */
  function cover() {
    var name = (location.pathname.match(/\/apps\/([^/]+)/) || [])[1] || '';
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px;background:rgba(246,247,249,.97);font:15px/1.55 Inter,system-ui,sans-serif;color:#0c141d;text-align:center';
    box.innerHTML = '<div style="max-width:460px"><h2 style="margin:0 0 10px;font-size:22px">Start the demo first</h2>' +
      '<p style="color:#566073">This demo runs as a temporary guest of the demo\'s project. Start it from its example page, then open it full screen again.</p>' +
      '<p><a style="color:#5a9a39;font-weight:600" href="/examples/' + encodeURIComponent(name) + '">Go to the example</a></p></div>';
    document.body.appendChild(box);
  }

  window.DemoApp = {
    settings: settings,
    tell: tell,
    /** The URL of one of the demo project's forms, by its path. */
    formUrl: function (path) { return settings.projectUrl + '/' + path; },
    /** Set up formio.js for the visitor, or send them back to the example page to start the demo. */
    ready: function () {
      var token = window.UAGDemoGuest && window.UAGDemoGuest.token();
      if (!token) {
        if (window.parent !== window) tell('guest_expired');
        else cover();
        return Promise.reject(new Error('Start the demo from its example page.'));
      }
      // For the flow log only: formio.js makes its own requests with a bundled fetch,
      // which js/flow-log.js would not see. An application needs nothing like this.
      Formio.fetch = function (url, options) { return window.fetch(url, options); };
      Formio.setBaseUrl(settings.formioBaseUrl);
      Formio.setProjectUrl(settings.projectUrl);
      Formio.setToken(token);
      return Promise.resolve(token);
    },
  };
})();
