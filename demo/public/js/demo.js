// The live demo frame on each example page. The demo starts when the visitor
// asks for it ("Start the live demo"), which registers them as a guest of the
// demo's project (js/guest.js); a visitor who is already a guest goes straight
// in. The flow log beside the frame shows every call the demo makes
// (js/flow-log.js, js/flow-panel.js).
(function () {
  var frame = document.querySelector('[data-demo-frame]');
  if (!frame) return;
  var gate = document.querySelector('[data-demo-gate]');
  var start = document.querySelector('[data-demo-start]');
  var notice = document.querySelector('[data-demo-notice]');
  var unsupported = document.querySelector('[data-demo-unsupported]');
  var license = document.querySelector('[data-license-notice]');
  var production = (document.body.dataset.production || '') === 'true';

  function say(text) {
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
  }

  function load() {
    if (gate) gate.hidden = true;
    frame.hidden = false;
    if (!frame.src) frame.src = frame.getAttribute('data-src');
  }

  function showGate() {
    frame.hidden = true;
    frame.removeAttribute('src');
    if (gate) gate.hidden = false;
    if (start) {
      start.disabled = false;
      start.textContent = start.getAttribute('data-label') || start.textContent;
    }
  }

  // Messages from the demo apps: what the visitor should see outside the frame.
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data || event.data.type !== 'uag-demo') return;
    var code = event.data.code;
    if (code === 'guest_expired') {
      showGate();
      say('Your guest session ended. Start the demo again to continue.');
    }
    else if (code === 'license_required') {
      // Only a UAG run on your own machine, without a license or a hosted project.
      if (unsupported) unsupported.hidden = false;
      frame.hidden = true;
      if (license && !production) license.hidden = false;
    }
    else if (code === 'unavailable') {
      say(production
        ? 'The live demo is temporarily unavailable. Please try again in a few minutes.'
        : 'No UAG answered at ' + (document.body.dataset.uagUrl || 'the configured URL') + '. Start one, or build the site with DEMO_UAG_URL pointing at yours.');
    }
    else if (event.data.error) {
      say(event.data.error);
    }
  });

  var flow = document.querySelector('[data-flow]');
  if (flow && window.UAGFlow) {
    window.UAGFlow.mount(flow, {
      title: flow.getAttribute('data-title') || undefined,
      intro: flow.getAttribute('data-intro') || undefined,
      introInside: flow.getAttribute('data-intro-inside') || undefined,
      empty: flow.getAttribute('data-empty') || undefined,
      emptyInside: flow.getAttribute('data-empty-inside') || undefined,
    });
  }

  if (window.UAGDemoGuest && window.UAGDemoGuest.token()) {
    load();
    return;
  }
  showGate();
  if (!start) return;
  start.setAttribute('data-label', start.textContent);
  start.addEventListener('click', function () {
    start.disabled = true;
    start.textContent = 'Starting…';
    if (notice) notice.hidden = true;
    window.UAGDemoGuest.start().then(load, function () {
      showGate();
      say(production
        ? 'The live demo could not start. Please try again in a few minutes.'
        : 'Could not register a guest at ' + (document.body.dataset.projectUrl || 'the project') + '. Import module/project.json into it (it has the guestRegister form), and check the project URL the site was built with.');
    });
  });
})();
