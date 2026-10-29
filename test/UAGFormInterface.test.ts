import { expect } from 'chai';
import { UAGFormInterface } from '../src/UAGFormInterface';
import { Component, Submission } from '@formio/core';

describe('UAGFormInterface', () => {
    let uagForm: UAGFormInterface;
    let mockAuthInfo: any;

    beforeEach(() => {
        mockAuthInfo = {
            user: { _id: 'user123' },
            token: 'test-token'
        };

        // Create a mock UAGFormInterface instance
        uagForm = Object.create(UAGFormInterface.prototype);
        uagForm.form = {
            _id: 'form123',
            title: 'Test Form',
            name: 'testForm',
            path: 'testform',
            components: [
                {
                    type: 'textfield',
                    key: 'firstName',
                    label: 'First Name',
                    input: true,
                    validate: { required: true },
                    placeholder: 'Enter your first name'
                },
                {
                    type: 'email',
                    key: 'email',
                    label: 'Email',
                    input: true,
                    validate: { required: true }
                },
                {
                    type: 'phoneNumber',
                    key: 'phone',
                    label: 'Phone',
                    input: true,
                    inputMask: '(999) 999-9999'
                },
                {
                    type: 'select',
                    key: 'color',
                    label: 'Favorite Color',
                    input: true,
                    data: {
                        values: [
                            { label: 'Red', value: 'red' },
                            { label: 'Blue', value: 'blue' },
                            { label: 'Green', value: 'green' }
                        ]
                    }
                },
                {
                    type: 'checkbox',
                    key: 'agree',
                    label: 'I agree to the terms',
                    input: true
                },
                {
                    type: 'number',
                    key: 'age',
                    label: 'Age',
                    input: true
                },
                {
                    type: 'datetime',
                    key: 'birthDate',
                    label: 'Birth Date',
                    input: true,
                    widget: { format: 'yyyy-MM-dd' }
                },
                {
                    type: 'day',
                    key: 'appointmentDay',
                    label: 'Appointment Day',
                    input: true,
                    dayFirst: false
                },
                {
                    type: 'selectboxes',
                    key: 'interests',
                    label: 'Interests',
                    input: true,
                    values: [
                        { label: 'Sports', value: 'sports' },
                        { label: 'Music', value: 'music' }
                    ]
                },
                {
                    type: 'button',
                    key: 'submit',
                    label: 'Submit',
                    input: false
                }
            ]
        } as any;

        // Mock the process method for getFields
        uagForm.process = async (submission: Submission, auth: any, headers: any, findQuery: any, additional: any[]) => {
            // Execute the getFields processor
            const getFieldsProcessor = additional.find((p: any) => p.name === 'getFields');
            if (getFieldsProcessor) {
                for (const component of uagForm.form.components) {
                    if (component.input !== false) {
                        await getFieldsProcessor.postProcess({
                            component,
                            path: component.key,
                            value: submission?.data?.[component.key]
                        });
                    }
                }
            }
            return {};
        };

        // Mock validate method
        uagForm.validate = async (submission: Submission, auth: any) => {
            const errors: any[] = [];
            for (const component of uagForm.form.components) {
                if (component.validate?.required && !submission.data?.[component.key]) {
                    errors.push({
                        message: `${component.label} is required`,
                        context: {
                            label: component.label,
                            path: component.key
                        }
                    });
                }
            }
            return errors;
        };
    });

    describe('getComponentFormat', () => {
        it('returns correct format for phoneNumber', () => {
            const component = { type: 'phoneNumber', inputMask: '(999) 999-9999' } as any;
            expect(uagForm.getComponentFormat(component)).to.equal('(999) 999-9999');
        });

        it('returns default format for phoneNumber without inputMask', () => {
            const component = { type: 'phoneNumber' } as any;
            expect(uagForm.getComponentFormat(component)).to.equal('(999) 999-9999');
        });

        it('returns correct format for datetime', () => {
            const component = { type: 'datetime', widget: { format: 'yyyy-MM-dd HH:mm' } } as any;
            expect(uagForm.getComponentFormat(component)).to.equal('yyyy-MM-dd HH:mm');
        });

        it('returns default format for datetime without widget', () => {
            const component = { type: 'datetime' } as any;
            expect(uagForm.getComponentFormat(component)).to.equal('yyyy-MM-dd hh:mm a');
        });

        it('returns correct format for day with dayFirst true', () => {
            const component = { type: 'day', dayFirst: true } as any;
            expect(uagForm.getComponentFormat(component)).to.equal('dd/MM/yyyy');
        });

        it('returns correct format for day with dayFirst false', () => {
            const component = { type: 'day', dayFirst: false } as any;
            expect(uagForm.getComponentFormat(component)).to.equal('MM/dd/yyyy');
        });

        it('returns empty string for unsupported types', () => {
            const component = { type: 'textfield' } as any;
            expect(uagForm.getComponentFormat(component)).to.equal('');
        });
    });

    describe('getComponentInfo', () => {
        it('returns basic component info', () => {
            const component = {
                type: 'textfield',
                key: 'firstName',
                label: 'First Name',
                description: 'Your first name',
                validate: { required: true }
            } as any;

            const info = uagForm.getComponentInfo(component, 'firstName');
            expect(info.path).to.equal('firstName');
            expect(info.label).to.equal('First Name');
            expect(info.type).to.equal('textfield');
            expect(info.description).to.equal('Your first name');
            expect(info.validation).to.deep.equal({ required: true });
        });

        it('uses key as label when label is missing', () => {
            const component = { type: 'textfield', key: 'fieldKey' } as any;
            const info = uagForm.getComponentInfo(component, 'fieldKey');
            expect(info.label).to.equal('fieldKey');
        });

        it('includes placeholder as prompt', () => {
            const component = {
                type: 'textfield',
                key: 'name',
                label: 'Name',
                placeholder: 'Enter your name'
            } as any;
            const info = uagForm.getComponentInfo(component, 'name');
            expect(info.prompt).to.equal('Enter your name');
        });

        it('returns options for select component', () => {
            const component = {
                type: 'select',
                key: 'color',
                label: 'Color',
                data: {
                    values: [
                        { label: 'Red', value: 'red' },
                        { label: 'Blue', value: 'blue' }
                    ]
                }
            } as any;
            const info = uagForm.getComponentInfo(component, 'color');
            expect(info.options).to.be.an('array');
            expect(info.options?.length).to.equal(2);
            expect(info.options?.[0]).to.deep.equal({ label: 'Red', value: 'red' });
        });

        it('returns options for a radio component, which its rule refers to', () => {
            const component = {
                type: 'radio',
                key: 'urgency',
                label: 'Urgency',
                values: [
                    { label: 'Low', value: 'low' },
                    { label: 'High', value: 'high' }
                ]
            } as any;
            const info = uagForm.getComponentInfo(component, 'urgency');
            expect(info.options).to.deep.equal([{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }]);
            expect(uagForm.getComponentValueRule(component)).to.include('"**Options**" section');
        });

        it('handles select with URL data source', () => {
            const component = {
                type: 'select',
                key: 'country',
                label: 'Country',
                dataSrc: 'url'
            } as any;
            const info = uagForm.getComponentInfo(component, 'country');
            expect(info.options?.[0].value).to.include('URL');
        });

        it('handles select with resource data source', () => {
            const component = {
                type: 'select',
                key: 'user',
                label: 'User',
                dataSrc: 'resource',
                data: { resource: 'users' }
            } as any;
            const info = uagForm.getComponentInfo(component, 'user');
            expect(info.options?.[0].value).to.include('resource');
        });

        it('handles select with no values', () => {
            const component = {
                type: 'select',
                key: 'empty',
                label: 'Empty',
                data: {}
            } as any;
            const info = uagForm.getComponentInfo(component, 'empty');
            expect(info.options?.[0].value).to.equal('No options available');
        });
    });

    describe('isMultiple', () => {
        it('returns true for component with multiple flag', () => {
            expect(uagForm.isMultiple({ type: 'select', multiple: true } as any)).to.be.true;
        });

        it('returns true for selectboxes', () => {
            expect(uagForm.isMultiple({ type: 'selectboxes' } as any)).to.be.true;
        });

        it('returns true for tags', () => {
            expect(uagForm.isMultiple({ type: 'tags' } as any)).to.be.true;
        });

        it('returns false for single value components', () => {
            expect(uagForm.isMultiple({ type: 'textfield' } as any)).to.be.false;
        });

        it('returns false for undefined component', () => {
            expect(uagForm.isMultiple(undefined)).to.be.false;
        });
    });

    describe('getComponentValueRule', () => {
        it('returns rule for textfield', () => {
            const rule = uagForm.getComponentValueRule({ type: 'textfield' } as any);
            expect(rule).to.include('alphanumeric');
        });

        it('returns rule for checkbox', () => {
            const rule = uagForm.getComponentValueRule({ type: 'checkbox' } as any);
            expect(rule).to.include('boolean');
        });

        it('returns rule for number', () => {
            const rule = uagForm.getComponentValueRule({ type: 'number' } as any);
            expect(rule).to.include('valid number');
        });

        it('returns rule for email', () => {
            const rule = uagForm.getComponentValueRule({ type: 'email' } as any);
            expect(rule).to.include('email address');
        });

        it('returns rule for select', () => {
            const rule = uagForm.getComponentValueRule({ type: 'select' } as any);
            expect(rule).to.include('options');
        });

        it('returns rule for password', () => {
            const rule = uagForm.getComponentValueRule({ type: 'password' } as any);
            expect(rule).to.include('Do not allow');
        });

        it('returns empty string for unknown type', () => {
            const rule = uagForm.getComponentValueRule({ type: 'unknown' } as any);
            expect(rule).to.equal('');
        });
    });

    describe('getParentInfoFromComponent', () => {
        it('treats a container saved with tree: true as a container, not a table', () => {
            // The form builder saves containers with `tree: true`, as it does grids.
            const container = { type: 'container', key: 'customer', label: 'Customer', input: true, tree: true, components: [] } as any;
            const parent = uagForm.getParentInfoFromComponent(container, 'customer');
            expect(parent?.isContainer).to.equal(true);
            expect(parent?.isTable).to.not.equal(true);
            expect(uagForm.getParentDataPath(parent)).to.equal('customer');
            expect(uagForm.getComponentValueRule(container, 'customer')).to.contain('object/map');
        });

        it('treats a datagrid as a table', () => {
            const grid = { type: 'datagrid', key: 'rows', label: 'Rows', input: true, tree: true, components: [] } as any;
            const parent = uagForm.getParentInfoFromComponent(grid, 'rows');
            expect(parent?.isTable).to.equal(true);
            expect(uagForm.getParentDataPath(parent, 2)).to.equal('rows[2]');
        });
    });

    describe('getFields', () => {
        it('separates required and optional fields', async () => {
            const submission = { data: {} } as Submission;
            const fields = await uagForm.getFields(submission, mockAuthInfo);

            expect(fields.required.components).to.be.an('array');
            expect(fields.optional.components).to.be.an('array');
            expect(fields.required.rules).to.be.an('object');
            expect(fields.optional.rules).to.be.an('object');

            const requiredPaths = fields.required.components.map(f => f.path);
            expect(requiredPaths).to.include('firstName');
            expect(requiredPaths).to.include('email');
        });

        it('excludes button components', async () => {
            const submission = { data: {} } as Submission;
            const fields = await uagForm.getFields(submission, mockAuthInfo);

            const allPaths = [...fields.required.components, ...fields.optional.components].map(f => f.path);
            expect(allPaths).to.not.include('submit');
        });

        it('moves filled required fields to optional', async () => {
            const submission = {
                data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            } as Submission;
            const fields = await uagForm.getFields(submission, mockAuthInfo);

            const requiredPaths = fields.required.components.map(f => f.path);
            expect(requiredPaths).to.not.include('firstName');
            expect(requiredPaths).to.not.include('email');
        });

        it('includes field rules', async () => {
            const submission = { data: {} } as Submission;
            const fields = await uagForm.getFields(submission, mockAuthInfo);

            expect(fields.required.rules).to.have.property('textfield');
            expect(fields.required.rules).to.have.property('email');
            expect(fields.optional.rules).to.have.property('phoneNumber');
        });

        it('lists its own rule for a component whose rule differs from others of its type', async () => {
            uagForm.form.components = [
                { type: 'select', key: 'country', label: 'Country', input: true, dataSrc: 'url', data: { url: 'https://api.example.com/countries' } },
                { type: 'select', key: 'color', label: 'Color', input: true, data: { values: [{ label: 'Red', value: 'red' }] } },
                { type: 'select', key: 'shade', label: 'Shade', input: true, data: { values: [{ label: 'Dark', value: 'dark' }] } }
            ] as any;
            const fields = await uagForm.getFields({ data: {} } as Submission, mockAuthInfo);
            const rules = fields.optional.rules;
            // Keyed by type alone, the static selects' rule replaced the one telling
            // the agent to fetch the country options.
            expect(Object.keys(rules)).to.have.members(['select', 'select (color)', 'select (shade)']);
            expect(rules.select).to.contain('fetch_external_data');
            expect(rules['select (color)']).to.contain('**Options**');
            expect(rules['select (shade)']).to.equal(rules['select (color)']);
        });

        describe('within a parent path', () => {
            const name = { type: 'textfield', key: 'name', label: 'Name', input: true };
            const notes = { type: 'textarea', key: 'customerNotes', label: 'Notes', input: true };
            /** Hands the getFields processor these components at these paths. */
            const feed = (entries: [any, string][]) => {
                uagForm.process = async (_submission: Submission, _auth: any, _headers: any, _findQuery: any, additional: any[]) => {
                    const getFields = additional.find((p: any) => p.name === 'getFields');
                    for (const [component, path] of entries) {
                        await getFields.postProcess({ component, path, value: undefined });
                    }
                    return {} as any;
                };
            };

            it('includes only its children, not siblings whose key starts with it', async () => {
                feed([[name, 'customer.name'], [notes, 'customerNotes']]);
                const fields = await uagForm.getFields({ data: {} } as Submission, mockAuthInfo, 'customer');
                const paths = [...fields.required.components, ...fields.optional.components].map((f) => f.path);
                expect(paths).to.deep.equal(['customer.name']);
            });

            it('reports the row of the parent table, not of a table it sits in', async () => {
                feed([[name, 'outer[0].inner[3].name']]);
                const fields = await uagForm.getFields({ data: {} } as Submission, mockAuthInfo, 'outer[0].inner');
                expect(fields.rowIndex).to.equal(3);
            });
        });
    });

    describe('getComponent', () => {
        it('returns component by path', () => {
            const component = uagForm.getComponent('firstName');
            expect(component).to.exist;
            expect(component?.key).to.equal('firstName');
        });

        it('returns undefined for non-existent path', () => {
            const component = uagForm.getComponent('nonExistent');
            expect(component).to.be.undefined;
        });
    });

    describe('validateData', () => {
        it('returns empty array for valid data', async () => {
            const submission = {
                data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            } as Submission;

            const errors = await uagForm.validateData(submission, mockAuthInfo);
            expect(errors).to.be.an('array');
            expect(errors.length).to.equal(0);
        });

        it('returns validation errors for missing required fields', async () => {
            const submission = {
                data: {
                    firstName: 'John'
                }
            } as Submission;

            const errors = await uagForm.validateData(submission, mockAuthInfo);
            expect(errors).to.be.an('array');
            expect(errors.length).to.be.greaterThan(0);
            expect(errors[0]).to.have.property('label');
            expect(errors[0]).to.have.property('path');
            expect(errors[0]).to.have.property('error');
        });

        it('includes field context in errors', async () => {
            const submission = { data: {} } as Submission;
            const errors = await uagForm.validateData(submission, mockAuthInfo);

            const emailError = errors.find(e => e.path === 'email');
            expect(emailError).to.exist;
            expect(emailError?.label).to.equal('Email');
        });
    });

    describe('convertToSubmission', () => {
        it('converts flat data to submission', () => {
            const data = {
                firstName: 'John',
                email: 'john@example.com'
            };

            const submission = uagForm.convertToSubmission(data);
            expect(submission.data).to.deep.equal(data);
        });

        it('converts nested path data', () => {
            const data = {
                'person.name': 'John',
                'person.email': 'john@example.com'
            };

            const submission = uagForm.convertToSubmission(data);
            expect(submission.data).to.have.property('person');
            expect((submission.data as any).person).to.have.property('name', 'John');
            expect((submission.data as any).person).to.have.property('email', 'john@example.com');
        });

        it('converts selectboxes to object format', () => {
            const data = {
                interests: 'sports,music'
            };

            const submission = uagForm.convertToSubmission(data);
            expect((submission.data as any).interests).to.deep.equal({
                sports: true,
                music: true
            });
        });

        it('converts multiple select to array', () => {
            uagForm.form.components.push({
                type: 'select',
                key: 'colors',
                label: 'Colors',
                multiple: true,
                input: true
            } as any);

            const data = {
                colors: 'red,blue,green'
            };

            const submission = uagForm.convertToSubmission(data);
            expect((submission.data as any).colors).to.be.an('array');
            expect((submission.data as any).colors).to.deep.equal(['red', 'blue', 'green']);
        });

        it('trims comma-separated values', () => {
            uagForm.form.components.push({
                type: 'tags',
                key: 'tags',
                label: 'Tags',
                input: true
            } as any);

            const data = {
                tags: 'tag1, tag2 , tag3'
            };

            const submission = uagForm.convertToSubmission(data);
            expect((submission.data as any).tags).to.deep.equal(['tag1', 'tag2', 'tag3']);
        });
    });

    describe('formatSubmission', () => {
        it('formats submission data as array', () => {
            const submission = {
                _id: 'sub123',
                data: {
                    firstName: 'John',
                    email: 'john@example.com'
                },
                created: '2025-01-01',
                modified: '2025-01-02'
            } as any;

            const formatted = uagForm.formatSubmission(submission);
            expect(formatted._id).to.equal('sub123');
            expect(formatted.data).to.be.an('array');
            expect(formatted.created).to.equal('2025-01-01');
            expect(formatted.modified).to.equal('2025-01-02');
        });

        it('includes field labels in formatted data', () => {
            const submission = {
                data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            } as any;

            const formatted = uagForm.formatSubmission(submission);
            const firstNameField = formatted.data.find(d => d.path === 'firstName');
            expect(firstNameField).to.exist;
            expect(firstNameField?.label).to.equal('First Name');
            expect(firstNameField?.value).to.equal('"John"');
        });

        it('excludes empty and null values', () => {
            const submission = {
                data: {
                    firstName: 'John',
                    email: '',
                    phone: null,
                    age: undefined
                }
            } as any;

            const formatted = uagForm.formatSubmission(submission);
            const paths = formatted.data.map(d => d.path);
            expect(paths).to.include('firstName');
            expect(paths).to.not.include('email');
            expect(paths).to.not.include('phone');
            expect(paths).to.not.include('age');
        });

        it('indents values by how deeply they are nested, after leaving a nested component', () => {
            uagForm.form.components = [
                {
                    type: 'container', key: 'outer', label: 'Outer', input: true, tree: true, components: [
                        { type: 'datagrid', key: 'rows', label: 'Rows', input: true, tree: true, components: [
                            { type: 'textfield', key: 'a', label: 'A', input: true }
                        ] },
                        { type: 'textfield', key: 'after', label: 'After', input: true }
                    ]
                },
                { type: 'textfield', key: 'last', label: 'Last', input: true }
            ] as any;
            const formatted = uagForm.formatData({ outer: { rows: [{ a: 'x' }], after: 'y' }, last: 'z' });
            const prefixOf = (label: string) => formatted.find((d) => d.label === label)?.prefix;
            expect(prefixOf('Outer')).to.equal('');
            expect(prefixOf('Rows')).to.equal('  ');
            expect(prefixOf('A')).to.equal('    ');
            expect(prefixOf('After')).to.equal('  ');
            expect(prefixOf('Last')).to.equal('');
        });

        it('includes zero values', () => {
            const submission = {
                data: {
                    age: 0
                }
            } as any;

            const formatted = uagForm.formatSubmission(submission);
            const ageField = formatted.data.find(d => d.path === 'age');
            expect(ageField).to.exist;
            expect(ageField?.value).to.equal(0);
        });
    });
});
