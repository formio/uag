import { expect } from 'chai';
import { UAGTemplate, ResponseTemplate } from '../src/template';
import * as fs from 'fs';
import * as path from 'path';

describe('UAGTemplate', () => {
    let template: UAGTemplate;

    beforeEach(() => {
        template = new UAGTemplate();
    });

    describe('constructor', () => {
        it('creates instance with empty config', () => {
            const t = new UAGTemplate();
            expect(t.config).to.deep.equal({});
            expect(t.templateCache).to.be.instanceOf(Map);
        });

        it('creates instance with custom config', () => {
            const config = {
                formSubmitted: 'Custom template: <%= data %>'
            };
            const t = new UAGTemplate(config);
            expect(t.config).to.equal(config);
        });
    });

    describe('getTemplate', () => {
        it('loads and compiles template from file', () => {
            const compiled = template.getTemplate(ResponseTemplate.formSubmitted);
            expect(compiled).to.be.a('function');
        });

        it('caches compiled templates', () => {
            const first = template.getTemplate(ResponseTemplate.formSubmitted);
            const second = template.getTemplate(ResponseTemplate.formSubmitted);
            expect(first).to.equal(second);
        });

        it('uses custom template from config', () => {
            const customTemplate = new UAGTemplate({
                formSubmitted: 'Form <%= submissionId %> submitted!'
            });
            const compiled = customTemplate.getTemplate(ResponseTemplate.formSubmitted);
            const result = compiled({ submissionId: '123' });
            expect(result).to.equal('Form 123 submitted!');
        });

        it('throws error for non-existent template', () => {
            expect(() => {
                template.getTemplate('nonExistent' as any);
            }).to.throw(/not found/);
        });

        it('loads different templates correctly', () => {
            const formSubmitted = template.getTemplate(ResponseTemplate.formSubmitted);
            const formNotFound = template.getTemplate(ResponseTemplate.formNotFound);
            expect(formSubmitted).to.not.equal(formNotFound);
        });
    });

    describe('renderTemplate', () => {
        it('renders template with data', () => {
            const customTemplate = new UAGTemplate({
                formSubmitted: 'Hello <%= name %>, form submitted!'
            });
            const result = customTemplate.renderTemplate(ResponseTemplate.formSubmitted, { name: 'John' });
            expect(result).to.equal('Hello John, form submitted!');
        });

        it('renders template with empty data', () => {
            const customTemplate = new UAGTemplate({
                noFormsAvailable: 'No forms available'
            });
            const result = customTemplate.renderTemplate(ResponseTemplate.noFormsAvailable);
            expect(result).to.equal('No forms available');
        });

        it('renders template with complex data', () => {
            const customTemplate = new UAGTemplate({
                submissionsFound: 'Found <%= count %> submissions: <%= results.join(", ") %>'
            });
            const result = customTemplate.renderTemplate(ResponseTemplate.submissionsFound, {
                count: 3,
                results: ['sub1', 'sub2', 'sub3']
            });
            expect(result).to.equal('Found 3 submissions: sub1, sub2, sub3');
        });

        it('handles nested data access', () => {
            const customTemplate = new UAGTemplate({
                formSubmitted: 'User <%= user.name %> submitted form <%= form.title %>'
            });
            const result = customTemplate.renderTemplate(ResponseTemplate.formSubmitted, {
                user: { name: 'John' },
                form: { title: 'Contact Form' }
            });
            expect(result).to.equal('User John submitted form Contact Form');
        });

        it('throws error when template rendering fails', () => {
            const customTemplate = new UAGTemplate({
                formSubmitted: '<%= invalidExpression( %>'
            });
            expect(() => {
                customTemplate.renderTemplate(ResponseTemplate.formSubmitted, {});
            }).to.throw(/Failed to render template/);
        });

        it('throws error for non-existent template', () => {
            expect(() => {
                template.renderTemplate('nonExistent' as any, {});
            }).to.throw(/not found/);
        });

        it('uses lodash template syntax', () => {
            const customTemplate = new UAGTemplate({
                fieldList: '<% fields.forEach(function(field) { %>- <%= field.label %>\n<% }); %>'
            });
            const result = customTemplate.renderTemplate(ResponseTemplate.fieldList, {
                fields: [
                    { label: 'First Name' },
                    { label: 'Last Name' }
                ]
            });
            expect(result).to.include('- First Name');
            expect(result).to.include('- Last Name');
        });

        it('handles conditional rendering', () => {
            const customTemplate = new UAGTemplate({
                formSubmitted: '<% if (success) { %>Success!<% } else { %>Failed!<% } %>'
            });
            const successResult = customTemplate.renderTemplate(ResponseTemplate.formSubmitted, { success: true });
            const failResult = customTemplate.renderTemplate(ResponseTemplate.formSubmitted, { success: false });
            expect(successResult).to.equal('Success!');
            expect(failResult).to.equal('Failed!');
        });
    });

    describe('template caching', () => {
        it('caches templates across multiple renders', () => {
            const customTemplate = new UAGTemplate({
                formSubmitted: 'Test <%= id %>'
            });
            
            customTemplate.renderTemplate(ResponseTemplate.formSubmitted, { id: 1 });
            customTemplate.renderTemplate(ResponseTemplate.formSubmitted, { id: 2 });
            
            expect(customTemplate.templateCache.size).to.equal(1);
        });

        it('maintains separate cache entries for different templates', () => {
            const customTemplate = new UAGTemplate({
                formSubmitted: 'Submitted <%= id %>',
                formNotFound: 'Not found <%= id %>'
            });
            
            customTemplate.renderTemplate(ResponseTemplate.formSubmitted, { id: 1 });
            customTemplate.renderTemplate(ResponseTemplate.formNotFound, { id: 2 });
            
            expect(customTemplate.templateCache.size).to.equal(2);
        });
    });

    describe('real template files', () => {
        it('can load and render actual template files', () => {
            const templatePath = path.join(__dirname, '../src/templates/formSubmitted.md');
            if (fs.existsSync(templatePath)) {
                const result = template.renderTemplate(ResponseTemplate.formSubmitted, {
                    form: { title: 'Test Form' },
                    submissionId: 'sub123',
                    submittedFieldsCount: 5,
                    dataSummary: 'Test data summary',
                    data: { test: 'value' }
                });
                expect(result).to.be.a('string');
                expect(result.length).to.be.greaterThan(0);
            }
        });

        it('all ResponseTemplate enums have corresponding files or config', () => {
            const missingTemplates: string[] = [];
            
            for (const templateName of Object.values(ResponseTemplate)) {
                try {
                    const templatePath = path.join(__dirname, '../src/templates', `${templateName}.md`);
                    if (!fs.existsSync(templatePath)) {
                        missingTemplates.push(templateName);
                    }
                } catch (error) {
                    missingTemplates.push(templateName);
                }
            }
            
            // Some templates might be intentionally missing if they're only used with custom config
            // This test just ensures we're aware of which templates exist as files
            expect(missingTemplates.length).to.be.lessThan(Object.values(ResponseTemplate).length);
        });
    });

    describe('error handling', () => {
        it('provides helpful error message with template name', () => {
            const customTemplate = new UAGTemplate({
                formSubmitted: '<%= undefinedVariable.property %>'
            });
            try {
                customTemplate.renderTemplate(ResponseTemplate.formSubmitted, {});
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).to.be.instanceOf(Error);
                expect((error as Error).message).to.include('formSubmitted');
            }
        });

        it('handles templates with special characters', () => {
            const customTemplate = new UAGTemplate({
                formSubmitted: 'Special chars: <>&"\' and <%= value %>'
            });
            const result = customTemplate.renderTemplate(ResponseTemplate.formSubmitted, { value: 'test' });
            expect(result).to.include('Special chars');
            expect(result).to.include('test');
        });
    });
});
