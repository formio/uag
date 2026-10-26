// For the Agentic Formflow demo apps opened on their own: when this deployment
// cannot run Agentic Formflow (an Open Source project, or an unlicensed UAG),
// say so over the page instead of letting the demo fail part way.
(function () {
  fetch('/api/status').then(function (response) { return response.json(); }).then(function (status) {
    if (!status.formflow || status.formflow.supported) return;
    var cover = document.createElement('div');
    cover.setAttribute('role', 'alert');
    cover.style.cssText = 'position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px;background:rgba(246,247,249,.97);font:15px/1.55 Inter,system-ui,sans-serif;color:#0c141d;text-align:center';
    cover.innerHTML = '<div style="max-width:460px">' +
      '<h2 style="margin:0 0 10px;font-size:22px">Not supported without a license or SaaS project</h2>' +
      '<p style="color:#566073">This demo uses Agentic Formflow, which needs a license (<code>LICENSE_KEY</code>) that includes the UAG, or a project on Form.io\'s hosted service. Conversation forms work everywhere, with no license.</p>' +
      '<p><a href="/getting-started" target="_top" style="color:#5a9a39;font-weight:600">Try it on a hosted project</a> &nbsp;·&nbsp; <a href="/contact" target="_top" style="color:#5a9a39;font-weight:600">Ask for a license</a></p>' +
      '</div>';
    document.body.appendChild(cover);
  }).catch(function () {});
})();
