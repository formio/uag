// The service request chat: the form, embedded with @formio/uag-js's
// Formio.createChat, exactly as an application embeds it. The conversation runs
// in the UAG (the form's agent/chat operation); this page never names a field.
//
// @formio/uag-js came from the UAG (<script src="{UAG}/uag-js/uag.use.js">) and
// registered itself; js/demo-app.js pointed formio.js at the project and gave it
// the visitor's token. Everything below is what your application would write.
(async function () {
  await DemoApp.ready();

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

  const chat = await Formio.createChat(document.getElementById('chat'), DemoApp.formUrl('service-request'), {
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
  chat.on('chatReset', () => { document.getElementById('receipt').hidden = true; });
})();
