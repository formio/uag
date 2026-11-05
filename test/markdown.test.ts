import { expect } from 'chai';
import { parse } from 'node-html-parser';
import { sanitizeMarkdown } from '../src/markdown';

describe('sanitizeMarkdown', () => {
    it('removes raw HTML, keeping its text', () => {
        expect(sanitizeMarkdown('Hello <b>bold</b> <span onclick="x()">world</span><br>')).to.equal('Hello bold world');
        expect(sanitizeMarkdown('<script>steal()</script>Text')).to.equal('steal()Text');
        expect(sanitizeMarkdown('Before <!-- hidden\nstill hidden --> after')).to.equal('Before\n after');
    });

    it('keeps only http, https and mailto links', () => {
        expect(sanitizeMarkdown('[ok](https://example.com) [mail](mailto:a@example.com) [bad](javascript:alert(1)) [data](data:text/html,x)'))
            .to.equal('[ok](https://example.com) [mail](mailto:a@example.com) bad data');
        expect(sanitizeMarkdown('<https://example.com> <javascript:alert(1)>')).to.equal('<https://example.com>');
        expect(sanitizeMarkdown('[a][ref]\n\n[ref]: javascript:alert(1)\n[ok]: https://example.com')).to.equal('[a][ref]\n\n[ok]: https://example.com');
    });

    it('drops images', () => {
        expect(sanitizeMarkdown('Before ![logo](https://example.com/x.png) after')).to.equal('Before  after');
    });

    it('removes a code fence wrapping the whole value, and keeps code blocks inside it as they are', () => {
        expect(sanitizeMarkdown('```markdown\n# Title\n\nText\n```')).to.equal('# Title\n\nText');
        expect(sanitizeMarkdown('Intro\n\n```html\n<b>kept</b>\n```')).to.equal('Intro\n\n```html\n<b>kept</b>\n```');
        expect(sanitizeMarkdown('Use `<b>` here')).to.equal('Use `<b>` here');
    });

    it('trims trailing whitespace, uses \\n line endings and collapses more than two blank lines', () => {
        expect(sanitizeMarkdown('a  \r\nb\t\n\n\n\n\n\nc')).to.equal('a\nb\n\n\nc');
    });

    it('keeps the Markdown the renderer shows: headings, lists, tables, emphasis', () => {
        const md = '# Agreement\n\n1. One\n2. Two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n*em* **strong**';
        expect(sanitizeMarkdown(md)).to.equal(md);
    });

    it('keeps nothing a CommonMark renderer turns into HTML, a script link or an image, however the Markdown is written', async () => {
        const { marked } = require('marked');
        const cases = [
            '[a [b] c](javascript:alert(1))',
            "[x](javascript:alert(1) 'title')",
            'see [x][r]\n\n[r]:\n  javascript:alert(1)',
            '<a\nhref="javascript:alert(1)">x</a>',
            '<img src=x\nonerror=alert(1)>',
            '\t```\n<img src=x onerror=alert(1)>\n\t```',
            '[![x](https://e.com/i.png)](javascript:alert(1))',
            '<div\nonclick="alert(1)">x</div>'
        ];
        for (const input of cases) {
            const html = String(await marked.parse(sanitizeMarkdown(input)));
            // The rendered elements: Markdown's own only, no handlers, links only to safe targets. Text may say anything.
            for (const element of parse(html).querySelectorAll('*')) {
                expect(['p', 'a', 'em', 'strong', 'code', 'pre', 'br'], `${input} → ${html}`).to.include(element.rawTagName.toLowerCase());
                expect(Object.keys(element.attributes).filter((name) => name !== 'href'), `${input} → ${html}`).to.deep.equal([]);
                if (element.rawTagName.toLowerCase() === 'a') expect(element.getAttribute('href'), `${input} → ${html}`).to.match(/^(https?:|mailto:)/);
            }
        }
    });

    it('keeps the text of a block it escapes', () => {
        expect(sanitizeMarkdown('[a [b] c](javascript:alert(1)) and [ok](https://example.com)')).to.include('a');
        expect(sanitizeMarkdown('[a [b] c](javascript:alert(1))')).to.equal('\\[a \\[b\\] c\\](javascript:alert(1))');
    });
});
