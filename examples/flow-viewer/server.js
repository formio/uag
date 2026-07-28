/**
 * uag-flow — logging reverse proxy + live flow viewer for the Form.io UAG.
 *
 * Sits in front of the UAG and the integration so every leg of an agentic run
 * passes through it and can be watched as it happens:
 *   - /agent/*  -> the integration (webhook leg: commands sent to the agent)
 *   - /flow*    -> served here     (viewer page, SSE event stream, history)
 *   - all else  -> the UAG         (auth + MCP leg: token calls, JSON-RPC tool calls)
 *
 * Point your webhook actions and the integration's UAG_SERVER at this service
 * instead of at the UAG directly, and the whole run becomes visible.
 *
 * Zero npm dependencies. Events are pushed live over SSE, and additionally
 * appended to DATA_FILE as JSON lines when that variable is set.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3250', 10);
const UAG = { host: process.env.UAG_HOST || 'formio-uag', port: 3200 };
const CLAUDE = { host: process.env.CLAUDE_HOST || 'formio-uag-claude', port: 3300 };
const DATA_FILE = process.env.DATA_FILE || '';
const MAX_BUFFER = 500; // events kept in memory for new viewers
const MAX_DETAIL = 8 * 1024; // bytes of request/response detail kept per event
const MAX_CHUNK_EVENTS = 20; // per-request cap on mid-stream chunk events

const events = []; // ring buffer
const clients = new Set(); // open SSE responses
let nextId = 1;

function emit(event) {
  event.id = nextId++;
  event.ts = new Date().toISOString();
  events.push(event);
  if (events.length > MAX_BUFFER) events.shift();
  const line = JSON.stringify(event);
  if (DATA_FILE) fs.appendFile(DATA_FILE, line + '\n', () => {});
  for (const res of clients) {
    res.write(`data: ${line}\n\n`);
  }
}

function truncate(str) {
  if (!str) return '';
  return str.length > MAX_DETAIL ? str.slice(0, MAX_DETAIL) + `… [+${str.length - MAX_DETAIL} bytes]` : str;
}

function tryJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/** Pull the human-interesting bits out of a request. */
function describeRequest(url, body, headers) {
  const json = tryJson(body);
  if (url.startsWith('/agent/')) {
    const cmd = url.split('/').pop();
    return {
      kind: 'webhook',
      label: `webhook → ${cmd}`,
      summary: json
        ? `form=${json.formName || '?'} persona=${json.persona || '-'} submission=${json.submissionId || '?'}`
        : '',
      session: null,
    };
  }
  if (url.includes('/mcp')) {
    const session = headers['mcp-session-id'] || null;
    if (json && json.method === 'tools/call') {
      const tool = json.params && json.params.name;
      const args = json.params && json.params.arguments;
      return {
        kind: 'mcp',
        label: `tool: ${tool}`,
        summary: args ? truncate(JSON.stringify(args)).slice(0, 200) : '',
        session,
      };
    }
    if (json && json.method) {
      return { kind: 'mcp', label: `mcp: ${json.method}`, summary: '', session };
    }
    return { kind: 'mcp', label: 'mcp: (stream channel)', summary: '', session };
  }
  if (url.includes('/auth/token')) {
    return { kind: 'auth', label: 'auth: token', summary: '', session: null };
  }
  if (url.includes('/.well-known/')) {
    return { kind: 'auth', label: `auth: ${url.split('/').pop()}`, summary: '', session: null };
  }
  return { kind: 'other', label: url.slice(0, 80), summary: '', session: null };
}

