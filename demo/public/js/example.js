// A feature example's page: its sample buttons put their text into the live
// form (public/apps/example), which fills in from it as if the visitor had typed
// it. Messages go to the frame only, on this origin.
(function () {
  var frame = document.querySelector('[data-demo-frame]');
  var samples = document.querySelector('[data-example-samples]');
  if (!frame || !samples) return;
  samples.addEventListener('click', function (event) {
    var button = event.target.closest('[data-sample]');
    if (!button) return;
    if (frame.hidden || !frame.contentWindow) {
      var start = document.querySelector('[data-demo-start]');
      if (start) start.focus();
      return;
    }
    frame.contentWindow.postMessage({ type: 'uag-example-sample', text: button.getAttribute('data-sample') }, location.origin);
  });
})();
