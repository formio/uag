// The service request chat: the form, embedded with @formio/uag-js's
// Formio.createChat, exactly as an application embeds it. The conversation runs
// in the UAG (the form's agent/chat operation); this page never names a field.
//
// This demo's UAG is on a private network, so the UAG's URL and the form's URL
// here are the demo server's stand-ins for them (demo/server/conversation.mjs),
// which add its bot check and daily budget. In your application, they are your
// UAG's URL and the form's URL.
(async function () {
  const UAG_URL = location.origin + '/api/conversation/uag';
  const FORM_URL = UAG_URL + '/service-request';

  // When the demo's guard refuses a turn (the bot check, the budget), the
  // example page around this frame says why.
  async function demoFetch(url, init) {
    const response = await fetch(url, init);
    if ([403, 429, 503].includes(response.status) && window.parent !== window) {
      response.clone().json().then((body) => {
        if (body && body.code) window.parent.postMessage({ type: 'uag-demo', code: body.code, error: body.error }, location.origin);
      }).catch(() => {});
    }
    return response;
  }

  function showReceipt(submission) {
    const receipt = document.getElementById('receipt');
    receipt.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = 'Saved in Form.io: serviceRequest ' + submission._id;
    receipt.appendChild(title);
    const list = document.createElement('dl');
    Object.keys(submission.data || {}).forEach((key) => {
      const value = submission.data[key];
      if (value === '' || value === null || value === undefined || key === 'submit') return;
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value);
      list.append(dt, dd);
    });
    receipt.appendChild(list);
    receipt.hidden = false;
  }

  Formio.use(FormioUAG.UAG(UAG_URL));

  const chat = await Formio.createChat(document.getElementById('chat'), FORM_URL, {
    fetch: demoFetch,
    greeting: 'Hi! I can open a service request for you. What\'s going on?',
    suggestions: [
      'My internet has been down since last night',
      'I\'d like to schedule a router replacement',
      'My bill looks wrong this month'
    ],
    placeholder: 'Describe what you need…',
    submitLabel: 'Submit request',
    submitted: 'Your service request was submitted. We will be in touch soon.',
    // Replies in markdown; the chat sanitizes what this returns.
    markdown: (text) => (window.marked ? window.marked.parse(text, { breaks: true, gfm: true }) : text),
    noAlerts: true
  });

  // The saved request, as Form.io stored it.
  chat.on('submitDone', showReceipt);
  // A new conversation starts the demo's length limit again.
  chat.on('chatReset', () => {
    document.getElementById('receipt').hidden = true;
    fetch('/api/conversation/reset', { method: 'POST' }).catch(() => {});
  });
})();
