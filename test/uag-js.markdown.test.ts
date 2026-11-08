import { expect } from 'chai';
import { sanitizeMarkdown } from '../src/markdown';

/** uag-js's renderer shows what sanitizeMarkdown escapes as text, without the backslashes. */
describe('@formio/uag-js: renderMarkdown', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { renderMarkdown } = require('../packages/uag-js');

    it('shows backslash-escaped characters as themselves, never as markup', () => {
        expect(renderMarkdown(sanitizeMarkdown('[a [b] c](javascript:alert(1))'))).to.equal('<p>[a [b] c](javascript:alert(1))</p>');
        expect(renderMarkdown('\\<img src=x> a \\\\ b \\*not em\\*')).to.equal('<p>&lt;img src=x&gt; a \\ b *not em*</p>');
        expect(renderMarkdown('`\\[kept\\]` **b** [ok](https://a.com)')).to.equal('<p><code>\\[kept\\]</code> <strong>b</strong> <a href="https://a.com" target="_blank" rel="noopener noreferrer">ok</a></p>');
    });
});
