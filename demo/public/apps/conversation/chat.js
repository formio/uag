// The chat page. All the work happens on the server, which runs the tool loop
// against the UAG; this page only shows the conversation, which UAG tools each
// reply used, and the submission once one is made.
(function () {
  var log = document.getElementById('log');
  var composer = document.getElementById('composer');
  var input = document.getElementById('input');
  var send = document.getElementById('send');
  var suggestions = document.getElementById('suggestions');

  // Model output is rendered as markdown, always sanitized. Without either
  // library (a blocked CDN), replies fall back to plain text.
  function canRenderMarkdown() { return window.marked && window.DOMPurify; }

  function scroll() { log.scrollTop = log.scrollHeight; }

  function add(text, className, markdown) {
    var md = markdown && canRenderMarkdown();
    var el = document.createElement('div');
    el.className = 'msg ' + className + (md ? ' md' : '');
    if (md) el.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text, { breaks: true, gfm: true }), { USE_PROFILES: { html: true } });
    else el.textContent = text;
    log.appendChild(el);
    scroll();
    return el;
  }

  function addTyping() {
    var el = document.createElement('div');
    el.className = 'msg bot typing';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', 'Assistant is typing');
    el.innerHTML = '<span></span><span></span><span></span>';
    log.appendChild(el);
    scroll();
    return el;
  }

  function addTools(tools) {
    if (!tools || !tools.length) return;
    var names = [];
    tools.forEach(function (tool) { if (names.indexOf(tool.name) < 0) names.push(tool.name); });
    var el = document.createElement('div');
    el.className = 'tools';
    el.textContent = 'UAG tools: ' + names.join(', ');
    log.appendChild(el);
    scroll();
  }

  function addReceipt(submission) {
    var el = document.createElement('div');
    el.className = 'receipt';
    var title = document.createElement('strong');
    title.textContent = 'Saved in Form.io: ' + submission.form + ' ' + submission.id;
    el.appendChild(title);
    var list = document.createElement('dl');
    Object.keys(submission.data || {}).forEach(function (key) {
      var value = submission.data[key];
      if (value === '' || value === null || value === undefined || key === 'submit') return;
      var dt = document.createElement('dt');
      dt.textContent = key;
      var dd = document.createElement('dd');
      dd.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value);
      list.appendChild(dt);
      list.appendChild(dd);
    });
    el.appendChild(list);
    log.appendChild(el);
    scroll();
  }

  function tellParent(body) {
    if (window.parent !== window) window.parent.postMessage({ type: 'uag-demo', code: body.code, error: body.error }, location.origin);
  }

  // Bumped by "Start over", so a reply to the conversation before it is dropped.
  var conversation = 0;

  function turn(message) {
    var pending = addTyping();
    var current = conversation;
    send.disabled = true;
    fetch('/api/conversation/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message }),
    }).then(function (response) {
      return response.json().then(function (body) {
        pending.remove();
        if (current !== conversation) return;
        if (!response.ok) {
          add(body.error || 'Something went wrong.', 'err');
          tellParent(body);
          return;
        }
        add(body.reply, 'bot', true);
        addTools(body.tools);
        if (body.submission) addReceipt(body.submission);
      });
    }).catch(function () {
      pending.remove();
      add('Could not reach the demo server. Please try again.', 'err');
    }).then(function () {
      send.disabled = false;
      input.focus();
    });
  }

  function submit(message) {
    if (suggestions) { suggestions.remove(); suggestions = null; }
    add(message, 'user');
    turn(message);
  }

  composer.addEventListener('submit', function (event) {
    event.preventDefault();
    var message = input.value.trim();
    if (!message || send.disabled) return;
    input.value = '';
    submit(message);
  });

  if (suggestions) {
    suggestions.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (button && !send.disabled) submit(button.textContent);
    });
  }

  document.getElementById('reset').addEventListener('click', function () {
    fetch('/api/conversation/reset', { method: 'POST' }).then(function () {
      conversation++;
      log.innerHTML = '';
      add('Conversation reset. What do you need help with?', 'bot');
    });
  });

  // What the agent can see: asked of the UAG, so a form that lost its `uag`
  // tag disappears here too.
  var activeList = document.getElementById('active-list');
  function refreshActive() {
    fetch('/api/conversation/forms').then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.error || 'request failed');
        activeList.replaceChildren();
        if (!body.forms.length) {
          var none = document.createElement('span');
          none.className = 'muted';
          none.textContent = 'nothing tagged uag yet';
          activeList.appendChild(none);
          return;
        }
        body.forms.forEach(function (form) {
          var pill = document.createElement('span');
          pill.className = 'pill';
          pill.textContent = form.title;
          activeList.appendChild(pill);
        });
      });
    }).catch(function (error) {
      activeList.replaceChildren();
      var failed = document.createElement('span');
      failed.className = 'warn';
      failed.textContent = 'could not reach the UAG: ' + error.message;
      activeList.appendChild(failed);
    });
  }
  refreshActive();
  setInterval(refreshActive, 30000);
})();
