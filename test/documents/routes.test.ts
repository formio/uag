import { expect } from 'chai';
import { ConverterRoutes, BUILT_IN_CONVERTERS, MIME } from '../../src/documents';

const conv = (name: string, accepts: string[], produces: string[], rank = 0): any => ({ type: 'converter', name, title: name, version: '1.0.0', apiVersion: 1, accepts: accepts.map((type) => ({ type })), produces, rank, convert: async () => ({}) });
const names = (steps: any[] | null | undefined) => steps ? steps.map((s) => s.name) : steps;
const officeText = conv('office-text', [MIME.docx], ['text']);

describe('Documents: converter routes', () => {
    const routes = new ConverterRoutes([...BUILT_IN_CONVERTERS, officeText]);

    it('routes a PDF to itself, and to its text through pdf-text', () => {
        const route = routes.route(MIME.pdf, [['pdf', 'text']]);
        expect(names(route!.pdf)).to.deep.equal([]);
        expect(names(route!.text)).to.deep.equal(['pdf-text']);
    });

    it('routes directly when a converter reads the type', () => {
        expect(names(routes.route(MIME.docx, [['text']])!.text)).to.deep.equal(['office-text']);
        expect(names(routes.route(MIME.csv, [['text']])!.text)).to.deep.equal(['text']);
    });

    it('routes to text through a PDF when nothing reads the type as text', () => {
        expect(names(routes.route(MIME.png, [['text']])!.text)).to.deep.equal(['image-pdf', 'pdf-text']);
    });

    it('derives the text of a [pdf, text] set from that same PDF', () => {
        const route = routes.route(MIME.png, [['pdf', 'text'], ['text']])!;
        expect(route.inputs).to.deep.equal(['pdf', 'text']);
        expect(names(route.pdf)).to.deep.equal(['image-pdf']);
        expect(names(route.text)).to.deep.equal(['image-pdf', 'pdf-text']);
    });

    it('takes the first input set a file can reach: different files of one component may take different sets', () => {
        const inputs: any = [['pdf', 'text'], ['text']];
        expect(routes.route(MIME.pdf, inputs)!.inputs).to.deep.equal(['pdf', 'text']);
        expect(routes.route(MIME.docx, inputs)!.inputs).to.deep.equal(['text']);
    });

    it('chooses the pin, then prefer, then the rank, then the name', () => {
        const a = conv('a', [MIME.docx], ['text'], 5);
        const b = conv('b', [MIME.docx], ['text'], 1);
        const c = conv('c', [MIME.docx], ['text'], 1);
        expect(new ConverterRoutes([b, c, a]).choose(MIME.docx, 'text')!.name).to.equal('a');
        expect(new ConverterRoutes([b, c, a], { [MIME.docx]: 'b' }).choose(MIME.docx, 'text')!.name).to.equal('b');
        expect(new ConverterRoutes([b, c, a], { [MIME.docx]: 'b' }).choose(MIME.docx, 'text', { [MIME.docx]: 'c' })!.name).to.equal('c');
        expect(new ConverterRoutes([c, b]).choose(MIME.docx, 'text')!.name).to.equal('b');
    });

    it('finds no route for a type nothing reads', () => {
        expect(routes.route('application/zip', [['pdf'], ['text']])).to.equal(null);
        expect(new ConverterRoutes(BUILT_IN_CONVERTERS).route(MIME.docx, [['text']])).to.equal(null);
    });

    it('lists the types a plugin can take with their routes, as its manifest accept', () => {
        const accept = routes.accept([['pdf', 'text'], ['text']]);
        const types = accept.map((entry) => entry.type);
        expect(types).to.include.members([MIME.pdf, MIME.docx, MIME.png, MIME.jpeg, MIME.text, MIME.csv, MIME.html]);
        expect(accept.find((entry) => entry.type === MIME.docx)).to.deep.equal({ type: MIME.docx, ext: ['.docx'], routes: { inputs: ['text'], text: ['office-text'] }, converters: ['office-text'] });
        expect(accept.find((entry) => entry.type === MIME.pdf)!.routes).to.deep.equal({ inputs: ['pdf', 'text'], pdf: [], text: ['pdf-text'] });
        // A plugin reading PDFs only cannot take text files.
        expect(routes.accept([['pdf']]).map((entry) => entry.type)).to.not.include(MIME.csv);
    });
});
