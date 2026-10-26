// The applicant's side of the agentic workflow demo.
//
// The page renders the applicant's part of the application form, submits it,
// and then only reads the submission back. Everything in between happens on
// the server, configured in the form itself: Form.io's webhook hands the new
// submission to the UAG's /agent/provide, an engine scores it against the
// criteria, the UAG validates and saves, and on the scholarship track that
// save fires the finance webhook.
(function () {
  var AGENT_PANELS = ['workflow', 'agentAdmissionsReview', 'agentScholarshipReview'];
  var SCORES = [
    ['academicsScore', 'Academics'], ['testingScore', 'Testing'], ['extracurricularScore', 'Extracurriculars'],
    ['leadershipScore', 'Leadership'], ['serviceScore', 'Service'], ['essaysScore', 'Essays'],
  ];
  var EXPECT = { strong: 'Likely: scholarship track', average: 'Likely: accepted', weak: 'Likely: declined' };
  var POLL_MS = 2500;
  var POLL_LIMIT_MS = 4 * 60 * 1000;

  var definition = null;
  var labels = {};
  var profiles = {};
  var form = null;
  var poller = null;

  function $(selector) { return document.querySelector(selector); }

  function show(view) {
    document.querySelectorAll('[data-view]').forEach(function (el) { el.hidden = el.getAttribute('data-view') !== view; });
    window.scrollTo(0, 0);
  }

  function tellParent(body) {
    if (window.parent !== window) window.parent.postMessage({ type: 'uag-demo', code: body.code, error: body.error }, location.origin);
  }

  function walk(components, visit) {
    (components || []).forEach(function (component) {
      visit(component);
      walk(component.components, visit);
      (component.columns || []).forEach(function (column) { walk(column.components, visit); });
    });
  }

  function load() {
    return Promise.all([
      fetch('/api/workflow/form').then(function (r) { return r.json(); }),
      fetch('/api/workflow/applicants').then(function (r) { return r.json(); }),
    ]).then(function (results) {
      definition = results[0];
      profiles = results[1];
      walk(definition.components, function (component) {
        var values = component.values || (component.data && component.data.values);
        if (values) {
          labels[component.key] = {};
          values.forEach(function (option) { labels[component.key][option.value] = option.label; });
        }
        if (component.key === 'admissionsCriteria') $('[data-criteria]').innerHTML = component.html || '';
      });
      renderProfiles();
    });
  }

  function renderProfiles() {
    var list = $('[data-profiles]');
    list.innerHTML = '';
    ['strong', 'average', 'weak'].forEach(function (key) {
      var profile = profiles[key];
      if (!profile) return;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile';
      button.innerHTML = '<strong></strong><div class="meta"></div><p></p><span class="expect"></span>';
      button.querySelector('strong').textContent = profile.firstName + ' ' + profile.lastName;
      button.querySelector('.meta').textContent = profile.highSchool + ' · GPA ' + profile.gpa + ' · ' + String(profile.testType).toUpperCase() + ' ' + profile.testScore;
      button.querySelector('p').textContent = (profile.extracurriculars || '').slice(0, 120) + ((profile.extracurriculars || '').length > 120 ? '…' : '');
      button.querySelector('.expect').textContent = EXPECT[key];
      button.addEventListener('click', function () { openForm(profile, profile.firstName + '’s application'); });
      list.appendChild(button);
    });
    var blank = document.createElement('button');
    blank.type = 'button';
    blank.className = 'profile blank';
    blank.innerHTML = '<div><strong>Write your own</strong><p>Start from an empty application.</p></div>';
    blank.addEventListener('click', function () { openForm({}, 'Your application'); });
    list.appendChild(blank);
  }

  function applicantForm() {
    var copy = JSON.parse(JSON.stringify(definition));
    copy.components = copy.components.filter(function (component) { return AGENT_PANELS.indexOf(component.key) < 0; });
    return copy;
  }

  function openForm(data, title) {
    $('[data-form-title]').textContent = title;
    $('[data-form-error]').hidden = true;
    show('form');
    if (form) form.destroy();
    Formio.createForm(document.getElementById('application'), applicantForm(), { noAlerts: true, buttonSettings: { showCancel: false } }).then(function (created) {
      form = created;
      form.nosubmit = true;
      form.submission = { data: JSON.parse(JSON.stringify(data)) };
      form.on('submit', function (submission) { submit(submission.data); });
    });
  }

  function submit(data) {
    var error = $('[data-form-error]');
    error.hidden = true;
    fetch('/api/workflow/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: data }),
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) {
          error.textContent = body.error || 'The application was not accepted.';
          error.hidden = false;
          if (form) form.emit('submitError');
          tellParent(body);
          return;
        }
        startStatus(body.id, data);
      });
    }).catch(function () {
      error.textContent = 'Could not reach the demo server. Please try again.';
      error.hidden = false;
    });
  }

  function stage(name, state) {
    var el = document.querySelector('[data-stage="' + name + '"]');
    if (!el) return;
    el.hidden = false;
    el.classList.toggle('done', state === 'done');
    el.classList.toggle('active', state === 'active');
  }

  function label(field, value) {
    return (labels[field] && labels[field][value]) || value;
  }

  function startStatus(id, data) {
    show('status');
    $('[data-app-id]').textContent = id;
    $('[data-status-title]').textContent = 'Under review';
    $('[data-status-lede]').textContent = (data.firstName ? data.firstName + '’s' : 'Your') + ' application was saved. A webhook has handed it to the admissions agent.';
    $('[data-results]').hidden = true;
    $('[data-finance]').hidden = true;
    stage('submitted', 'done');
    stage('admissions', 'active');
    stage('decision', '');
    document.querySelector('[data-stage="finance"]').hidden = true;
    var started = Date.now();
    // One request at a time: a slow answer skips the ticks that come before it.
    var waiting = false;
    function done() { waiting = false; }
    clearInterval(poller);
    // This application's poller: an answer that arrives after another application
    // has replaced it on the screen is dropped.
    var mine = poller = setInterval(function () {
      if (Date.now() - started > POLL_LIMIT_MS) {
        clearInterval(mine);
        $('[data-status-lede]').textContent = 'The agents are taking longer than usual. The review continues in the background; check back in a minute.';
        return;
      }
      if (waiting) return;
      waiting = true;
      fetch('/api/workflow/applications/' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (body) {
        if (poller !== mine) return;
        if (body.result) render(body);
        if (body.settled) clearInterval(mine);
      }).then(done, done);
    }, POLL_MS);
  }

  function render(body) {
    var result = body.result;
    var scored = SCORES.some(function (score) { return result[score[0]] !== undefined && result[score[0]] !== null; });
    if (!scored && !result.decision) return;
    stage('admissions', 'done');
    $('[data-results]').hidden = false;
    var scores = $('[data-scores]');
    scores.innerHTML = '<h2>Rubric scores</h2>';
    SCORES.concat([['overallScore', 'Overall']]).forEach(function (score) {
      var value = result[score[0]];
      if (value === undefined || value === null) return;
      var row = document.createElement('div');
      row.className = 'score' + (score[0] === 'overallScore' ? ' overall' : '');
      row.innerHTML = '<span></span><b></b><div class="bar"><span></span></div>';
      row.children[0].textContent = score[1];
      row.children[1].textContent = value;
      row.querySelector('.bar span').style.width = Math.max(0, Math.min(100, Number(value) * 10)) + '%';
      scores.appendChild(row);
    });
    $('[data-rationale]').textContent = result.agentRationale || '';

    if (result.decision) {
      stage('decision', 'done');
      var badge = result.decision === 'declined' ? 'declined' : result.decision === 'accepted' ? 'accepted' : 'scholarship';
      var title = $('[data-status-title]');
      title.textContent = 'Decision: ';
      var span = document.createElement('span');
      span.className = 'badge-decision badge-' + badge;
      span.textContent = label('decision', result.decision);
      title.appendChild(span);
      $('[data-status-lede]').textContent = result.status === 'scholarshipEvaluation'
        ? 'The admissions agent put this applicant on the scholarship track. Its save fired a second webhook, and the finance agent is choosing an award.'
        : 'The admissions agent decided, and the UAG validated the result and saved it to the submission. The workflow is complete.';
    }
    if (result.status === 'scholarshipEvaluation') {
      stage('finance', result.awardLevel ? 'done' : 'active');
      if (result.awardLevel) {
        $('[data-finance]').hidden = false;
        $('[data-award]').textContent = label('awardLevel', result.awardLevel);
        $('[data-finance-rationale]').textContent = result.financeRationale || '';
        $('[data-status-lede]').textContent = 'Both agents have finished. The finance task was started by the admissions task’s own save, through a conditional update webhook.';
      }
    }
  }

  $('[data-back]').addEventListener('click', function () { show('choose'); });
  $('[data-again]').addEventListener('click', function () { clearInterval(poller); poller = null; show('choose'); });

  load().catch(function () {
    $('[data-profiles]').textContent = 'The demo could not load the application form. Please reload the page.';
  });
})();
