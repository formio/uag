// A feature example's page: its sample buttons put their text into the live
// form (public/apps/example), which fills in from it as if the visitor had typed
// it, or upload a file of the example's into it, as if the visitor had chosen
// it. Messages go to the frame only, on this origin.
(function () {
  var frame = document.querySelector('[data-demo-frame]');
  var samples = document.querySelector('[data-example-samples]');
  if (!frame || !samples) return;
  samples.addEventListener('click', function (event) {
    var button = event.target.closest('[data-sample], [data-sample-file]');
    if (!button) return;
    event.preventDefault();
    if (frame.hidden || !frame.contentWindow) {
      var start = document.querySelector('[data-demo-start]');
      if (start) start.focus();
      return;
    }
    var message = button.hasAttribute('data-sample-file')
      // A file to upload into the form, as if the visitor had chosen it.
      ? { type: 'uag-example-sample', file: button.href }
      : { type: 'uag-example-sample', text: button.getAttribute('data-sample') };
    frame.contentWindow.postMessage(message, location.origin);
  });
})();
