/**
 * Diagrams for the docs, written as fenced code blocks and drawn as SVG in the
 * site's style, so a page's pictures live next to its text.
 *
 * ```sequence
 * participants: Browser, Your backend, UAG*, Form.io
 * Browser -> Your backend: POST /api/agent/extract
 * Your backend -> UAG: {form}/agent/extract, x-admin-key
 * note UAG: plans the task
 * UAG --> Your backend: event: result
 * ```
 *
 * A `*` after a participant highlights it. `->` is a call, `-->` a reply.
 * `note <participant>: text` writes a note on a lifeline.
 *
 * ```pipeline
 * UAG boots -> reads {PROJECT}/export -> registers tagged forms* -> serves /mcp
 * ```
 *
 * A `*` after a step highlights it; steps wrap onto rows of four.
 */
import { escapeHtml } from './docs.mjs';

const FONT = "font-family=\"Inter, system-ui, sans-serif\"";
const CHAR = 6.6;

function wrap(text, width) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
        if (line && (line.length + word.length + 1) * CHAR > width) {
            lines.push(line);
            line = word;
        }
        else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) lines.push(line);
    return lines;
}

function star(name) {
    const trimmed = name.trim();
    return { name: trimmed.replace(/\*$/, '').trim(), highlighted: trimmed.endsWith('*') };
}

export function sequence(source) {
    const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
    const header = lines.find((line) => /^participants:/i.test(line));
    if (!header) return null;
    const participants = header.replace(/^participants:/i, '').split(',').map(star);
    const index = new Map(participants.map((p, i) => [p.name, i]));
    const steps = [];
    for (const line of lines) {
        if (line === header) continue;
        const note = /^note\s+(.+?):\s*(.+)$/i.exec(line);
        if (note && index.has(note[1].trim())) {
            steps.push({ note: true, at: index.get(note[1].trim()), text: note[2] });
            continue;
        }
        const message = /^(.+?)\s*(-->|->)\s*(.+?):\s*(.+)$/.exec(line);
        if (message && index.has(message[1].trim()) && index.has(message[3].trim())) {
            steps.push({ from: index.get(message[1].trim()), to: index.get(message[3].trim()), reply: message[2] === '-->', text: message[4] });
        }
    }
    const width = 760;
    const column = width / participants.length;
    const x = (i) => column * i + column / 2;
    const boxWidth = Math.min(150, column - 16);
    const names = participants.map((p) => wrap(p.name, boxWidth - 14));
    const headHeight = Math.max(...names.map((lines) => lines.length)) * 14 + 22;
    let y = headHeight + 30;
    const body = [];
    for (const step of steps) {
        if (step.note) {
            const lines = wrap(step.text, 180);
            const h = 14 + lines.length * 15;
            const w = Math.min(196, Math.max(...lines.map((l) => l.length * CHAR)) + 20);
            body.push(`<rect x="${x(step.at) - w / 2}" y="${y}" width="${w}" height="${h}" rx="6" fill="#edfae6" stroke="#c9e8b4"/>`);
            lines.forEach((l, i) => body.push(`<text x="${x(step.at)}" y="${y + 18 + i * 15}" text-anchor="middle" font-size="11.5" fill="#3f7a22">${escapeHtml(l)}</text>`));
            y += h + 14;
            continue;
        }
        const span = Math.abs(x(step.to) - x(step.from)) || column;
        const lines = wrap(step.text, Math.max(120, span - 24));
        const labelTop = y;
        y += lines.length * 15 + 6;
        const color = step.reply ? '#8d99a8' : '#69b342';
        const x1 = x(step.from);
        const x2 = x(step.to);
        const mid = (x1 + x2) / 2;
        lines.forEach((l, i) => body.push(`<text x="${mid}" y="${labelTop + 11 + i * 15}" text-anchor="middle" font-size="11.5" fill="#2a333e">${escapeHtml(l)}</text>`));
        if (x1 === x2) {
            body.push(`<path d="M${x1} ${y} h34 v14 h-30" fill="none" stroke="${color}" stroke-width="1.8" marker-end="url(#seq-${step.reply ? 'reply' : 'call'})"/>`);
            y += 30;
        }
        else {
            const dir = x2 > x1 ? -1 : 1;
            body.push(`<path d="M${x1} ${y} H${x2 + dir * 6}" fill="none" stroke="${color}" stroke-width="1.8"${step.reply ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#seq-${step.reply ? 'reply' : 'call'})"/>`);
            y += 22;
        }
    }
    const height = y + 16;
    const heads = participants.map((p, i) => [
        `<line x1="${x(i)}" y1="${headHeight + 10}" x2="${x(i)}" y2="${height - 8}" stroke="#d7d7de" stroke-dasharray="4 4"/>`,
        `<rect x="${x(i) - boxWidth / 2}" y="8" width="${boxWidth}" height="${headHeight}" rx="8" fill="${p.highlighted ? '#3a4756' : '#fff'}" stroke="${p.highlighted ? '#3a4756' : '#e0e5ec'}"/>`,
        ...names[i].map((line, n) => `<text x="${x(i)}" y="${8 + headHeight / 2 - (names[i].length - 1) * 7 + 4 + n * 14}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${p.highlighted ? '#fff' : '#0c141d'}">${escapeHtml(line)}</text>`),
    ].join('')).join('');
    return `<figure class="figure diagram doc-diagram"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(steps.map((s) => s.text).join('; '))}" ${FONT}>`
        + '<defs><marker id="seq-call" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#69b342"/></marker>'
        + '<marker id="seq-reply" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8d99a8"/></marker></defs>'
        + heads + body.join('') + '</svg></figure>\n';
}

