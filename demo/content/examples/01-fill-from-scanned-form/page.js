// When the AI Document has read the scan into "transcript" (its target field),
// Agent Input fills the rest of the form from that text.
const agent = FormioUAG.UAG.attach(form, {});
form.on('uagDocumentResult', (event) => {
  if (event.path === 'scan' && form.submission.data.transcript) agent.extract();
});
