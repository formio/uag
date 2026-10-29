// The flow viewer: every leg of the visitor's own agentic runs, live.
//
// Events come from /api/flow/stream, which carries only this visitor's runs.
// Each run is one X-Request-Id shared by all its legs: the call into the UAG,
// what the UAG asked each engine, the engine's research calls back into /mcp,
// and the save. Request and response events of one leg share a reqId.
(function () {
  var HIDDEN = /^(notification|notifications\/.*|stream|ping)$/;
  var NODES = {
    app: { x: 4, y: 26, label: 'Your app', sub: 'web + server' },
    formio: { x: 104, y: 84, label: 'Form.io', sub: 'forms + data' },
    uag: { x: 104, y: 26, label: 'UAG', sub: 'gateway' },
    engines: { x: 204, y: 26, label: 'Engines', sub: 'engine server' },
    models: { x: 304, y: 26, label: 'Models', sub: 'JEV · Claude' },
  };
  var EDGES = {
    'app-uag': 'M76 44 H104', 'formio-uag': 'M140 84 V62', 'uag-formio': 'M150 62 V84',
    'uag-engines': 'M176 44 H204', 'engines-models': 'M276 44 H304', 'engines-uag': 'M204 52 H176',
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function mapSvg() {
    var svg = '<svg viewBox="0 0 380 124" role="img" aria-label="Where the current step is running">';
    Object.keys(EDGES).forEach(function (id) { svg += '<path class="edge" data-edge="' + id + '" d="' + EDGES[id] + '"/>'; });
    Object.keys(NODES).forEach(function (id) {
      var n = NODES[id];
      svg += '<g class="node" data-node="' + id + '"><rect x="' + n.x + '" y="' + n.y + '" width="72" height="36" rx="7"/>' +
        '<text x="' + (n.x + 36) + '" y="' + (n.y + 16) + '" text-anchor="middle">' + n.label + '</text>' +
        '<text class="sub" x="' + (n.x + 36) + '" y="' + (n.y + 28) + '" text-anchor="middle">' + n.sub + '</text></g>';
    });
    return svg + '</svg>';
  }

  function pretty(text) {
    if (!text) return '';
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return text; }
  }

  function badge(event, run) {
    if (event.kind === 'agent') return ['agent api', 'agent'];
    if (event.kind === 'engine') return ['engine', 'engine'];
    if (event.kind === 'mcp') return [run.engine ? 'research' : 'mcp tool', 'mcp'];
    if (event.kind === 'auth') return ['auth', 'auth'];
    if (/\/submission/.test(event.path || '')) return ['save', 'save'];
    return ['http', 'other'];
  }

  function edgesFor(event, run) {
    if (event.kind === 'engine') return ['uag-engines', 'engines-models'];
    if (event.kind === 'mcp') return run.engine ? ['engines-uag'] : ['app-uag'];
    if (event.kind === 'agent') return ['app-uag'];
    if (/\/submission/.test(event.path || '')) return ['app-uag', 'uag-formio'];
    return ['app-uag'];
  }

  function nodesForEdges(edges) {
    var nodes = {};
    edges.forEach(function (edge) { edge.split('-').forEach(function (n) { nodes[n] = true; }); });
    return Object.keys(nodes);
  }

  /** Which demo a run belongs to: the form it worked on, or `chat` for a conversation turn. */
  function runScope(event) {
    if (event.phase !== 'request') return null;
    if (event.kind === 'agent' && event.form) return event.form;
    if (event.kind === 'mcp' || event.kind === 'auth') return 'chat';
    var match = /^\/([^/]+)\/submission/.exec(event.path || '');
    return match ? match[1] : null;
  }

  function runTitle(run) {
    var first = run.first;
    if (!first) return 'Run';
    if (first.kind === 'agent') {
      return '/agent/' + first.operation + (first.task ? ' · ' + first.task : '');
    }
    if (first.kind === 'mcp' || first.kind === 'auth') return 'Chat turn';
    if (/\/submission/.test(first.path || '')) return 'Save through the UAG';
    return first.label || 'Run';
  }

  function mount(root, options) {
    options = options || {};
    // Only the runs of this page's demo, when the page says which forms it uses.
    var scopes = options.scopes && options.scopes.length ? options.scopes : null;
    root.classList.add('flow');
    root.innerHTML = '';
    var head = el('div', 'flow-head');
    var h3 = el('h3');
    var live = el('span', 'flow-live');
    h3.appendChild(live);
    h3.appendChild(document.createTextNode(options.title || 'Behind the scenes'));
    head.appendChild(h3);
    head.appendChild(el('p', '', options.intro || 'Every call your demo makes, as it happens: into the UAG, out to the engines, and back. Only your own runs are shown.'));
    var map = el('div', 'flow-map');
    map.innerHTML = mapSvg();
    var list = el('div', 'flow-list');
    var empty = el('div', 'flow-empty', options.empty || 'Nothing yet. Use the demo and each step will appear here.');
    list.appendChild(empty);
    var foot = el('div', 'flow-foot');
    var count = el('span', '', '0 calls');
    var clear = el('button', '', 'Clear');
    clear.type = 'button';
    foot.appendChild(count);
    foot.appendChild(clear);
    root.appendChild(head);
    root.appendChild(map);
    root.appendChild(list);
    root.appendChild(foot);

    var runs = {};
    var legs = {};
    var total = 0;
    var activeTimers = {};

    function activate(event, run) {
      var edges = edgesFor(event, run);
      nodesForEdges(edges).concat(edges.map(function (e) { return 'edge:' + e; })).forEach(function (key) {
        var target = key.indexOf('edge:') === 0
          ? map.querySelector('[data-edge="' + key.slice(5) + '"]')
          : map.querySelector('[data-node="' + key + '"]');
        if (!target) return;
        target.classList.add('active');
        clearTimeout(activeTimers[key]);
        activeTimers[key] = setTimeout(function () { target.classList.remove('active'); }, event.phase === 'response' ? 900 : 15000);
      });
    }

    function runFor(event) {
      var id = event.run || 'run';
      var run = runs[id];
      if (!run) {
        run = runs[id] = { id: id, engine: false, first: null, box: el('div', 'flow-run'), headTitle: el('span'), headMeta: el('span') };
        var runHead = el('div', 'flow-run-head');
        runHead.appendChild(run.headTitle);
        runHead.appendChild(run.headMeta);
        run.box.appendChild(runHead);
        list.insertBefore(run.box, list.firstChild);
      }
      return run;
    }

    function handle(event) {
      if (event.kind === 'mcp' && HIDDEN.test(event.label || '')) return;
      var run = runFor(event);
      if (run.scope === undefined || run.scope === null) {
        run.scope = runScope(event);
        if (scopes && run.scope && scopes.indexOf(run.scope) < 0) run.hidden = true;
      }
      if (run.hidden) { run.box.remove(); return; }
      if (empty.parentNode && run.box.parentNode) empty.remove();
      if (event.kind === 'engine') run.engine = true;
      if (!run.first && event.phase === 'request') run.first = event;
      run.headTitle.textContent = runTitle(run);
      var time = new Date(Date.parse(event.ts) || Date.now());
      run.headMeta.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      var leg = legs[event.reqId];
      if (!leg) {
        leg = legs[event.reqId] = { row: el('div', 'flow-event'), kind: el('span', 'flow-kind'), text: el('div'), label: el('span', 'flow-label'), summary: el('span', 'flow-summary'), status: el('span', 'flow-status wait'), detail: null, request: '', response: '' };
        var b = badge(event, run);
        leg.kind.textContent = b[0];
        leg.kind.className = 'flow-kind ' + b[1];
        leg.label.textContent = event.label || event.path || '';
        leg.text.appendChild(leg.label);
        leg.text.appendChild(leg.summary);
        leg.row.appendChild(leg.kind);
        leg.row.appendChild(leg.text);
        leg.row.appendChild(leg.status);
        leg.row.addEventListener('click', function () {
          if (leg.detail) { leg.detail.remove(); leg.detail = null; return; }
          leg.detail = el('pre', 'flow-detail');
          leg.detail.textContent = (leg.request ? '→ request\n' + pretty(leg.request) + '\n\n' : '') + (leg.response ? '← response\n' + pretty(leg.response) : '(waiting for the response)');
          leg.row.appendChild(leg.detail);
        });
        run.box.appendChild(leg.row);
        total++;
        count.textContent = total + (total === 1 ? ' call' : ' calls');
      }
      if (event.phase === 'request') {
        leg.request = event.detail || '';
        if (event.summary) leg.summary.textContent = event.summary;
      }
      else if (event.phase === 'chunk') {
        if (event.summary) leg.summary.textContent = event.summary;
      }
      else if (event.phase === 'response') {
        leg.response = event.detail || '';
        if (event.summary) leg.summary.textContent = event.summary;
        var ok = event.status && event.status < 400;
        leg.status.className = 'flow-status ' + (ok ? 'ok' : 'bad');
        leg.status.textContent = (event.status || '—') + (event.ms !== undefined ? ' · ' + (event.ms >= 1000 ? (event.ms / 1000).toFixed(1) + ' s' : event.ms + ' ms') : '');
      }
      activate(event, run);
      if (typeof options.onEvent === 'function') options.onEvent(event);
    }

    clear.addEventListener('click', function () {
      fetch('/api/flow/clear', { method: 'POST' });
      runs = {}; legs = {}; total = 0;
      list.innerHTML = '';
      list.appendChild(empty);
      count.textContent = '0 calls';
    });

    var source;
    function connect() {
      source = new EventSource('/api/flow/stream');
      source.addEventListener('hello', function (message) {
        var hello = JSON.parse(message.data);
        live.classList.toggle('on', !!hello.enabled);
        if (!hello.enabled) empty.textContent = 'The flow viewer is not connected on this deployment.';
      });
      source.onmessage = function (message) {
        try { handle(JSON.parse(message.data)); } catch (e) { /* skip */ }
      };
      source.onerror = function () { live.classList.remove('on'); };
      source.onopen = function () { live.classList.add('on'); };
    }
    // The stream replays this visitor's buffered events on connect, so start clean.
    connect();
    return { close: function () { source && source.close(); } };
  }

  window.UAGFlow = { mount: mount };
})();
