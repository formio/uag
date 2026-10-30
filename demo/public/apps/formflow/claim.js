/**
 * Lantern Mutual claim intake: renders the `claim` wizard, attaches Agent
 * Input from @formio/uag-js, and shows what the agent is doing as it reads the
 * description: the steps it adds, the fields it is filling, and how long it took.
 */
(async function () {
  const $ = (selector) => document.querySelector(selector);

  // Pages every claim has. The others are added by triage.
  const BASE_PAGES = ['intake', 'loss', 'photos', 'contact', 'review'];

  const LEDES = {
    intake: 'Tell us in your own words. We use what you write to skip the questions that don\'t apply and fill in what we can. You check everything before it is sent.',
    loss: 'Your best estimate is fine. Your adjuster will confirm the details with you.',
    vehicle: 'About the insured vehicle and what happened to it.',
    home: 'About the damage to your home and what you have done so far.',
    theft: 'List what you can now. You can send receipts and serial numbers to your adjuster later.',
    injury: 'So the right coverage and support reach the people who were hurt.',
    thirdParty: 'Whatever you exchanged with the other driver or person involved.',
    contact: 'Your adjuster uses these details to reach you about this claim.',
    review: 'Check what you have told us. Answers marked "from your description" were filled in for you.'
  };

  const CLAIM_TYPES = {
    autoCollision: { label: 'Auto collision', sorted: 'an auto collision' },
    autoGlass: { label: 'Auto glass', sorted: 'auto glass damage' },
    theft: { label: 'Theft', sorted: 'a theft' },
    propertyDamage: { label: 'Damage to your home', sorted: 'damage to your home' }
  };

  // Example claims under the description, one click to fill it. Each one
  // leads triage to a different set of steps.
  const EXAMPLES = [
    { label: 'Rear-ended, neck pain', policyNumber: 'AUTO-2048-1173', lossDescription: 'Yesterday around 5:30pm I was stopped at the light on Main St and 4th Ave in Springfield when a pickup truck rear-ended my 2019 Honda Civic. The other driver, Mark Jensen, said he was insured with Allstate. My rear bumper and trunk are crushed and the trunk will not close, but the car still drives. My neck has been sore since and I saw a doctor at urgent care this morning, who said it was whiplash. The Springfield police came and gave me report number 24-118803.' },
    { label: 'Cracked windshield', policyNumber: 'AUTO-2048-5520', lossDescription: 'On Monday a rock flew up from a gravel truck on I-35 near Austin and cracked the windshield of my 2021 Toyota RAV4. The crack is about 8 inches long and spreading. Nothing else on the car was damaged and nobody was hurt.' },
    { label: 'Car stolen', policyNumber: 'AUTO-3310-0042', lossDescription: 'Sometime overnight on March 3rd my 2017 Ford F-150 was stolen from my driveway at 812 Oak Lane, Boise. I had both keys inside the house and there was broken glass where the driver window had been. I reported it to the Boise police the next morning and they gave me case number BPD-55127.' },
    { label: 'Burst pipe', policyNumber: 'HOME-7781-2290', lossDescription: 'Last Saturday a pipe burst under the kitchen sink at our house at 41 Birch Road, Madison while we were away for the weekend. When we got home the kitchen floor was flooded and water had soaked into the hardwood in the dining room and the drywall of the basement ceiling below. We shut off the water main. No one was hurt.' },
    { label: 'Laptop stolen from home', policyNumber: 'HOME-5512-0871', lossDescription: 'Someone broke into our apartment through the back door on Tuesday afternoon while we were at work. They took a MacBook Pro, an iPad and some jewelry. The door frame was splintered. We called the Denver police and the report number is DPD-26-40917.' },
    // Unclear on purpose: some answers come back uncertain, so the claimant has to
    // check them (tick "Yes, this looks right" or change them) before continuing.
    { label: 'Mirror and window smashed', policyNumber: 'AUTO-4417-2208', lossDescription: 'Yesterday afternoon when I came back to my 2020 Subaru Outback in the Target parking lot in Reno, the passenger side mirror was hanging off and the passenger window was shattered. I am not sure if someone backed into it or broke in, because nothing seems to be missing but the glovebox was open.' },
    { label: 'Hit a deer', policyNumber: 'AUTO-1188-4402', lossDescription: 'Last night around 9pm, driving home on Route 9 near Albany, a deer jumped out and I hit it. The front of my 2018 Ford Escape is pushed in and one headlight is broken, and the windshield has a crack now too. My daughter was in the car and says her wrist hurts a little.' },
    { label: 'Suspicious claim', policyNumber: 'AUTO-9902-6614', lossDescription: 'My car got damaged at some point last week, I think on Tuesday, or maybe it was Thursday night. It was either parked at the mall or at home, I am not sure. There is a big dent and some glass is broken. I just bought the policy last week. I need the money as fast as possible, can you just send cash today?' }
  ];

  const definition = await (await fetch('/api/formflow/form')).json();
  const form = await Formio.createForm($('#claim'), definition, {
    noAlerts: true,
    buttonSettings: { showCancel: false },
    language: 'en',
    i18n: { en: { next: 'Continue', previous: 'Back', submit: 'Submit claim' } }
  });
  form.nosubmit = true;

  // The demo's backend relays the claim form's agent operations to the UAG,
  // behind its own budget and bot check: /api/formflow/agent/extract.
  const agent = FormioUAG.UAG.attach(form, {
    formUrl: '/api/formflow',
    trigger: 'next',
    // Uncertain values must be checked (changed, or ticked as right) before Continue or Submit.
    requireReview: true,
    fetch: demoFetch,
    onStart,
    onResult,
    onDone
  });

  /* ---------- Helpers ---------- */

  function isBlank(value) {
    if (value === undefined || value === null || value === '' || value === false) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return !Object.values(value).some(Boolean);
    return false;
  }

  function details(count) {
    return count + (count === 1 ? ' detail' : ' details');
  }

  function seconds(ms) {
    return ms === undefined ? '' : (ms / 1000).toFixed(1) + 's';
  }

  function pageKey(index) {
    const page = form.pages[index];
    return page && page.component.key;
  }

  /** Fields the agent may fill: flagged for the task, not its input or criteria. */
  function agentFields() {
    const fields = [];
    form.everyComponent((component) => {
      const def = component.component;
      const props = def.properties || {};
      if (props.uag && !props.uagField && def.input && def.type !== 'container' && def.type !== 'hidden') fields.push(component);
    });
    return fields;
  }

  /* ---------- What the agent is doing ---------- */

  const activity = $('[data-activity]');
  const ticker = $('[data-ticker]');
  const lines = new Map();
  let pending = new Set();
  let request = null;
  // Fields on the steps triage added, which the follow-up request fills.
  let hiddenPaths = [];

  function line(id, text, state, time) {
    let item = lines.get(id);
    if (!item) {
      item = document.createElement('li');
      item.innerHTML = '<span class="activity-icon" aria-hidden="true"></span><span class="activity-text"></span><time></time>';
      activity.append(item);
      lines.set(id, item);
    }
    item.className = 'is-' + state;
    item.querySelector('.activity-text').textContent = text;
    item.querySelector('time').textContent = time || '';
    $('[data-activity-empty]').hidden = true;
    updateTicker();
  }

  function updateTicker() {
    const running = [...lines.values()].filter((item) => item.className === 'is-running').pop();
    clearTimeout(updateTicker.timer);
    if (running) {
      ticker.className = 'ticker is-running';
      ticker.innerHTML = '<span class="activity-icon" aria-hidden="true"></span>';
      ticker.append(running.querySelector('.activity-text').textContent);
      ticker.hidden = false;
    }
    else {
      updateTicker.timer = setTimeout(() => { ticker.hidden = true; }, 2500);
    }
  }

  function onStart({ followUp }) {
    request = { followUp, started: performance.now(), filled: 0 };
    if (!followUp) {
      activity.innerHTML = '';
      lines.clear();
      line('read', 'Reading your description', 'running');
      const next = $('#claim .btn-wizard-nav-next');
      if (next && form.page === 0) next.firstChild.nodeValue = 'Reading your description ';
    }
    else {
      line('more', 'Filling in the steps we added', 'running');
    }
    // Every agent field still empty is about to be answered; a follow-up
    // answers the fields on the steps triage added.
    pending = new Set(agentFields()
      .filter((component) => isBlank(component.dataValue) && agent.state.source(component.path) !== 'user')
      .filter((component) => !followUp || hiddenPaths.includes(component.path))
      .map((component) => component.path));
    paintFields();
  }

  function onResult(event) {
    if (event.kind === 'decision') triageRan = true;
    const fields = event.fields || {};
    Object.keys(fields).forEach((path) => pending.delete(path));
    const answered = Object.values(fields).filter((field) => field.status !== 'missing').length;
    request.filled += answered;
    if (!request.followUp && event.kind === 'decision') {
      const claimType = fields['triage.claimType'];
      const type = claimType && CLAIM_TYPES[claimType.value];
      if (claimType && claimType.status === 'confident' && type) {
        line('read', 'Sorted as ' + type.sorted + ' (' + Math.round(claimType.confidence * 100) + '% sure)', 'ok', seconds(event.latencyMs));
      }
      else if (claimType && claimType.status === 'uncertain') {
        line('read', 'Not sure what kind of claim this is, so we ask you to confirm it', 'warn', seconds(event.latencyMs));
      }
      else {
        line('read', 'Could not tell what kind of claim this is', 'warn', seconds(event.latencyMs));
      }
      // Fraud signals stay hidden from the claimant, as on a real carrier's site.
      line('fill', 'Filling in details', 'running');
    }
    else if (!request.followUp && event.kind === 'value') {
      line('fill', answered ? 'Filled ' + details(answered) + ' for you to check' : 'Found no other details to fill in', 'ok', seconds(event.latencyMs));
    }
    paintFields();
    updateSteps();
  }

  function onDone(summary, { followUp }) {
    triageRan = true;
    pending.clear();
    paintFields();
    const took = seconds(performance.now() - request.started);
    if (!summary) {
      lines.forEach((item, id) => {
        if (item.className === 'is-running') line(id, 'Could not read your description. You can fill in the form yourself.', 'error');
      });
      return;
    }
    hiddenPaths = followUp ? [] : (summary.excluded || []).filter((entry) => /hidden/.test(entry.reason)).map((entry) => entry.path);
    if (followUp) {
      line('more', request.filled ? 'Filled ' + details(request.filled) + ' on the steps we added' : 'Nothing more to fill in on the steps we added', 'ok', took);
    }
    else {
      lines.forEach((item, id) => {
        if (item.className === 'is-running') line(id, id === 'fill' ? 'Found no other details to fill in' : 'Done', 'ok', took);
      });
    }
  }

  /** Mark fields the agent is filling, and fields holding a value it filled. */
  function paintFields() {
    form.everyComponent((component) => {
      if (!component.element) return;
      const path = component.path;
      component.element.classList.toggle('is-filling', pending.has(path));
      component.element.classList.toggle('is-agent-filled', agent.state.source(path) === 'agent' && !isBlank(component.dataValue));
    });
  }

  // Some fields (dates, for one) redraw their own element after the page
  // renders, so repaint whenever the form's DOM changes.
  let paintQueued = false;
  new MutationObserver(() => {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      paintFields();
    });
  }).observe($('#claim'), { childList: true, subtree: true });

  /* ---------- Steps ---------- */

  const stepsList = $('[data-steps]');
  let knownPages = null;
  let furthest = 0;
  let stepsSignature = '';
  let submitted = false;
  // The Confirm step is shown by the form until triage has decided; list it only
  // once triage has run, or when the wizard actually needs it.
  let triageRan = false;

  function reasonFor(key) {
    const triage = form.data.triage || {};
    switch (key) {
      case 'confirm': return 'Check the kind of claim';
      case 'vehicle':
        if (triage.claimType === 'autoGlass') return 'You mentioned glass damage';
        if (triage.claimType === 'autoCollision') return 'You described a collision';
        return 'A vehicle was involved';
      case 'home': return 'You described damage to your home';
      case 'theft': return 'You said something was stolen';
      case 'injury': return 'You mentioned someone was hurt';
      case 'thirdParty': return 'Someone else was involved';
      case 'police': return triage.claimType === 'theft' ? 'Theft claims need a police report' : 'Injury claims need a police report';
      default: return '';
    }
  }

  function updateSteps() {
    const policy = form.data.policyNumber;
    if (!submitted) $('[data-claim-policy]').textContent = policy ? 'Policy ' + policy : 'Not submitted yet';
    furthest = Math.max(furthest, form.page);
    const pages = (form.pages || [])
      .map((page, index) => ({ page, index }))
      .filter(({ page, index }) => page.component.key !== 'confirm' || triageRan || index === form.page);
    const keys = pages.map(({ page }) => page.component.key);
    const position = Math.max(0, pages.findIndex(({ index }) => index === form.page));
    const signature = keys.join() + '|' + form.page + '|' + furthest + '|' + submitted + '|' + JSON.stringify(form.data.triage || {});
    if (signature === stepsSignature) return;
    stepsSignature = signature;

    const added = knownPages ? keys.filter((key) => !knownPages.has(key)) : [];
    knownPages = new Set(keys);

    stepsList.innerHTML = '';
    pages.forEach(({ page, index }) => {
      const key = page.component.key;
      const item = document.createElement('li');
      item.className = 'step';
      if (submitted || index < form.page) item.classList.add('is-done');
      if (!submitted && index === form.page) item.classList.add('is-current');
      if (!submitted && index <= furthest) item.classList.add('is-reachable');
      if (added.includes(key)) item.classList.add('is-new');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'step-button';
      button.disabled = submitted || index > furthest;
      if (index === form.page) button.setAttribute('aria-current', 'step');
      button.innerHTML = '<span class="step-dot" aria-hidden="true"></span><span class="step-title"></span>';
      button.querySelector('.step-title').textContent = page.component.title;
      const reason = BASE_PAGES.includes(key) ? '' : reasonFor(key);
      if (reason) {
        const note = document.createElement('span');
        note.className = 'step-reason';
        note.textContent = reason;
        button.append(note);
      }
      button.addEventListener('click', () => {
        if (index !== form.page) form.setPage(index);
        closeRail();
      });
      item.append(button);
      stepsList.append(item);
    });
    $('[data-steps-hint]').hidden = !!(form.data.triage && form.data.triage.claimType);

    // Page heading, progress and the mobile bar.
    const step = 'Step ' + (position + 1) + ' of ' + pages.length;
    $('[data-page-count]').textContent = step;
    $('[data-page-title]').textContent = form.pages[form.page] ? form.pages[form.page].component.title : '';
    const lede = LEDES[pageKey(form.page)] || '';
    $('[data-page-lede]').textContent = lede;
    $('[data-page-lede]').hidden = !lede;
    $('[data-emergency]').hidden = form.page !== 0;
    $('.topbar-steps').textContent = step;
    $('.progress span').style.width = Math.round(((position + 1) / pages.length) * 100) + '%';
  }

  const rail = $('#rail');
  function closeRail() {
    rail.classList.remove('is-open');
    $('.topbar-steps').setAttribute('aria-expanded', 'false');
  }
  $('.topbar-steps').addEventListener('click', () => {
    rail.classList.add('is-open');
    $('.topbar-steps').setAttribute('aria-expanded', 'true');
    $('.rail-close').focus();
  });
  $('.rail-close').addEventListener('click', closeRail);

  /* ---------- Examples under the description ---------- */

  function addExamples() {
    const description = form.getComponent('lossDescription');
    if (!description || !description.element || document.getElementById('examples')) return;
    const row = document.createElement('div');
    row.id = 'examples';
    row.className = 'examples';
    row.append('Try an example:');
    EXAMPLES.forEach((example) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = example.label;
      // `modified` marks the values as the user's, so extraction never overwrites them.
      button.addEventListener('click', () => {
        form.getComponent('policyNumber').setValue(example.policyNumber, { modified: true });
        description.setValue(example.lossDescription, { modified: true });
      });
      row.append(button);
    });
    description.element.after(row);
  }

  /* ---------- Review ---------- */

  function optionLabel(def, value) {
    const options = def.values || (def.data && def.data.values) || [];
    const match = options.find((option) => option.value === value);
    return match ? match.label : String(value);
  }

  function display(component) {
    const def = component.component;
    const value = component.dataValue;
    switch (def.type) {
      case 'file': return value.length + (value.length === 1 ? ' file' : ' files');
      case 'selectboxes': return Object.keys(value).filter((key) => value[key]).map((key) => optionLabel(def, key)).join(', ');
      case 'radio':
      case 'select': return optionLabel(def, value);
      case 'checkbox': return 'Yes';
      case 'time': {
        const [hours, minutes] = String(value).split(':').map(Number);
        if (isNaN(hours) || isNaN(minutes)) return String(value);
        return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      }
      case 'currency': return Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      case 'datetime': {
        const date = new Date(value);
        return isNaN(date) ? String(value) : date.toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
      }
      default: return String(value);
    }
  }

  function renderSummary() {
    const host = document.querySelector('[data-claim-summary]');
    if (!host) return;
    host.innerHTML = '';
    const triage = form.data.triage || {};
    form.pages.forEach((page, index) => {
      const key = page.component.key;
      if (key === 'review' || key === 'confirm') return;
      const rows = [];
      if (key === 'intake' && CLAIM_TYPES[triage.claimType]) {
        rows.push([ 'Kind of claim', CLAIM_TYPES[triage.claimType].label, agent.state.source('triage.claimType') === 'agent' ]);
      }
      page.everyComponent((component) => {
        const def = component.component;
        if (!def.input || def.hidden || !component.visible || ['container', 'hidden', 'button'].includes(def.type)) return;
        if (component.path.startsWith('triage.') || isBlank(component.dataValue)) return;
        rows.push([def.label, display(component), agent.state.source(component.path) === 'agent']);
      });
      if (!rows.length) return;
      const section = document.createElement('section');
      section.className = 'summary-section';
      section.innerHTML = '<header><h3></h3><button type="button" class="summary-edit">Change</button></header><dl></dl>';
      section.querySelector('h3').textContent = page.component.title;
      section.querySelector('.summary-edit').setAttribute('aria-label', 'Change ' + page.component.title);
      section.querySelector('.summary-edit').addEventListener('click', () => form.setPage(index));
      const list = section.querySelector('dl');
      rows.forEach(([label, value, fromDescription]) => {
        const term = document.createElement('dt');
        term.textContent = label;
        const detail = document.createElement('dd');
        detail.textContent = value;
        if (fromDescription) detail.className = 'from-description';
        list.append(term, detail);
      });
      host.append(section);
    });
  }

  /* ---------- Submit ---------- */

  const submitError = $('[data-submit-error]');

  form.on('submit', async (submission) => {
    submitError.hidden = true;
    const button = $('#claim .btn-wizard-nav-submit');
    if (button) button.firstChild.nodeValue = 'Submitting your claim ';
    try {
      const response = await fetch('/api/formflow/claims', {
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
      if (button) button.firstChild.nodeValue = 'Submit claim ';
    }
  });

  function describeFailure(status, body) {
    const details = (body && body.details) || [];
    if (details.length) return 'Your claim was not submitted. ' + details.map((detail) => detail.message).join(' ');
    return 'Your claim was not submitted (the server answered ' + status + '). Try again, or call 1-800-555-0199.';
  }

  function showConfirmation(saved) {
    submitted = true;
    stepsSignature = '';
    updateSteps();
    const data = saved.data || form.data;
    const number = 'LM-' + new Date().getFullYear() + '-' + String(saved._id || '').slice(-6).toUpperCase();
    $('[data-claim-number]').textContent = number;
    $('[data-claim-policy]').textContent = 'Submitted as claim ' + number;
    $('.activity h2').textContent = 'Claim submitted';

    const how = { phone: 'by phone', text: 'by text message', email: 'by email' }[data.preferredContact] || 'by phone';
    const when = { morning: ' in the morning', afternoon: ' in the afternoon', evening: ' in the evening' }[data.bestTime] || '';
    $('[data-confirmation-lede]').textContent = 'Thank you, ' + (data.contactName || 'we have everything we need to start') + '. Keep your claim number handy whenever you contact us.';

    const type = (data.triage || {}).claimType;
    const middle = {
      autoCollision: ['Get the vehicle inspected', 'Your adjuster arranges an inspection, or you can take the vehicle to a repair shop you choose and send us its estimate.'],
      autoGlass: ['Book the glass repair', 'Most glass claims are repaired within days. Your adjuster can book a mobile repair at your home or work.'],
      theft: ['Send what you can', 'Receipts, photos and serial numbers help us value what was taken. Your adjuster will follow up with the police.'],
      propertyDamage: ['Prevent further damage', 'Keep receipts for emergency repairs such as water extraction or covering a roof. An adjuster or inspector will visit to assess the damage.']
    }[type] || ['Gather your documents', 'Photos, receipts and estimates help your adjuster settle the claim sooner.'];
    const steps = [
      ['An adjuster is assigned', 'Within one business day. They will contact you ' + how + when + ' to go over your claim.'],
      middle,
      ['Repairs and payment', 'Once the damage is assessed, we pay the repair shop or you directly, minus your deductible.']
    ];
    const list = $('[data-next-steps]');
    list.innerHTML = '';
    steps.forEach(([title, text]) => {
      const item = document.createElement('li');
      item.innerHTML = '<div><h3></h3><p></p></div>';
      item.querySelector('h3').textContent = title;
      item.querySelector('p').textContent = text;
      list.append(item);
    });

    $('[data-intake]').hidden = true;
    $('[data-confirmation]').hidden = false;
    window.scrollTo(0, 0);
    $('[data-confirmation-title]').focus();
  }

  /* ---------- Wiring ---------- */

  let shownPage = form.page;
  form.on('render', () => {
    addExamples();
    paintFields();
    updateSteps();
    if (pageKey(form.page) === 'review') renderSummary();
    if (form.page !== shownPage) {
      shownPage = form.page;
      window.scrollTo(0, 0);
      $('[data-page-title]').focus();
    }
  });
  form.on('change', () => {
    paintFields();
    updateSteps();
  });
  // The demo's limits (the human check, rate limits, the daily budget) answer
  // with a code; the example page around this frame explains them.
  async function demoFetch(url, init) {
    const response = await fetch(url, init);
    if ([403, 429, 503].includes(response.status) && window.parent !== window) {
      response.clone().json().then((body) => {
        if (body && body.code) window.parent.postMessage({ type: 'uag-demo', code: body.code, error: body.error }, location.origin);
      }).catch(() => {});
    }
    return response;
  }

  // No inline handlers: the site's Content-Security-Policy refuses them.
  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
  addExamples();
  updateSteps();
})();
