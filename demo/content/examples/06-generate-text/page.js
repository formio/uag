// The form's "Draft a reply" button (an event button) asks the UAG for a draft.
form.on('draftReply', async () => {
  const response = await fetch('UAG_PROJECT_URL/example-generate-text/agent/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-jwt-token': Formio.getToken() },
    body: JSON.stringify({ task: 'reply', data: form.submission.data, overwrite: true }),
  });
  const result = await response.json();
  // Only the fields the task wrote; the person's own values stay as they are.
  const reply = result.fields && result.fields.reply;
  if (reply && reply.value) form.getComponent('reply').setValue(reply.value);
});
