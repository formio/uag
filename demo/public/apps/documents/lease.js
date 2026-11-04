/**
 * Harbor Lane lease review: renders the `leaseReview` form with the AI
 * Document component from @formio/uag-js, and shows what each AI Document is
 * doing as the UAG processes the uploaded lease.
 *
 * The component is registered with this site as its "UAG" (/api/documents/uag):
 * the site relays its calls to the UAG behind the demo's budget and bot check.
 * An application of your own registers the UAG's URL instead.
 */
(async function () {
  const $ = (selector) => document.querySelector(selector);

  // Formio.use(UAG(url)) registers the AI Document component; it reads the
  // installed plugins from {url}/plugins and processes at {url}/.../document/process.
  Formio.use(FormioUAG.UAG(location.origin + '/api/documents/uag', { agentInput: false, fetch: demoFetch }));

  const LABELS = { leaseClauses: 'Key clauses', leaseSummary: 'Summary' };
  const definitionLoaded = fetch('/api/documents/form').then((response) => response.json());
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
      line(event.path, (event.path === 'leaseClauses' ? 'Copied and checked against the lease: ' : 'Written: ') + words + ' words', 'ok', took);
    }
  });

  form.on('uagDocumentError', (event) => {
    line(event.path, event.error || 'Processing failed.', 'error');
  });

  /* ---------- Save ---------- */

  const submitError = $('[data-submit-error]');

  form.on('submit', async (submission) => {
    submitError.hidden = true;
    try {
      const response = await demoFetch('/api/documents/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: submission.data })
      });
      const saved = await response.json();
      if (!response.ok) throw new Error(describeFailure(response.status, saved));
      form.emit('submitDone', submission);
      showConfirmation(saved);
    }
    catch (err) {
      form.emit('submitError', err);
      submitError.textContent = err.message;
      submitError.hidden = false;
    }
  });

  function describeFailure(status, body) {
    const details = (body && body.details) || [];
    if (details.length) return 'The review was not saved. ' + details.map((detail) => detail.message).join(' ');
    return 'The review was not saved (' + ((body && body.error) || 'the server answered ' + status) + ').';
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

  /* ---------- The demo's limits ---------- */

  // The site answers 403 (not verified), 429 (too fast) and 503 (the day's budget is spent)
  // with a code the page around this frame turns into a message.
  async function demoFetch(url, init) {
    const response = await fetch(url, init);
    if ([403, 429, 503].includes(response.status) && window.parent !== window) {
      response.clone().json().then((body) => {
        if (body && body.code) window.parent.postMessage({ type: 'uag-demo', code: body.code, error: body.error }, location.origin);
      }).catch(() => {});
    }
    return response;
  }
})();
