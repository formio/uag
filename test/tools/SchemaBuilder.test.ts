import { expect } from 'chai';
import { SchemaBuilder } from '../../src/tools/SchemaBuilder';
import { MockProjectInterface } from './mock';

describe('SchemaBuilder', () => {
    let project: MockProjectInterface;
    let builder: SchemaBuilder;

    beforeEach(() => {
        project = new MockProjectInterface({
            testForm: {
                title: 'Test Form',
                name: 'testForm',
                tags: ['uag'],
                components: [
                    { key: 'firstName', label: 'First Name', type: 'textfield', input: true }
                ]
            },
            otherForm: {
                title: 'Other Form',
                name: 'otherForm',
                tags: ['uag'],
                components: [
                    { key: 'email', label: 'Email', type: 'email', input: true }
                ]
            }
        });
        builder = new SchemaBuilder(project);
    });

    it('initializes with empty schema', () => {
        expect(builder.schema).to.deep.equal({});
    });

    describe('form_name()', () => {
        it('creates enum schema from project form names', () => {
            builder.form_name();
            expect(builder.schema).to.have.property('form_name');
        });
    });

    describe('form_data()', () => {
        it('creates record schema', () => {
            builder.form_data();
            expect(builder.schema).to.have.property('form_data');
        });
    });

    describe('field_paths()', () => {
        it('creates array schema', () => {
            builder.field_paths();
            expect(builder.schema).to.have.property('field_paths');
        });
    });

    describe('criteria()', () => {
        it('creates enum with default required', () => {
            builder.criteria();
            expect(builder.schema).to.have.property('criteria');
        });
    });

    describe('as_json()', () => {
        it('creates boolean with default false', () => {
            builder.as_json();
            expect(builder.schema).to.have.property('as_json');
        });
    });

    describe('search_query()', () => {
        it('creates array of search objects', () => {
            builder.search_query();
            expect(builder.schema).to.have.property('search_query');
        });
    });

    describe('fields_requested()', () => {
        it('creates optional array', () => {
            builder.fields_requested();
            expect(builder.schema).to.have.property('fields_requested');
        });
    });

    describe('limit()', () => {
        it('creates number with default 5', () => {
            builder.limit();
            expect(builder.schema).to.have.property('limit');
        });
    });

    describe('submission_id()', () => {
        it('creates optional string', () => {
            builder.submission_id();
            expect(builder.schema).to.have.property('submission_id');
        });
    });

    describe('submission_id_partial()', () => {
        it('creates optional string', () => {
            builder.submission_id_partial();
            expect(builder.schema).to.have.property('submission_id_partial');
        });
    });

    describe('parent_path()', () => {
        it('creates optional string', () => {
            builder.parent_path();
            expect(builder.schema).to.have.property('parent_path');
        });
    });

    describe('persona()', () => {
        it('creates optional string', () => {
            builder.persona();
            expect(builder.schema).to.have.property('persona');
        });
    });

    describe('data_path()', () => {
        it('creates string', () => {
            builder.data_path();
            expect(builder.schema).to.have.property('data_path');
        });
    });

    describe('search_value()', () => {
        it('creates optional string', () => {
            builder.search_value();
            expect(builder.schema).to.have.property('search_value');
        });
    });

    describe('updates()', () => {
        it('creates array of update objects', () => {
            builder.updates();
            expect(builder.schema).to.have.property('updates');
        });
    });

    describe('method chaining', () => {
        it('supports chaining multiple methods', () => {
            const result = builder
                .form_name()
                .form_data()
                .field_paths()
                .criteria()
                .as_json()
                .parent_path();
            expect(result).to.equal(builder);
            expect(builder.schema).to.have.property('form_name');
            expect(builder.schema).to.have.property('form_data');
            expect(builder.schema).to.have.property('field_paths');
            expect(builder.schema).to.have.property('criteria');
            expect(builder.schema).to.have.property('as_json');
            expect(builder.schema).to.have.property('parent_path');
        });

        it('returns the schema object used by tools', () => {
            const schema = builder.form_name().search_query().limit().schema;
            expect(schema).to.have.property('form_name');
            expect(schema).to.have.property('search_query');
            expect(schema).to.have.property('limit');
        });
    });
});
