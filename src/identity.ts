import jwt from 'jsonwebtoken';
import { AuthRequest } from '@formio/appserver';
import { FormflowError } from './formflow';
import type { UAGProjectInterface } from './UAGProjectInterface';

/**
 * Who the UAG acts as at Form.io when it runs a task for someone: the caller,
 * with the token they sent, or a Run task action's agent role, acting on the
 * caller's behalf with a Form.io token the UAG signs.
 *
 * The UAG signs Form.io "external" tokens with JWT_SECRET, which must be Form.io
 * Enterprise's: Form.io then takes the user, and their roles, from the token. A
 * token the UAG signs is short-lived, never marks an administrator, and never
 * carries an admin role.
 */

/** Seconds a token the UAG signs is valid for. */
export const SIGNED_TOKEN_TTL = 300;

/** The user the UAG acts for: who sent the submission. No token, ever. */
export type ActingFor = {
    /** The user's id; none for an anonymous caller. */
    _id?: string;
    /** Their roles when they submitted. */
    roles: string[];
    email?: string;
};

/** What a token the UAG signs says about why it was signed (Form.io ignores it). */
export type AgentClaim = { agent: boolean; action?: string; task?: string };

/** A token the UAG may not sign, or Form.io would not accept. */
export class AgentIdentityError extends FormflowError {
    constructor(message: string) {
        super(500, message, 'agent_identity');
        this.name = 'AgentIdentityError';
    }
}

/** The user a request comes from, as the UAG records it. */
export function actingForOf(auth: AuthRequest | undefined, project: UAGProjectInterface): ActingFor {
    const user: any = auth?.user;
    if (!user?._id) {
        return { roles: project.anonymousRoles };
    }
    const email = user.data?.email;
    return {
        _id: String(user._id),
        roles: (user.roles || []).map(String),
        ...(typeof email === 'string' && { email })
    };
}

/** The project's admin role ids, from its access settings. */
function adminRoles(project: UAGProjectInterface): Set<string> {
    return new Set(Object.values(project.access?.roles || {})
        .filter((role: any) => role?.admin)
        .map((role: any) => String(role._id)));
}

/**
 * Sign a Form.io token for `user` with `roles`. Refuses an admin role, and never
 * marks the holder an administrator.
 */
export function signFormioToken(project: UAGProjectInterface, user: ActingFor, roles: string[], claim: AgentClaim): string {
    const secret = project.config?.auth?.secret;
    if (!secret) throw new AgentIdentityError('Acting on behalf of a user needs JWT_SECRET, the same as Form.io Enterprise\'s.');
    const admin = adminRoles(project);
    if (roles.some((role) => admin.has(String(role)))) {
        throw new AgentIdentityError('An agent cannot act with an admin role. Choose a role without admin access.');
    }
    const projectId = String(project.project?._id || '');
    if (!projectId) throw new AgentIdentityError('Acting on behalf of a user needs the project to be loaded.');
    const payload = {
        external: true,
        // Form.io names an external user without an id from its data.
        user: user._id
            ? { _id: user._id, data: { ...(user.email && { email: user.email }) }, roles: roles.map(String) }
            : { _id: 'external', data: { id: 'uag-anonymous' }, roles: roles.map(String) },
        project: { _id: projectId },
        uag: claim
    };
    return jwt.sign(payload, secret, { expiresIn: SIGNED_TOKEN_TTL });
}

/** An identity that acts as `role` for `user`, with a newly signed token. */
export async function agentAuth(project: UAGProjectInterface, user: ActingFor, role: string, claim: Omit<AgentClaim, 'agent'>): Promise<AuthRequest> {
    return authFor(project, user, [role], { agent: true, ...claim });
}

/**
 * An identity that acts as `user`, with their recorded roles, for research and
 * for the runs that act as them. A user's admin roles are left out: the UAG
 * never signs a token with one, so the user acts with their other roles.
 */
export async function userAuth(project: UAGProjectInterface, user: ActingFor, claim: Omit<AgentClaim, 'agent'>): Promise<AuthRequest> {
    const admin = adminRoles(project);
    return authFor(project, user, user.roles.filter((role) => !admin.has(String(role))), { agent: false, ...claim });
}

async function authFor(project: UAGProjectInterface, user: ActingFor, roles: string[], claim: AgentClaim): Promise<AuthRequest> {
    const token = signFormioToken(project, user, roles, claim);
    const auth = new AuthRequest(project);
    await auth.fromFormioUser({ _id: user._id || 'external', roles, data: user.email ? { email: user.email } : {} } as any, token, project);
    return auth;
}

/**
 * Explain a Form.io refusal of a token the UAG signed: almost always a
 * JWT_SECRET that is not Form.io Enterprise's.
 */
export function refusedSignedToken(status: number | undefined): AgentIdentityError | null {
    if (status !== 401 && status !== 440) return null;
    return new AgentIdentityError('Form.io refused the token the UAG signed to act on the user\'s behalf: JWT_SECRET must be the same as Form.io Enterprise\'s.');
}
