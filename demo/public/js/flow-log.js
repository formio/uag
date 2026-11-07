// The flow log's recorder: every call this page makes to the UAG, or to the
// Form.io project (the forms it loads), as events the flow panel draws
// (js/flow-panel.js). It wraps window.fetch, which formio.js and @formio/uag-js
// both use, so it sees exactly what an application embedding them sends. It
// sends nothing anywhere: in a demo frame its events go to the example page
// around it (postMessage, same origin only); on a page of its own they are
// dispatched on window as `uag-flow` events.
//
// Bodies are cut to 4 KB, and tokens and passwords never leave this page's
// memory: they are replaced with [redacted] before an event is made.
(function () {
  if (window.UAGFlowLog) return;
  var MAX_DETAIL = 4096;
  var SECRET_KEYS = /^(password|token|x-jwt-token|jwt|authorization|x-token|x-admin-key)$/i;

  function settings() {
    var el = document.documentElement.dataset.uagUrl ? document.documentElement : document.body || document.documentElement;
    return el.dataset || {};
  }
  function origins() {
    var s = settings();
    var list = [];
    [s.uagUrl, s.projectUrl].forEach(function (url) {
      try { if (url) list.push(new URL(url, location.href).origin); } catch (e) { /* not a URL */ }
    });
    return list;
  }

  function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
      var copy = {};
      Object.keys(value).forEach(function (key) {
        copy[key] = SECRET_KEYS.test(key) && value[key] ? '[redacted]' : redact(value[key]);
      });
      return copy;
    }
    return value;
  }

  /** A body as the panel shows it: JSON pretty-printed and redacted, cut to MAX_DETAIL. */
  function detailOf(text) {
    if (!text) return '';
    var out = text;
    try { out = JSON.stringify(redact(JSON.parse(text)), null, 2); } catch (e) { /* not JSON */ }
    return out.length > MAX_DETAIL ? out.slice(0, MAX_DETAIL) + '\n… (' + (out.length - MAX_DETAIL) + ' more characters)' : out;
  }

  /** What a call is, from where it goes, its method and its path. */
  function describe(method, path, toProject) {
    if (toProject) {
      if (/\/guest\/register\/submission$/.test(path)) return { kind: 'auth', label: 'Register a guest at Form.io' };
      if (/\/current$/.test(path)) return { kind: 'formio', label: 'GET ' + path + ' (who is signed in)' };
      return { kind: 'formio', label: method + ' ' + path + (method === 'GET' && !/\/submission/.test(path) ? ' (the form)' : '') };
    }
    var agent = /\/([^/]+)\/agent\/(chat|extract|decide|generate)$/.exec(path);
    if (agent) return { kind: 'agent', operation: agent[2], form: agent[1], label: method + ' ' + path };
    if (/\/document\/process$/.test(path)) return { kind: 'agent', operation: 'document', label: method + ' ' + path };
    if (/\/guest\/register\/submission$/.test(path)) return { kind: 'auth', label: 'Register a guest through the UAG' };
    if (/\/submission(\/[^/]+)?$/.test(path)) return { kind: 'http', label: method + ' ' + path };
    return { kind: 'http', label: method + ' ' + path };
  }

  /** One line about what the engines did, from an Agent API result or a chat turn. */
  function engineSummary(body) {
    if (!body || typeof body !== 'object') return '';
    var engines = Array.isArray(body.engines) ? body.engines : body.engine ? [body.engine] : [];
    var parts = engines.map(function (engine) {
      if (!engine || typeof engine !== 'object') return String(engine || '');
      var name = engine.engine || engine.name || '';
      var ms = engine.latencyMs !== undefined ? (engine.latencyMs >= 1000 ? (engine.latencyMs / 1000).toFixed(1) + ' s' : engine.latencyMs + ' ms') : '';
      var usage = engine.usage ? (Number(engine.usage.inputTokens || 0) + Number(engine.usage.outputTokens || 0)) : 0;
      return [name, engine.model, ms, usage ? usage.toLocaleString() + ' tokens' : ''].filter(Boolean).join(' · ');
    }).filter(Boolean);
    return parts.length ? 'engines: ' + parts.join('; ') : '';
  }

  var counter = 0;
  function emit(event) {
    event.ts = event.ts || new Date().toISOString();
    if (window.parent !== window) {
      try { window.parent.postMessage({ type: 'uag-flow', event: event }, location.origin); } catch (e) { /* no parent */ }
    }
    try { window.dispatchEvent(new CustomEvent('uag-flow', { detail: event })); } catch (e) { /* old browser */ }
  }

  /** Read an event stream as it arrives, emitting each event, without consuming the caller's copy. */
  function teeStream(response, base, started) {
    if (!response.body || !response.body.getReader) return;
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var all = '';
    var last = null;
    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          emit(Object.assign({}, base, { phase: 'response', status: response.status, ms: Date.now() - started, detail: detailOf(last ? JSON.stringify(last) : all), summary: engineSummary(last) || base.summary }));
          return;
        }
        var text = decoder.decode(chunk.value, { stream: true });
        all = (all + text).slice(-MAX_DETAIL * 4);
        buffer += text;
        var blocks = buffer.split('\n\n');
        buffer = blocks.pop();
        blocks.forEach(function (block) {
          var name = 'message';
          var data = '';
          block.split('\n').forEach(function (line) {
            if (line.indexOf('event:') === 0) name = line.slice(6).trim();
            else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
          });
          var parsed = null;
          try { parsed = JSON.parse(data); } catch (e) { /* not JSON */ }
          if (parsed) last = parsed;
          emit(Object.assign({}, base, { phase: 'chunk', summary: name + (engineSummary(parsed) ? ' · ' + engineSummary(parsed) : '') }));
        });
        return pump();
      });
    }
    pump().catch(function () {
      emit(Object.assign({}, base, { phase: 'response', status: response.status, ms: Date.now() - started, summary: 'stream ended early' }));
    });
  }

  var original = window.fetch && window.fetch.bind(window);
  if (!original) return;

  /**
   * fetch, recorded when it goes to the UAG or the project. `options.reqId`
   * makes calls share one row (the workflow's polling), and `options.run`
   * groups rows under one heading.
   */
  function recorded(input, init, options) {
    var url;
    try { url = new URL(typeof input === 'string' ? input : input.url, location.href); } catch (e) { return original(input, init); }
    if (origins().indexOf(url.origin) < 0) return original(input, init);
    // formio.js asks Form.io who is signed in on its own, again and again: not the demo's calls.
    if (/\/current$/.test(url.pathname) && !options) return original(input, init);
    options = options || {};
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var reqId = options.reqId || 'call-' + (++counter) + '-' + Date.now();
    var project = settings().projectUrl;
    var toProject = false;
    try { toProject = !!project && url.origin === new URL(project, location.href).origin && url.origin !== new URL(settings().uagUrl, location.href).origin; } catch (e) { /* not URLs */ }
    var base = Object.assign({ run: options.run || reqId, reqId: reqId, path: url.pathname, method: method }, describe(method, url.pathname, toProject));
    if (options.label) base.label = options.label;
    var body = init && typeof init.body === 'string' ? init.body : '';
    var started = Date.now();
    emit(Object.assign({}, base, { phase: 'request', detail: detailOf(body) }));
    return original(input, init).then(function (response) {
      var type = response.headers.get('content-type') || '';
      if (type.indexOf('text/event-stream') >= 0) {
        teeStream(response.clone(), base, started);
      }
      else {
        response.clone().text().then(function (text) {
          var parsed = null;
          try { parsed = JSON.parse(text); } catch (e) { /* not JSON */ }
          emit(Object.assign({}, base, { phase: 'response', status: response.status, ms: Date.now() - started, detail: detailOf(text), summary: engineSummary(parsed) || options.summary || '' }));
        }).catch(function () {});
      }
      return response;
    }, function (error) {
      emit(Object.assign({}, base, { phase: 'response', status: 0, ms: Date.now() - started, summary: 'network error' }));
      throw error;
    });
  }

  window.fetch = function (input, init) { return recorded(input, init); };

  window.UAGFlowLog = {
    /** fetch with recording options: { reqId, run, label, summary }. */
    fetch: recorded,
    /** A row the page adds itself, such as a workflow stage the polling saw change. */
    note: function (event) {
      var reqId = event.reqId || 'note-' + (++counter) + '-' + Date.now();
      emit(Object.assign({ run: reqId, reqId: reqId, kind: 'task' }, event, { phase: 'response', status: event.status || 200 }));
    },
    redact: redact,
    detailOf: detailOf,
    engineSummary: engineSummary,
  };
})();
