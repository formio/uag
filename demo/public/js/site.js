// Site-wide behavior: the mobile menu, tabs, copy buttons, the docs code blocks
// and the "Watch the demo" recordings.
(function () {
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.menu-toggle');
  if (toggle && header) {
    toggle.addEventListener('click', function () {
      var open = header.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // Tabs: <div class="tabs"><div class="tab-list" role="tablist"><button role="tab" aria-controls="id"> ...
  document.querySelectorAll('.tabs').forEach(function (tabs) {
    var buttons = tabs.querySelectorAll('[role="tab"]');
    function select(button) {
      buttons.forEach(function (other) {
        var selected = other === button;
        other.setAttribute('aria-selected', String(selected));
        other.tabIndex = selected ? 0 : -1;
        var panel = document.getElementById(other.getAttribute('aria-controls'));
        if (panel) panel.hidden = !selected;
      });
    }
    buttons.forEach(function (button, index) {
      button.addEventListener('click', function () { select(button); });
      button.addEventListener('keydown', function (event) {
        var step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        var next = buttons[(index + step + buttons.length) % buttons.length];
        select(next);
        next.focus();
      });
    });
  });

  // Copy buttons on code blocks.
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-copy]');
    if (!button) return;
    var code = button.closest('.code, .install').querySelector('code');
    navigator.clipboard.writeText(code.innerText).then(function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = 'Copy'; }, 1600);
    });
  });

  // "Watch the demo": the recording opens in a dialog. It is loaded only when
  // asked for, and starts from the beginning each time.
  var watchButtons = document.querySelectorAll('[data-watch]');
  if (watchButtons.length) {
    var dialog = document.createElement('dialog');
    dialog.className = 'watch';
    dialog.setAttribute('aria-labelledby', 'watch-title');
    dialog.innerHTML = '<div class="watch-head"><h2 id="watch-title"></h2>' +
      '<button type="button" class="watch-close" aria-label="Close">&times;</button></div>' +
      '<div class="watch-media"></div>' +
      '<p class="watch-note">Recorded from this demo with real models. Waiting for a model is sped up, and signing in is cut.</p>';
    document.body.appendChild(dialog);
    var media = dialog.querySelector('.watch-media');
    dialog.querySelector('.watch-close').addEventListener('click', function () { dialog.close(); });
    // A click on the backdrop lands on the dialog itself.
    dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', function () { media.textContent = ''; });
    watchButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        var image = document.createElement('img');
        image.alt = button.getAttribute('data-watch-alt') || '';
        image.src = button.getAttribute('data-watch');
        media.textContent = '';
        media.appendChild(image);
        dialog.querySelector('#watch-title').textContent = button.getAttribute('data-watch-title') || 'The demo, recorded';
        dialog.showModal();
      });
    });
  }

  // Light syntax coloring for the languages the docs use most: comments, strings and keys.
  document.querySelectorAll('.code code').forEach(function (block) {
    var lang = (block.className.match(/language-(\w+)/) || [])[1] || '';
    if (!/^(bash|sh|shell|yaml|yml|json|js|javascript|ts|typescript|http|dockerfile|env)$/.test(lang)) return;
    var html = block.innerHTML;
    var hash = /^(bash|sh|shell|yaml|yml|dockerfile|env)$/.test(lang);
    var parts = [];
    html.split('\n').forEach(function (line) {
      var comment = hash ? line.match(/^(\s*)(#.*)$/) : line.match(/^(\s*)(\/\/.*)$/);
      if (comment) { parts.push(comment[1] + '<span class="tok-c">' + comment[2] + '</span>'); return; }
      // innerHTML escapes only &, < and > in text: quotes come through as themselves.
      line = line.replace(/("[^"]*"|'[^']*')(\s*:)?/g, function (match, str, colon) {
        return colon ? '<span class="tok-k">' + str + '</span>' + colon : '<span class="tok-s">' + str + '</span>';
      });
      parts.push(line);
    });
    block.innerHTML = parts.join('\n');
  });
})();