/** Best-effort summary of a completed response body. */
function describeResponse(body, contentType) {
  if (!body) return '';
  if ((contentType || '').includes('text/event-stream')) {
    // collect data: frames; summarize the last JSON-RPC payload
    const frames = body
      .split(/\n\n/)
      .map((f) => f.replace(/^(data:\s?)/m, '').trim())
      .filter(Boolean);
    const last = tryJson(frames[frames.length - 1] || '');
    if (last && last.result && last.result.content) {
      const text = last.result.content
        .map((c) => c.text || '')
        .join(' ')
        .slice(0, 300);
      return text;
    }
    return `${frames.length} stream frame(s)`;
  }
  const json = tryJson(body);
  if (json) {
    if (json.content && Array.isArray(json.content)) {
      // Anthropic API response (webhook leg)
      const text = json.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join(' ');
      return truncate(text).slice(0, 300) || json.stop_reason || '';
    }
    if (json.access_token) return 'token issued';
    return truncate(JSON.stringify(json)).slice(0, 300);
  }
  return '';
}

function serveFile(res, name, type) {
  fs.readFile(path.join(__dirname, name), (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('missing ' + name);
      return;
    }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  // ---- viewer surface ----
  if (url === '/flow' || url === '/flow/') {
    return serveFile(res, 'index.html', 'text/html; charset=utf-8');
  }
  if (url === '/flow/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
    clients.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
    return;
  }
  if (url === '/flow/history') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(events));
    return;
  }

  // ---- proxy surface ----
  const target = url.startsWith('/agent/') ? CLAUDE : UAG;
  const reqId = `r${nextId}`;
  const started = Date.now();

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const bodyStr = body.toString('utf8');
    const desc = describeRequest(url, bodyStr, req.headers);
    emit({
      reqId,
      phase: 'request',
      kind: desc.kind,
      label: desc.label,
      summary: desc.summary,
      session: desc.session,
      method: req.method,
      path: url.slice(0, 200),
      detail: truncate(bodyStr),
    });

    const headers = { ...req.headers, host: `${target.host}:${target.port}` };
    if (body.length) headers['content-length'] = String(body.length);

    const upstream = http.request(
      { hostname: target.host, port: target.port, path: url, method: req.method, headers },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        const isSSE = (up.headers['content-type'] || '').includes('text/event-stream');
        let captured = '';
        let chunkEvents = 0;
        let sseBuffer = '';
        up.on('data', (chunk) => {
          res.write(chunk); // passthrough first, always
          if (captured.length < MAX_DETAIL * 4) captured += chunk.toString('utf8');
          if (isSSE && chunkEvents < MAX_CHUNK_EVENTS) {
            sseBuffer += chunk.toString('utf8');
            let idx;
            while ((idx = sseBuffer.indexOf('\n\n')) >= 0 && chunkEvents < MAX_CHUNK_EVENTS) {
              const frame = sseBuffer.slice(0, idx).replace(/^(data:\s?)/m, '').trim();
              sseBuffer = sseBuffer.slice(idx + 2);
              if (!frame || frame.startsWith(':')) continue;
              chunkEvents++;
              const json = tryJson(frame);
              emit({
                reqId,
                phase: 'chunk',
                kind: desc.kind,
                label: desc.label,
                session: desc.session,
                summary: json && json.method ? `↦ ${json.method}` : truncate(frame).slice(0, 120),
              });
            }
          }
        });
        up.on('end', () => {
          res.end();
          emit({
            reqId,
            phase: 'response',
            kind: desc.kind,
            label: desc.label,
            session: desc.session,
            status: up.statusCode,
            ms: Date.now() - started,
            summary: describeResponse(captured, up.headers['content-type']),
            detail: truncate(captured),
          });
        });
      }
    );
    upstream.on('error', (err) => {
      emit({
        reqId,
        phase: 'response',
        kind: desc.kind,
        label: desc.label,
        session: desc.session,
        status: 502,
        ms: Date.now() - started,
        summary: `proxy error: ${err.message}`,
      });
      if (!res.headersSent) res.writeHead(502);
      res.end('uag-flow: upstream error');
    });
    upstream.end(body);
  });
});

server.listen(PORT, () => console.log(`uag-flow listening on ${PORT} (uag=${UAG.host}, claude=${CLAUDE.host})`));