export function pipeline(source) {
    const steps = source.split(/->|\n/).map((step) => step.trim()).filter(Boolean).map(star);
    if (!steps.length) return null;
    const perRow = Math.min(4, steps.length);
    const width = 760;
    const gap = 30;
    const boxWidth = (width - gap * (perRow - 1)) / perRow;
    const rows = [];
    for (let i = 0; i < steps.length; i += perRow) rows.push(steps.slice(i, i + perRow));
    const heights = rows.map((row) => Math.max(...row.map((s) => wrap(s.name, boxWidth - 24).length)) * 16 + 28);
    const body = [];
    let y = 4;
    rows.forEach((row, r) => {
        const h = heights[r];
        row.forEach((step, c) => {
            const bx = c * (boxWidth + gap);
            const lines = wrap(step.name, boxWidth - 24);
            body.push(`<rect x="${bx}" y="${y}" width="${boxWidth}" height="${h}" rx="10" fill="${step.highlighted ? '#3a4756' : '#fff'}" stroke="${step.highlighted ? '#3a4756' : '#e0e5ec'}"/>`);
            const top = y + h / 2 - (lines.length - 1) * 8 + 4;
            lines.forEach((l, i) => body.push(`<text x="${bx + boxWidth / 2}" y="${top + i * 16}" text-anchor="middle" font-size="12.5" font-weight="600" fill="${step.highlighted ? '#fff' : '#0c141d'}">${escapeHtml(l)}</text>`));
            const last = r === rows.length - 1 && c === row.length - 1;
            if (c < row.length - 1) {
                body.push(`<path d="M${bx + boxWidth + 4} ${y + h / 2} h${gap - 10}" stroke="#69b342" stroke-width="2" marker-end="url(#pipe-arrow)"/>`);
            }
            else if (!last) {
                // Down and back to the start of the next row.
                body.push(`<path d="M${bx + boxWidth / 2} ${y + h + 2} v10 H${boxWidth / 2} v${12}" fill="none" stroke="#69b342" stroke-width="2" marker-end="url(#pipe-arrow)"/>`);
            }
        });
        y += h + 30;
    });
    const height = y - 26;
    return `<figure class="figure diagram doc-diagram"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(steps.map((s) => s.name).join(', then '))}" ${FONT}>`
        + '<defs><marker id="pipe-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#69b342"/></marker></defs>'
        + body.join('') + '</svg></figure>\n';
}
