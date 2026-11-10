import MarkdownIt from 'markdown-it';

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
 *
 * The result is then parsed as a CommonMark renderer parses it (markdown-it,
 * with tables and strikethrough). A block still holding raw HTML, an image or a
 * link to another target (Markdown that line-by-line cleaning misreads, such as
 * a link whose label holds brackets, or HTML spanning lines) has its `<`, `[`,
 * `]` and `\` escaped, so it shows as text, until the parse finds none.
 */
const SAFE_LINK = /^(https?:|mailto:)/i;
// Up to three spaces: a tab, or four spaces, begins an indented code block, never a fence.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** HTML recognized, so that it is found, and every link target kept, so that it is checked. */
const parser = new MarkdownIt('default', { html: true, linkify: false });
parser.validateLink = () => true;

/** The line ranges (from, to: 0-based, end excluded) of blocks holding HTML, an image or a link sanitizeMarkdown never keeps. */
function unsafeBlocks(markdown: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let block: [number, number] | null = null;
    for (const token of parser.parse(markdown, {})) {
        if (token.map) block = token.map as [number, number];
        if (token.type === 'html_block') {
            if (token.map) ranges.push(token.map as [number, number]);
            continue;
        }
        if (token.type !== 'inline' || !token.children) continue;
        const unsafe = token.children.some((child) => child.type === 'html_inline' || child.type === 'image' ||
            (child.type === 'link_open' && !SAFE_LINK.test(String(child.attrGet('href') || '').trim())));
        const lines = (token.map as [number, number] | null) || block;
        if (unsafe && lines) ranges.push(lines);
    }
    return ranges;
}

/** A line whose markup can form no HTML, image or link: its text shows as it is. */
function escapeLine(line: string): string {
    return line.replace(/[\\<[\]]/g, (char) => `\\${char}`);
}

/** The lines of fenced and indented code blocks, which can hold nothing that acts. */
function codeLines(markdown: string): Set<number> {
    const lines = new Set<number>();
    for (const token of parser.parse(markdown, {})) {
        if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
            for (let i = token.map[0]; i < token.map[1]; i++) lines.add(i);
        }
    }
    return lines;
}

/** Escape the blocks the parse finds unsafe until it finds none; at worst, every line outside code. */
function escapeUnsafeBlocks(markdown: string): string {
    let text = markdown;
    for (let pass = 0; pass < 5; pass++) {
        const ranges = unsafeBlocks(text);
        if (!ranges.length) return text;
        const lines = text.split('\n');
        for (const [from, to] of ranges) {
            for (let i = from; i < to && i < lines.length; i++) lines[i] = escapeLine(lines[i]);
        }
        text = lines.join('\n');
    }
    const code = codeLines(text);
    text = text.split('\n').map((line, i) => (code.has(i) ? line : escapeLine(line))).join('\n');
    return unsafeBlocks(text).length ? text.split('\n').map(escapeLine).join('\n') : text;
}

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
    return escapeUnsafeBlocks(out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim());
}
