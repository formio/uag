// The applicant's side of the agentic workflow demo.
//
// The page renders the applicant's part of the application form, submits it,
// and then only reads the submission back. Everything in between happens in the
// UAG, configured in the form itself: the save goes through the UAG (formio.js
// sends it there, through @formio/uag-js), whose "Agent: Run task" action has an
// engine score the application against the criteria after the save; the UAG
// saves the results as an update, and on the scholarship track that update
// starts the finance task's action. The visitor's guest token can read only the
// applications it submitted.
(function () {
  var AGENT_PANELS = ['workflow', 'agentAdmissionsReview', 'agentScholarshipReview'];
  var SCORES = [
    ['academicsScore', 'Academics'], ['testingScore', 'Testing'], ['extracurricularScore', 'Extracurriculars'],
    ['leadershipScore', 'Leadership'], ['serviceScore', 'Service'], ['essaysScore', 'Essays'],
  ];
  var EXPECT = { strong: 'Likely: scholarship track', average: 'Likely: accepted', weak: 'Likely: declined' };
  var POLL_MS = 1500;
  var POLL_LIMIT_MS = 4 * 60 * 1000;
  // On a UAG run locally, how long before the page says why the agents may not answer.
  var LOCAL_HINT_MS = 45 * 1000;
  var LOCAL_HINT = 'The agents have not answered. If this UAG runs on your machine, it needs a license that includes the UAG, or a project on Form.io\'s hosted service, to run Agentic Formflow.';

  var definition = null;
  var labels = {};
  var profiles = {};
  var form = null;
  var poller = null;
  var formio = null;
  // A run is settled when it is declined or accepted, or on the scholarship
  // track with an award chosen (module/applicants.mjs, `settled`).
  function settled(data) {
    return ['declined', 'accepted'].indexOf(data.status) >= 0 || (data.status === 'scholarshipEvaluation' && !!data.awardLevel);
  }

  function $(selector) { return document.querySelector(selector); }

  function show(view) {
    document.querySelectorAll('[data-view]').forEach(function (el) { el.hidden = el.getAttribute('data-view') !== view; });
    window.scrollTo(0, 0);
  }


  function walk(components, visit) {
    (components || []).forEach(function (component) {
      visit(component);
      walk(component.components, visit);
      (component.columns || []).forEach(function (column) { walk(column.components, visit); });
    });
  }

  function load() {
    return DemoApp.ready().then(function () {
      formio = new Formio(DemoApp.formUrl('application'));
      return Promise.all([
        formio.loadForm(),
        fetch('applicants.json').then(function (r) { return r.json(); }),
      ]);
    }).then(function (results) {
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
    // formio.js saves it; @formio/uag-js sends the save to the UAG, so the form's Run task actions run.
    formio.saveSubmission({ data: data }).then(function (saved) {
      startStatus(saved._id, data);
    }).catch(function (err) {
      var details = (err && err.details) || [];
      error.textContent = details.length
        ? 'The application was not accepted. ' + details.map(function (d) { return d.message; }).join(' ')
        : 'The application was not accepted (' + ((err && (err.message || err.error)) || err || 'no answer') + ').';
      error.hidden = false;
      if (form) form.emit('submitError');
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
    $('[data-status-lede]').textContent = (data.firstName ? data.firstName + '’s' : 'Your') + ' application was saved. Its Run task action has started the admissions agent.';
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
    // Read back from the UAG as the guest who owns it, as @formio/uag-js would
    // address it ({uag}/project/{id}/form/{id}). One row in the flow log for all
    // the reads, and a row for each stage the reads see change.
    var url = DemoApp.settings.uagUrl + (definition.project ? '/project/' + definition.project : '') + '/form/' + definition._id + '/submission/' + encodeURIComponent(id);
    var reads = 0;
    var hinted = false;
    var seen = { status: 'submitted' };
    var mine = poller = setInterval(function () {
      if (Date.now() - started > POLL_LIMIT_MS) {
        clearInterval(mine);
        $('[data-status-lede]').textContent = DemoApp.settings.production === 'true'
          ? 'The agents are taking longer than usual. The review continues in the background; check back in a minute.'
          : LOCAL_HINT;
        return;
      }
      // Without a license a save still succeeds, and no agent runs: say so early, and keep reading.
      if (!hinted && DemoApp.settings.production !== 'true' && !seen.decision && Date.now() - started > LOCAL_HINT_MS) {
        hinted = true;
        $('[data-status-lede]').textContent = LOCAL_HINT;
      }
      if (waiting) return;
      waiting = true;
      reads++;
      UAGFlowLog.fetch(url, { headers: { 'x-jwt-token': UAGDemoGuest.token() || '' } }, {
        reqId: 'read-' + id, run: 'read-' + id, label: 'GET the application, as its owner', summary: 'read ' + reads + (reads === 1 ? ' time' : ' times'),
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (submission) {
        if (poller !== mine || !submission) return;
        var data = submission.data || {};
        note(id, seen, data);
        render({ result: data });
        if (settled(data)) clearInterval(mine);
      }).then(done, done);
    }, POLL_MS);
  }

  /** A flow log row for each change the reads see: what the UAG's Run task actions saved. */
  function note(id, seen, data) {
    if (data.decision && data.decision !== seen.decision) {
      UAGFlowLog.note({ run: 'stage-' + id + '-admissions', title: 'Run task: admissions', label: 'admissions saved: ' + label('decision', data.decision), summary: 'status ' + data.status + (data.overallScore !== undefined ? ' · overall score ' + data.overallScore : '') });
    }
    if (data.awardLevel && data.awardLevel !== seen.awardLevel) {
      UAGFlowLog.note({ run: 'stage-' + id + '-finance', title: 'Run task: finance', label: 'finance saved: ' + label('awardLevel', data.awardLevel), summary: 'started by the update that saved the admissions results' });
    }
    seen.decision = data.decision;
    seen.awardLevel = data.awardLevel;
    seen.status = data.status;
  }

  function render(body) {
    var result = body.result;
    var scored = SCORES.some(function (score) { return result[score[0]] !== undefined && result[score[0]] !== null; });
    if (!scored && !result.decision) return;
    stage('admissions', 'done');
    $('[data-results]').hidden = false;
    var scores = $('[data-scores]');
    scores.innerHTML = '<h2>Admissions scores</h2>';
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
        ? 'The admissions agent put this applicant on the scholarship track. Saving its results started the finance agent, which is choosing an award.'
        : 'The admissions agent decided, and the UAG validated the result and saved it to the submission. The workflow is complete.';
    }
    if (result.status === 'scholarshipEvaluation') {
      stage('finance', result.awardLevel ? 'done' : 'active');
      if (result.awardLevel) {
        $('[data-finance]').hidden = false;
        $('[data-award]').textContent = label('awardLevel', result.awardLevel);
        $('[data-finance-rationale]').textContent = result.financeRationale || '';
        $('[data-status-lede]').textContent = 'Both agents have finished. The finance task was started by the update that saved the admissions task’s results, through a Run task action with a condition.';
      }
    }
  }

  $('[data-back]').addEventListener('click', function () { show('choose'); });
  $('[data-again]').addEventListener('click', function () { clearInterval(poller); poller = null; show('choose'); });

  load().catch(function () {
    $('[data-profiles]').textContent = 'The demo could not load the application form. Please reload the page.';
  });
})();
