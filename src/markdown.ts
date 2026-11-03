/**
 * The Markdown contract of AI-generated content: GitHub-flavored Markdown,
 * UTF-8, `\n` line endings, no code fence around the whole value.
 *
 * `sanitizeMarkdown` keeps what the AI Document's renderer shows and nothing
 * that could act in a browser:
 * - raw HTML is removed, keeping its text;
 * - links keep only http, https and mailto targets (others become their text);
 * - images are dropped;
 * - a code fence wrapping the whole value is removed;
 * - trailing whitespace is trimmed and more than two blank lines collapsed.
 * Code blocks and inline code are kept as they are: the renderer escapes them.
 */
const SAFE_LINK = /^(https?:|mailto:)/i;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** A whole value wrapped in one code fence: its contents. */
function unwrapFence(text: string): string {
    const trimmed = text.trim();
    const match = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(trimmed);
    if (!match) return text;
    // Only when no other fence of the same kind is inside: then it really is one block.
    if (new RegExp(`^\\s{0,3}${match[1][0] === '`' ? '`' : '~'}{3,}`, 'm').test(match[2])) return text;
    return match[2];
}

/** Clean the text of one line outside code: HTML, images and unsafe links. */
function cleanLine(line: string): string {
    // Inline code spans are kept as they are.
    const parts = line.split(/(`+[^`]*`+)/);
    return parts.map((part, i) => {
        if (i % 2 === 1) return part;
        let out = part;
        // Images: dropped, inline and reference style.
        out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/!\[[^\]]*\]\[[^\]]*\]/g, '');
        // Links: kept only for safe targets.
        out = out.replace(/\[([^\]]*)\]\(\s*<?((?:[^()\s<>]|\([^()\s]*\))*)>?(?:\s+"[^"]*")?\s*\)/g, (whole, label, target) => SAFE_LINK.test(target) ? `[${label}](${target})` : label);
        // Autolinks: <https://...> kept when safe; anything else in angle brackets is HTML.
        const autolinks: string[] = [];
        out = out.replace(/<([a-z][a-z0-9+.-]*:[^>\s]*)>/gi, (whole, target) => {
            if (!SAFE_LINK.test(target)) return '';
            autolinks.push(`<${target}>`);
            return `\u0000${autolinks.length - 1}\u0000`;
        });
        // Raw HTML: tags removed, their text kept.
        out = out.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[A-Za-z][^<>]*>/g, '');
        return out.replace(/\u0000(\d+)\u0000/g, (whole, index) => autolinks[Number(index)]);
    }).join('');
}

export function sanitizeMarkdown(markdown: string): string {
    const text = unwrapFence(String(markdown ?? '').replace(/\r\n?/g, '\n'));
    const out: string[] = [];
    let fence: string | null = null;
    // HTML blocks spanning several lines (a comment, a script) are removed whole.
    let inComment = false;
    for (const raw of text.split('\n')) {
        let line = raw;
        const opener = FENCE.exec(line);
        if (fence) {
            if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length && line.trim().replace(/[`~]/g, '') === '') fence = null;
            out.push(line.replace(/\s+$/, ''));
            continue;
        }
        if (opener) {
            fence = opener[1];
            out.push(line.replace(/\s+$/, ''));
            continue;
        }
        if (inComment) {
            const end = line.indexOf('-->');
            if (end < 0) continue;
            line = line.slice(end + 3);
            inComment = false;
        }
        const start = line.indexOf('<!--');
        if (start >= 0 && line.indexOf('-->', start) < 0) {
            line = line.slice(0, start);
            inComment = true;
        }
        // Reference definitions with an unsafe target are dropped.
        const definition = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(\s.*)?$/.exec(line);
        if (definition) {
            if (SAFE_LINK.test(definition[1])) out.push(line.replace(/\s+$/, ''));
            continue;
        }
        out.push(cleanLine(line).replace(/\s+$/, ''));
    }
    return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}
