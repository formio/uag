// Site-wide behavior: the mobile menu, tabs, copy buttons and the docs code blocks.
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
    var code = button.closest('.code').querySelector('code');
    navigator.clipboard.writeText(code.innerText).then(function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = 'Copy'; }, 1600);
    });
  });

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
