// The live demo frame on each example page: shows the human check when the
// deployment uses Turnstile, says so when today's demo budget is spent, and
// otherwise loads the demo app into its frame.
(function () {
  var frame = document.querySelector('[data-demo-frame]');
  if (!frame) return;
  var gate = document.querySelector('[data-demo-gate]');
  var notice = document.querySelector('[data-demo-notice]');
  var widget = document.querySelector('[data-turnstile]');
  var unsupported = document.querySelector('[data-demo-unsupported]');

  function load() {
    if (gate) gate.hidden = true;
    frame.hidden = false;
    if (!frame.src) frame.src = frame.getAttribute('data-src');
  }

  function say(text) {
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
  }

  // Messages from the demo apps: errors the visitor should see outside the frame.
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data || event.data.type !== 'uag-demo') return;
    if (event.data.code === 'verification_required') location.reload();
    else if (event.data.code === 'budget_exhausted') say(event.data.error);
  });

  // The flow viewer opens only once /api/status has answered: that request starts
  // the visitor's session, so the stream and the demo share it. Opened at the same
  // moment, two cookieless requests would start two sessions.
  var flowMounted = false;
  function mountFlow() {
    var flow = document.querySelector('[data-flow]');
    if (flowMounted || !flow || !window.UAGFlow) return;
    flowMounted = true;
    window.UAGFlow.mount(flow, {
      intro: flow.getAttribute('data-intro') || undefined,
      empty: flow.getAttribute('data-empty') || undefined,
      scopes: (flow.getAttribute('data-scopes') || '').split(',').filter(Boolean),
    });
  }

  fetch('/api/status').then(function (response) {
    return response.json().then(function (status) { return { ok: response.ok, status: status }; });
  }).then(function (answer) {
    var status = answer.status;
    // Refused (too many new visitors from one network): say why, and start nothing that would be refused too.
    if (!answer.ok) {
      say(status.error || 'The live demo is not available right now. Please try again in a few minutes.');
      return;
    }
    mountFlow();
    // The workflow and formflow demos need Agentic Formflow: a license or a hosted project.
    if (frame.getAttribute('data-requires') === 'formflow' && status.formflow && !status.formflow.supported) {
      if (unsupported) unsupported.hidden = false;
      return;
    }
    if (!status.available) {
      say('The live demo has reached its limit for today and resets at midnight UTC. You can still read how it works below, or run the UAG yourself.');
    }
    if (!status.turnstileSiteKey || status.verified) return load();
    gate.hidden = false;
    window.onTurnstileLoad = function () {
      window.turnstile.render(widget, {
        sitekey: status.turnstileSiteKey,
        callback: function (token) {
          fetch('/api/session/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token }),
          }).then(function (response) {
            if (response.ok) load();
            else say('We could not confirm that. Please reload the page and try again.');
          });
        },
      });
    };
    var script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
    script.async = true;
    document.head.appendChild(script);
  }).catch(function () { mountFlow(); load(); });

})();
