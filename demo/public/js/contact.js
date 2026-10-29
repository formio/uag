// The Contact Us form: a form hosted on Form.io, rendered here with formio.js.
// Its URL comes from CONTACT_FORM_URL, so the sales team can move it without a code change.
(function () {
  var script = document.currentScript;
  var url = script && script.getAttribute('data-form');
  var target = document.getElementById('contact-form');
  var done = document.querySelector('[data-contact-done]');
  if (!url || !target || !window.Formio) return;
  Formio.createForm(target, url, { noAlerts: false }).then(function (form) {
    form.on('submitDone', function () {
      target.hidden = true;
      done.hidden = false;
    });
  }).catch(function () {
    target.innerHTML = '<p class="form-loading">The form could not be loaded. Please email <a href="mailto:support@form.io">support@form.io</a>.</p>';
  });
})();
