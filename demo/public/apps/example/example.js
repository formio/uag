/**
 * One feature example, live: renders the example's form from the demo project
 * through the UAG, as the "Page code" on the example's page does, in one of three
 * modes (from the frame's URL: ?form=<path>&mode=form|workflow|chat):
 *
 * - form: the form, with Agent Input filling it from its description field.
 * - workflow: the form; after the save, the submission is read back until the
 *   form's Agent: Run task action has saved the task's fields.
 * - chat: the form as a chat (Formio.createChat).
 *
 * The example page's sample buttons post their text here; it goes into the
 * task's input, and Agent Input reads it.
 */
(async function () {
  const params = new URLSearchParams(location.search);
  const path = params.get('form') || '';
  const mode = params.get('mode') || 'form';
  const $ = (selector) => document.querySelector(selector);
  const root = $('[data-example-root]');
  const status = $('[data-status]');
  const POLL_MS = 2000;
  const POLL_LIMIT_MS = 120000;
  let poller = null;

  if (!/^example-[a-z0-9-]+$/.test(path) || !['form', 'workflow', 'chat'].includes(mode)) {
    root.textContent = 'This example is not available.';
    return;
  }
  await DemoApp.ready();

  function show(title, lede, body) {
    $('[data-status-title]').textContent = title;
    $('[data-status-lede]').textContent = lede || '';
    $('[data-status-body]').textContent = body ? JSON.stringify(body, null, 2) : '';
    status.hidden = false;
  }

  /** The saved data, without the button. */
  function saved(data) {
    const copy = { ...(data || {}) };
    delete copy.submit;
    return copy;
  }

  /** Every component of a form definition, nested ones included. */
  function components(list, out = []) {
    for (const component of list || []) {
      out.push(component);
      components(component.components, out);
      (component.columns || []).forEach((column) => components(column.components, out));
    }
    return out;
  }

  let form;
  let agent = null;
  try {
    if (mode === 'chat') {
      form = await Formio.createChat(root, DemoApp.formUrl(path), {
        noAlerts: true,
        markdown: (text) => (window.marked ? window.marked.parse(text, { breaks: true, gfm: true }) : text),
      });
    }
    else {
      form = await Formio.createForm(root, DemoApp.formUrl(path), { noAlerts: true, buttonSettings: { showCancel: false } });
      // Attached by hand, as the automatic attachment is, but with a controller the
      // sample buttons can call.
      if (mode === 'form') agent = FormioUAG.UAG.attach(form, {});
    }
  }
  catch (error) {
    DemoApp.tell('error', 'The example\'s form could not be loaded: ' + (error && error.message ? error.message : error));
    return;
  }

  // The example's own page code, when it has some (its page.js): the same code its page shows.
  if (params.get('page') === '1') {
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'pages/' + path.replace(/^example-/, '') + '.js?v=' + (document.documentElement.dataset.assetVersion || '');
      script.onload = resolve;
      script.onerror = resolve;
      document.body.appendChild(script);
    });
    if (typeof window.UAGExamplePage === 'function') window.UAGExamplePage(form);
  }

  const definition = form.form || {};
  const all = components(definition.components);
  const input = all.find((component) => component.properties && component.properties.uagField === 'input');
  // The fields a workflow's task fills: its agent fields, not its criteria or input.
  const taskFields = all.filter((component) => component.input && component.properties && component.properties.uag && !component.properties.uagField).map((component) => component.key);

  // A sample from the example page: into the input, then read as if the visitor had typed it.
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || !event.data || event.data.type !== 'uag-example-sample') return;
    if (event.data.file) {
      upload(String(event.data.file));
      return;
    }
    const text = String(event.data.text || '');
    if (mode === 'chat') {
      if (typeof form.send === 'function') form.send(text);
      return;
    }
    if (!input) return;
    const component = form.getComponent(input.key);
    if (!component) return;
    component.setValue(text);
    if (agent) agent.extract();
  });

  /** A sample file from the example page, chosen in the form's file input as a visitor would choose it. */
  async function upload(url) {
    const file = new URL(url, location.href);
    if (file.origin !== location.origin) return;
    const blob = await (await fetch(file)).blob();
    const input = root.querySelector('input[type="file"]');
    if (!input) return;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], file.pathname.split('/').pop(), { type: blob.type }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  form.on('submitDone', (submission) => {
    if (mode !== 'workflow') {
      show('Saved', 'The UAG checked the submission against the form and saved it to the project. This is what was stored:', saved(submission.data));
      return;
    }
    show('Saved. The agent is working…', 'The submission is saved. Its Agent: Run task action is running the task in the background; this page reads the submission back until the task\'s fields arrive.', saved(submission.data));
    watch(submission);
  });

  /** Reads the submission back, as its owner, until the task has filled its fields. */
  function watch(submission) {
    clearInterval(poller);
    const url = DemoApp.settings.uagUrl + (definition.project ? '/project/' + definition.project : '') + '/form/' + definition._id + '/submission/' + encodeURIComponent(submission._id);
    const started = Date.now();
    let reads = 0;
    let waiting = false;
    const mine = poller = setInterval(() => {
      if (Date.now() - started > POLL_LIMIT_MS) {
        clearInterval(mine);
        show('Still working', DemoApp.settings.production === 'true'
          ? 'The agent is taking longer than usual. It keeps working in the background.'
          : 'No agent result yet. A local UAG needs an agent engine, and a license or a trial project, to run tasks.');
        return;
      }
      if (waiting) return;
      waiting = true;
      reads++;
      UAGFlowLog.fetch(url, { headers: { 'x-jwt-token': UAGDemoGuest.token() || '' } }, {
        reqId: 'read-' + submission._id, run: 'read-' + submission._id, label: 'GET the submission, as its owner', summary: 'read ' + reads + (reads === 1 ? ' time' : ' times'),
      }).then((response) => (response.ok ? response.json() : null)).then((latest) => {
        if (poller !== mine || !latest) return;
        const data = latest.data || {};
        const filled = taskFields.filter((key) => data[key] !== undefined && data[key] !== null && data[key] !== '');
        if (taskFields.length && filled.length === taskFields.length) {
          clearInterval(mine);
          UAGFlowLog.note({ run: 'task-' + submission._id, title: 'Agent: Run task', label: 'the task saved ' + filled.join(', '), summary: 'saved as an update to the submission' });
          show('Done', 'The task saved its fields as an update to the submission:', saved(data));
        }
      }).then(() => { waiting = false; }, () => { waiting = false; });
    }, POLL_MS);
  }

  $('[data-again]').addEventListener('click', () => {
    clearInterval(poller);
    poller = null;
    status.hidden = true;
    if (mode === 'chat' && typeof form.reset === 'function') form.reset();
    else form.submission = { data: {} };
  });
})();
