/**
 * Harbor Lane lease review: renders the `leaseReview` form with the AI
 * Document component from @formio/uag-js, and shows what each AI Document is
 * doing as the UAG processes the uploaded lease.
 *
 * The component comes with @formio/uag-js from the UAG (/uag-js/uag.use.js
 * registers it with the UAG's ai-document module), and processes each upload at
 * the UAG's `{form}/document/process` with the visitor's Form.io token, as in
 * any application.
 */
(async function () {
  const $ = (selector) => document.querySelector(selector);
  await DemoApp.ready();

  const LABELS = { leaseClauses: 'Key clauses', leaseSummary: 'Summary', leaseTranslation: 'Translation' };
  const formio = new Formio(DemoApp.formUrl('lease-review'));
  const definitionLoaded = formio.loadForm();
  let builder = null;

  // The tabs work while the form is still loading.
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.getAttribute('data-tab');
      document.querySelectorAll('[data-tab]').forEach((other) => {
        const selected = other === tab;
        other.setAttribute('aria-selected', String(selected));
        other.tabIndex = selected ? 0 : -1;
      });
      document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.getAttribute('data-panel') !== name; });
      if (name === 'build') showBuilder().catch((err) => { $('#builder').textContent = 'The builder could not load: ' + err.message; });
    });
  });

  const definition = await definitionLoaded;
  const form = await Formio.createForm($('#lease'), definition, {
    noAlerts: true,
    buttonSettings: { showCancel: false }
  });
  form.nosubmit = true;

  /* ---------- What the AI did ---------- */

  const activity = $('[data-activity]');
  const lines = new Map();

  function line(path, text, state, detail) {
    let item = lines.get(path);
    if (!item) {
      item = document.createElement('li');
      item.innerHTML = '<span class="activity-icon" aria-hidden="true"></span><span class="activity-text"><strong></strong><span></span><small></small></span>';
      activity.append(item);
      lines.set(path, item);
    }
    item.className = 'is-' + state;
    item.querySelector('strong').textContent = LABELS[path] || path;
    item.querySelector('.activity-text > span').textContent = text;
    item.querySelector('small').textContent = detail || '';
    $('[data-activity-empty]').hidden = true;
  }

  const started = new Map();

  form.on('uagDocumentStart', (event) => {
    started.set(event.path, performance.now());
    const file = (event.files || [])[0];
    line(event.path, 'Sending ' + ((file && (file.originalName || file.name)) || 'the lease') + ' to the UAG', 'running');
  });

  form.on('uagDocumentProgress', (event) => {
    const percent = Math.round((event.progress || 0) * 100);
    line(event.path, event.message || 'Working', 'running', percent ? percent + '%' : '');
  });

  form.on('uagDocumentResult', (event) => {
    const result = event.result || {};
    const took = started.has(event.path) ? ((performance.now() - started.get(event.path)) / 1000).toFixed(1) + 's' : '';
    const words = String(result.content || '').split(/\s+/).filter(Boolean).length;
    if (result.status === 'flagged') {
      const issues = (result.issues || []).length;
      line(event.path, 'Flagged: ' + (issues === 1 ? '1 difference' : issues + ' differences') + ' from the lease. Check it against the lease.', 'warn', took);
    }
    else {
      const done = { leaseClauses: 'Copied and checked against the lease: ', leaseTranslation: 'Translated into Spanish: ' }[event.path] || 'Written: ';
      line(event.path, done + words + ' words', 'ok', took);
    }
  });

  form.on('uagDocumentError', (event) => {
    const missing = /not installed|no such (plugin|process)|unknown (plugin|process)/i.test(event.error || '');
    line(event.path, missing
      ? 'This UAG does not have the AI Document process installed (the formio/uag-documents add-on, or UAG_PLUGINS).'
      : (event.error || 'Processing failed.'), 'error');
  });

  /* ---------- Save ---------- */

  const submitError = $('[data-submit-error]');

  form.on('submit', async (submission) => {
    submitError.hidden = true;
    try {
      // Saved through the UAG, like every save of a form tagged `uag`.
      const saved = await formio.saveSubmission({ data: submission.data });
      form.emit('submitDone', submission);
      showConfirmation(saved);
    }
    catch (err) {
      form.emit('submitError', err);
      submitError.textContent = describeFailure(err);
      submitError.hidden = false;
    }
  });

  function describeFailure(err) {
    const details = (err && err.details) || [];
    if (details.length) return 'The review was not saved. ' + details.map((detail) => detail.message).join(' ');
    return 'The review was not saved (' + ((err && (err.message || err.error)) || err || 'no answer') + ').';
  }

  /** The saved submission, with each file's base64 content shortened. */
  function shown(data) {
    return JSON.stringify(data, (key, value) => {
      if (key === 'url' && typeof value === 'string' && value.startsWith('data:')) return value.slice(0, 48) + '… (' + Math.round(value.length / 1024) + ' KB)';
      if (key === 'content' && typeof value === 'string' && value.length > 400) return value.slice(0, 400) + '…';
      return value;
    }, 2);
  }

  function showConfirmation(saved) {
    $('[data-intake]').hidden = true;
    $('[data-review-number]').textContent = 'HL-' + String(saved._id || '').slice(-6).toUpperCase();
    $('[data-saved]').textContent = shown(saved.data || form.data);
    $('[data-confirmation]').hidden = false;
    $('[data-confirmation-title]').focus();
  }

  /* ---------- Build ---------- */

  async function showBuilder() {
    if (builder) return;
    const definition = await definitionLoaded;
    // The AI Document's settings list the plugins installed on the UAG.
    await FormioUAG.UAG.ready;
    const target = $('#builder');
    target.innerHTML = '';
    builder = await Formio.builder(target, JSON.parse(JSON.stringify(definition)), {
      builder: {
        basic: { default: false },
        advanced: false,
        data: false,
        premium: { default: true }
      },
      noDefaultSubmitButton: true
    });
  }

})();
