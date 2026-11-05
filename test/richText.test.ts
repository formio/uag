import { expect } from 'chai';
import { isRichText, sanitizeRichText } from '../src/richText';
import { claimForm, makeProject } from './agent/fixtures';

describe('Rich text values', () => {
    it('keeps the markup editors keep, and escapes text once', () => {
        expect(sanitizeRichText('<h2>Title</h2><p>A &amp; B <strong>bold</strong></p><ul><li>one</li></ul>'))
            .to.equal('<h2>Title</h2><p>A &amp; B <strong>bold</strong></p><ul><li>one</li></ul>');
        expect(sanitizeRichText('<table><tr><td colspan="2" style="x">c</td></tr></table>'))
            .to.equal('<table><tr><td colspan="2">c</td></tr></table>');
        expect(sanitizeRichText('1 < 2')).to.equal('1 &lt; 2');
    });

    it('removes scripts, styles, frames, event handlers and unsafe links', () => {
        const out = sanitizeRichText(
            '<p onclick="x()">Hi</p><script>alert(1)</script><style>p{}</style><iframe src="https://evil"></iframe>' +
            '<img src=x onerror=alert(1)><svg><a href="https://x">in svg</a></svg>' +
            '<a href="javascript:alert(1)">a</a><a href="jav&#x09;ascript:alert(1)">b</a><a href="data:text/html,x">c</a>' +
            '<a href="https://example.com/?a=1&b=2">ok</a><a href="mailto:a@example.com">mail</a>'
        );
        expect(out).to.equal('<p>Hi</p><a>a</a><a>b</a><a>c</a><a href="https://example.com/?a=1&amp;b=2">ok</a><a href="mailto:a@example.com">mail</a>');
    });

    it('drops elements editors do not keep, keeping their text', () => {
        expect(sanitizeRichText('<div><span class="x">kept</span></div>')).to.equal('kept');
    });

    it('applies to textareas with the CKEditor or Quill editor only', () => {
        expect(isRichText({ type: 'textarea', key: 'a', editor: 'ckeditor' } as any)).to.equal(true);
        expect(isRichText({ type: 'textarea', key: 'a', editor: 'quill' } as any)).to.equal(true);
        expect(isRichText({ type: 'textarea', key: 'a' } as any)).to.equal(false);
        expect(isRichText({ type: 'textfield', key: 'a' } as any)).to.equal(false);
    });

    it('is the form\'s normalization of generated values, and leaves other fields alone', () => {
        const form: any = makeProject({ claim: claimForm() }).forms.claim;
        expect(form.formflowNormalizeValue({ type: 'textarea', editor: 'ckeditor' }, '<p>a</p><script>b</script>')).to.equal('<p>a</p>');
        expect(form.formflowNormalizeValue({ type: 'textarea' }, '<p>a</p><script>b</script>')).to.equal('<p>a</p><script>b</script>');
    });
});

describe('Binary values given to agents over MCP', () => {
    it('describes an uploaded file instead of inlining its base64', () => {
        const form: any = makeProject({ claim: claimForm() }).forms.claim;
        form.form.components.push({ type: 'file', key: 'photo', label: 'Photo', input: true, storage: 'base64' });
        const base64 = Buffer.from('a'.repeat(300)).toString('base64');
        const rows = form.formatData({ photo: [{ storage: 'base64', name: 'p.png', originalName: 'p.png', type: 'image/png', size: 300, url: `data:image/png;base64,${base64}` }] });
        const photo = rows.find((row: any) => row.path === 'photo');
        expect(photo.value).to.equal(JSON.stringify({ name: 'p.png', type: 'image/png', size: 300 }));
        expect(JSON.stringify(rows)).to.not.contain(base64);
    });
});
