import { parse, HTMLElement, Node, NodeType, TextNode } from 'node-html-parser';
import type { Component } from '@formio/core';

/**
 * HTML for rich text fields (textareas with the CKEditor or Quill editor).
 *
 * What an agent engine writes into such a field is reduced to the markup the
 * editors keep, because the engine's input can be steered (a document it reads
 * is someone else's text), and the field is later rendered for reviewers. The
 * HTML is parsed and written out again: allowed elements with their allowed
 * attributes, text escaped, everything else dropped. An element that is not
 * allowed is dropped and its children kept, except for elements whose content
 * is never text to show (scripts, styles, frames, embedded documents).
 */

/** Allowed elements, each with the attributes it may keep. */
export const RICH_TEXT_TAGS: Record<string, string[]> = {
    p: [], br: [], hr: [],
    strong: [], b: [], em: [], i: [], u: [], s: [], sub: [], sup: [], code: [], pre: [],
    h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
    ul: [], ol: [], li: [],
    blockquote: [],
    a: ['href'],
    figure: [], table: [], thead: [], tbody: [], tfoot: [], tr: [],
    th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan']
};

/** Elements dropped with everything inside them. */
const DROPPED_WITH_CONTENT = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'svg', 'math', 'head', 'title', 'textarea', 'select']);

const VOID = new Set(['br', 'hr']);

/** Whether a component is a rich text field, whose value is HTML. */
export function isRichText(component: Component | undefined): boolean {
    const editor = (component as any)?.editor;
    return component?.type === 'textarea' && (editor === 'ckeditor' || editor === 'quill');
}

function escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
    return escapeText(value).replace(/"/g, '&quot;');
}

/** Only links to web pages and mail addresses: never `javascript:`, `data:` or the like. */
function safeHref(value: string): string | null {
    const href = String(value || '').replace(/[\u0000-\u001F\u007F\s]+/g, '');
    return /^(https?:\/\/|mailto:)/i.test(href) ? String(value).trim() : null;
}

function attributesOf(element: HTMLElement, allowed: string[]): string {
    let out = '';
    for (const name of allowed) {
        const raw = element.getAttribute(name);
        if (raw === undefined || raw === null) continue;
        let value: string | null = raw;
        if (name === 'href') value = safeHref(raw);
        if ((name === 'colspan' || name === 'rowspan')) value = /^\d{1,3}$/.test(raw.trim()) ? raw.trim() : null;
        if (value === null) continue;
        out += ` ${name}="${escapeAttribute(value)}"`;
    }
    return out;
}

function write(node: Node): string {
    if (node.nodeType === NodeType.TEXT_NODE) {
        // `text` is the decoded text; it is escaped once, here.
        return escapeText((node as TextNode).text);
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) return '';
    const element = node as HTMLElement;
    const children = () => element.childNodes.map(write).join('');
    const tag = String(element.rawTagName || '').toLowerCase();
    if (!tag) return children();
    if (DROPPED_WITH_CONTENT.has(tag)) return '';
    const allowed = RICH_TEXT_TAGS[tag];
    if (!allowed) return children();
    const open = `<${tag}${attributesOf(element, allowed)}>`;
    return VOID.has(tag) ? open : `${open}${children()}</${tag}>`;
}

/** Reduce HTML to the markup rich text editors keep (RICH_TEXT_TAGS). */
export function sanitizeRichText(html: string): string {
    const root = parse(String(html ?? ''), {
        comment: false,
        lowerCaseTagName: true,
        // Read as raw text, so their content is never parsed as markup; they are dropped.
        blockTextElements: { script: true, style: true, noscript: true }
    });
    return root.childNodes.map(write).join('').trim();
}

/** The rule agents are given for a rich text field's value. */
export const RICH_TEXT_RULE =
    'The value is HTML for a rich text editor. Use only these elements: ' +
    Object.keys(RICH_TEXT_TAGS).join(', ') +
    ', with no attributes except href on a (http, https or mailto links only) and colspan and rowspan on td and th. ' +
    'No other elements, styles, classes, images or scripts, which are removed. Write HTML, not Markdown, and do not wrap it in a code fence.';
