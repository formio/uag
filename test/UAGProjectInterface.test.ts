import { expect } from 'chai';
import { UAGProjectInterface } from '../src/UAGProjectInterface';
import { ResponseTemplate } from '../src/template';

describe('UAGProjectInterface', () => {
    let project: UAGProjectInterface;

    beforeEach(() => {
        // Create a mock project instance
        project = Object.create(UAGProjectInterface.prototype);
        project.forms = {};
        project.formNames = [];
        project.user = null;
        project.mcpServer = {
            registerTool: () => { }
        } as any;
        project.uagTemplate = {
            renderTemplate: (templateName: string, data: any) => {
                return `Template: ${templateName} with ${JSON.stringify(data)}`;
            }
        } as any;
    });

    describe('mcpResponse', () => {
        it('returns response with rendered template', () => {
            const response = project.mcpResponse(ResponseTemplate.formSubmitted, { test: 'data' });

            expect(response).to.have.property('content');
            expect(response.content).to.be.an('array');
            expect(response.content[0]).to.have.property('type', 'text');
            expect(response.content[0].text).to.include('formSubmitted');
        });

        it('includes data in template rendering', () => {
            const response = project.mcpResponse(ResponseTemplate.formSubmitted, { formName: 'testForm' });
            expect(response.content[0].text).to.include('testForm');
        });

        it('handles empty data object', () => {
            const response = project.mcpResponse(ResponseTemplate.noFormsAvailable);
            expect(response).to.have.property('content');
            expect(response.content[0]).to.have.property('text');
        });
    });

    describe('addForm', () => {
        it('registers form with uag tag', () => {
            const mockForm = {
                _id: 'form123',
                title: 'Test Form',
                name: 'testForm',
                path: 'testform',
                key: 'testForm',
                tags: ['uag'],
                components: []
            } as any;

            const formInterface = project.addForm(mockForm, 'testForm');

            expect(formInterface).to.exist;
            expect(formInterface?.uag).to.exist;
            expect(formInterface?.uag?.name).to.equal('testForm');
            expect(formInterface?.uag?.title).to.equal('Test Form');
            expect(project.formNames).to.include('testForm');
        });

        it('uses form properties for uag configuration', () => {
            const mockForm = {
                _id: 'form123',
                title: 'Contact Form',
                name: 'contactForm',
                path: 'contact',
                key: 'contact',
                tags: ['uag'],
                properties: {
                    description: 'A form for contact information'
                },
                components: []
            } as any;

            const formInterface = project.addForm(mockForm, 'contact');

            expect(formInterface?.uag?.description).to.equal('A form for contact information');
        });

        it('does not register form without uag tag', () => {
            const mockForm = {
                _id: 'form123',
                title: 'Regular Form',
                name: 'regularForm',
                key: 'regularForm',
                tags: [],
                components: []
            } as any;

            const formInterface = project.addForm(mockForm, 'regularForm');

            expect(formInterface?.uag).to.not.exist;
            expect(project.formNames).to.not.include('regularForm');
        });

        it('generates default description if not provided', () => {
            const mockForm = {
                _id: 'form123',
                title: 'User Form',
                name: 'userForm',
                key: 'userForm',
                tags: ['uag'],
                components: []
            } as any;

            const formInterface = project.addForm(mockForm, 'userForm');

            expect(formInterface?.uag?.description).to.include('User Form');
        });
    });

    describe('authorizeRequest', () => {
        it('calls next on successful authorization', async () => {
            let nextCalled = false;
            const mockReq: any = {
                get: () => 'Bearer test-token'
            };
            const mockRes: any = {
                status: () => mockRes,
                set: () => mockRes,
                json: () => mockRes
            };
            const mockNext = () => {
                nextCalled = true;
            };

            // Mock provider
            project.provider = () => ({
                authorize: async () => ({
                    user: { _id: 'user123' },
                    token: 'test-token'
                })
            }) as any;

            await project.authorizeRequest(mockReq, mockRes, mockNext);

            expect(nextCalled).to.be.true;
            expect(mockReq.auth).to.exist;
        });

        it('returns 401 when no PKCE provider configured', async () => {
            let statusCode = 0;
            let responseBody: any = null;

            const mockReq: any = {
                get: () => 'Bearer test-token'
            };
            const mockRes: any = {
                status: (code: number) => {
                    statusCode = code;
                    return mockRes;
                },
                set: () => mockRes,
                json: (body: any) => {
                    responseBody = body;
                    return mockRes;
                }
            };
            const mockNext = () => { };

            // Mock provider to return null
            project.provider = () => null as any;

            await project.authorizeRequest(mockReq, mockRes, mockNext);

            expect(statusCode).to.equal(401);
            expect(responseBody).to.have.property('detail');
        });

        it('returns 401 when authorization fails', async () => {
            let statusCode = 0;
            let responseBody: any = null;

            const mockReq: any = {
                get: () => 'Bearer invalid-token'
            };
            const mockRes: any = {
                status: (code: number) => {
                    statusCode = code;
                    return mockRes;
                },
                set: () => mockRes,
                json: (body: any) => {
                    responseBody = body;
                    return mockRes;
                }
            };
            const mockNext = () => { };

            // Mock provider that throws
            project.provider = () => ({
                authorize: async () => {
                    throw new Error('Invalid token');
                }
            }) as any;

            await project.authorizeRequest(mockReq, mockRes, mockNext);

            expect(statusCode).to.equal(401);
            expect(responseBody.detail).to.include('Invalid token');
        });

        it('returns 401 when user is missing', async () => {
            let statusCode = 0;

            const mockReq: any = {
                get: () => 'Bearer test-token'
            };
            const mockRes: any = {
                status: (code: number) => {
                    statusCode = code;
                    return mockRes;
                },
                set: () => mockRes,
                json: () => mockRes
            };
            const mockNext = () => { };

            // Mock provider that returns auth without user
            project.provider = () => ({
                authorize: async () => ({
                    user: null
                })
            }) as any;

            await project.authorizeRequest(mockReq, mockRes, mockNext);

            expect(statusCode).to.equal(401);
        });

        it('sets WWW-Authenticate header on 401', async () => {
            let headers: any = {};

            const mockReq: any = {
                get: () => null
            };
            const mockRes: any = {
                status: () => mockRes,
                set: (h: any) => {
                    headers = { ...headers, ...h };
                    return mockRes;
                },
                json: () => mockRes
            };
            const mockNext = () => { };

            project.provider = () => null as any;

            await project.authorizeRequest(mockReq, mockRes, mockNext);

            expect(headers).to.have.property('WWW-Authenticate');
            expect(headers['WWW-Authenticate']).to.include('Bearer');
        });
    });
});
