import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { actingForOf, agentAuth, AgentIdentityError, refusedSignedToken, signFormioToken, SIGNED_TOKEN_TTL, userAuth } from '../src/identity';

/**
 * The Form.io tokens the UAG signs to act on a user's behalf: external tokens
 * Form.io Enterprise accepts with the user and roles they carry, short-lived,
 * and never an administrator's.
 */
describe('Acting on behalf of a user', () => {
    const SECRET = 'shared-secret';
    const project: any = {
        config: { auth: { secret: SECRET } },
        project: { _id: 'project1' },
        anonymousRoles: ['anonymousId'],
        access: {
            roles: {
                administrator: { _id: 'adminId', title: 'Administrator', admin: true },
                agent: { _id: 'agentId', title: 'Agent', admin: false },
                applicant: { _id: 'applicantId', title: 'Applicant', admin: false },
                anonymous: { _id: 'anonymousId', title: 'Anonymous', admin: false, default: true }
            }
        },
        adminRole: () => 'adminId',
        roleId: (role: string) => role
    };
    const applicant = { _id: 'user1', roles: ['applicantId'], email: 'ann@example.com' };
    const decode = (token: string): any => jwt.verify(token, SECRET);

    it('signs an external token for the user with the agent role only, valid for 5 minutes', () => {
        const claims = decode(signFormioToken(project, applicant, ['agentId'], { agent: true, action: 'application:admissions', task: 'admissions' }));
        expect(claims).to.include({ external: true });
        expect(claims.user).to.deep.equal({ _id: 'user1', data: { email: 'ann@example.com' }, roles: ['agentId'] });
        expect(claims.project).to.deep.equal({ _id: 'project1' });
        expect(claims.uag).to.deep.equal({ agent: true, action: 'application:admissions', task: 'admissions' });
        expect(claims.exp - claims.iat).to.equal(SIGNED_TOKEN_TTL);
        expect(SIGNED_TOKEN_TTL).to.equal(300);
    });

    it('never names a session or an administrator', () => {
        const claims = decode(signFormioToken(project, applicant, ['agentId'], { agent: true }));
        expect(claims).to.not.have.property('jti');
        expect(claims).to.not.have.property('isAdmin');
        expect(claims).to.not.have.property('permission');
    });

    it('refuses an admin role, and says why', () => {
        expect(() => signFormioToken(project, applicant, ['adminId'], { agent: true }))
            .to.throw(AgentIdentityError, /cannot act with an admin role/);
        expect(() => signFormioToken(project, { roles: ['adminId', 'applicantId'] }, ['adminId', 'applicantId'], { agent: false }))
            .to.throw(AgentIdentityError);
    });

    it('refuses to sign without JWT_SECRET', () => {
        expect(() => signFormioToken({ ...project, config: {} }, applicant, ['agentId'], { agent: true }))
            .to.throw(AgentIdentityError, /JWT_SECRET/);
    });

    it('refuses to sign before the project is loaded, so no token names no project', () => {
        expect(() => signFormioToken({ ...project, project: {} }, applicant, ['agentId'], { agent: true }))
            .to.throw(AgentIdentityError, 'project to be loaded');
    });

    it('signs for an anonymous caller without naming a user', () => {
        const claims = decode(signFormioToken(project, { roles: ['anonymousId'] }, ['agentId'], { agent: true }));
        expect(claims.user).to.deep.equal({ _id: 'external', data: { id: 'uag-anonymous' }, roles: ['agentId'] });
    });

    it('records who a request comes from, without a token', () => {
        const user = actingForOf({ user: { _id: 'user1', roles: ['applicantId'], data: { email: 'ann@example.com' } }, token: 'secret-token' } as any, project);
        expect(user).to.deep.equal(applicant);
        expect(actingForOf({ user: null } as any, project)).to.deep.equal({ roles: ['anonymousId'] });
    });

    it('builds identities that forward their signed token, not a key', async () => {
        const agent = await agentAuth(project, applicant, 'agentId', { task: 'admissions' });
        expect(agent.admin).to.equal(false);
        expect(agent.formioToken).to.equal(true);
        expect(decode(agent.token!).user.roles).to.deep.equal(['agentId']);
        const user = await userAuth(project, applicant, { task: 'admissions' });
        expect(decode(user.token!).user.roles).to.deep.equal(['applicantId']);
        expect(decode(user.token!).uag.agent).to.equal(false);
    });

    it('acts as a user who holds an admin role with their other roles, never signing the admin role', async () => {
        const user = await userAuth(project, { _id: 'user2', roles: ['adminId', 'applicantId'] }, { task: 'admissions' });
        expect(user.admin).to.equal(false);
        expect(decode(user.token!).user.roles).to.deep.equal(['applicantId']);
    });

    it('explains a refusal of its token as a secret mismatch, without the token', () => {
        const err = refusedSignedToken(401)!;
        expect(err.message).to.contain('JWT_SECRET must be the same as Form.io Enterprise\'s');
        expect(refusedSignedToken(440)).to.be.instanceOf(AgentIdentityError);
        expect(refusedSignedToken(403)).to.equal(null);
    });
});
