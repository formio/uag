import { Action, ActionInfo, AuthorizedMethod, AuthorizedStateType, AuthRequest, FormInterface, SubmissionRequest, SubmissionResponse } from '@formio/appserver';
import { NextFunction } from 'express';
import { callerIdentity, formflow, FormflowError, withoutOwnedValues } from '../formflow';
import type { FormflowForm } from '../formflow';
import { MAX_CHAIN, RUN_TASK_ACTING_FOR, RUN_TASK_AS_USER, RUN_TASK_CALLER, RUN_TASK_CHAIN, RUN_TASK_IDENTITY, RUN_TASK_REQUEST_ID, RUN_TASK_SAVE, taskRunner } from '../runner';
import { safeRequestId } from '@formio/uag-sdk/protocol';
import { withRequestId } from '../agent/requestId';
import { errorCode } from '../agent/errors';
import type { TaskRunOutcome } from '../runner';
import { actingForOf, agentAuth } from '../identity';
import type { UAGFormInterface } from '../UAGFormInterface';
import type { UAGProjectInterface } from '../UAGProjectInterface';
const debug = require('debug')('formio:uag:actions:runTask');

export const RUN_TASK = 'agentRunTask';

type RunTaskSettings = {
    task?: string;
    answer?: 'decisions' | 'task';
    when?: 'before' | 'after';
    /** The role the agent acts with at Form.io, on the user's behalf (see identity). */
    agentRole?: string;
    /** Who may submit on a form whose users may not create submissions themselves. */
    submitterRoles?: string[];
};

/** The tasks a form defines. */
const tasksOf = (form: FormInterface) => Object.keys((form as UAGFormInterface).uagFields || {});

/** The form's Run task actions, for a method (create or update) when one is given, whatever their conditions. */
function runTaskActions(form: FormInterface, method?: string): { title?: string; machineName?: string; settings: RunTaskSettings }[] {
    return Object.values<any>(form.project.template?.actions || {}).filter((action) =>
        action?.name === RUN_TASK
        && (action.form?.split(':').pop() || '') === form.form.machineName
        && (!method || (action.method || []).includes(method))
        && action.settings?.task);
}

/**
 * Remove, from what a client sends, the values of the fields each of the form's
 * Run task actions owns and marks `uagAuthoritative`: on an update they keep
 * their stored values; on a create they start empty. This covers every Run
 * task action on the form, whatever its method, conditions or when it runs, so
 * a client can never store a value the server decides: not before the task
 * runs, and not through a method the task does not run on. The runner's own
 * save is not a client's, and is left alone.
 *
 * As `before:submission:<op>` hooks, these run after an update has loaded the
 * stored submission and before the request's data replaces it.
 */
export function ownedFieldHooks() {
    const hook = (op: 'create' | 'update') => async (form: FormInterface) => {
        if (!runTaskActions(form).length) return form;
        return async (req: SubmissionRequest, res: SubmissionResponse, next: NextFunction) => {
            if ((req as any)[RUN_TASK_SAVE]) return next();
            const actions = runTaskActions(form);
            const tasks = new Set(tasksOf(form));
            if (op === 'update') {
                let body = req.body || {};
                for (const { settings } of actions) {
                    if (tasks.has(settings.task!)) body = withoutOwnedValues(form as any, settings.task!, body, req.submission || { data: {} });
                }
                req.body = body;
            }
            else {
                let submission = req.submission || { data: {} };
                for (const { settings } of actions) {
                    if (tasks.has(settings.task!)) submission = withoutOwnedValues(form as any, settings.task!, submission);
                }
                req.submission = submission;
            }
            next();
        };
    };
    return { 'before:submission:create': hook('create'), 'before:submission:update': hook('update') };
}

/**
 * Decide how a submission is created through the UAG, from the form's
 * submission access and its Run task actions that run on create:
 * - a caller whose roles may create submissions creates it with their own token;
 * - otherwise, when an action names an agent role the form grants "Create All",
 *   and the caller has one of the actions' submitter roles, the agent creates it
 *   on their behalf, owned by them;
 * - otherwise the create is refused.
 * Run as a `before:access:create` hook, before the caller's access is checked.
 */
export function onBehalfHook() {
    return async (form: FormInterface) => {
        if (!runTaskActions(form, 'create').some((action) => action.settings.agentRole)) return form;
        return async (req: SubmissionRequest, res: SubmissionResponse, next: NextFunction) => {
            const project = form.project as UAGProjectInterface;
            const access = form.accessInfo[AuthorizedMethod.CREATE];
            const actingFor = actingForOf(req.auth, project);
            const has = (roles: string[] | undefined) => AuthRequest.hasRole(actingFor.roles, roles, project);
            if (req.auth?.admin || has(access[AuthorizedStateType.OWN]) || has(access[AuthorizedStateType.ALL])) return next();
            const actions = runTaskActions(form, 'create').filter((action) => action.settings.agentRole);
            const roles = [...new Set(actions.map((action) => project.roleId(String(action.settings.agentRole))))];
            if (roles.length > 1) {
                console.error(`[formio-uag] The Run task actions of "${form.name}" that run on create name different agent roles ` +
                    `(${actions.map((action) => action.title || action.machineName).join(', ')}). Choose one agent role for them all.`);
                return res.status(500).json({ name: 'ConfigurationError', message: `The form "${form.name}" is not configured correctly: its Run task actions name different agent roles.`, code: 'configuration_error' });
            }
            const [role] = roles;
            const submitters = actions.flatMap((action) => action.settings.submitterRoles || []).map(String);
            if (!AuthRequest.hasRole([role], access[AuthorizedStateType.ALL], project) || !has(submitters)) {
                return res.status(403).json({ name: 'ForbiddenError', message: 'You may not submit this form.', code: 'forbidden' });
            }
            try {
                req.forwardAuth = await agentAuth(project, actingFor, role, { task: actions[0].settings.task });
            }
            catch (err: any) {
                if (err instanceof FormflowError) return refuse(res, err);
                throw err;
            }
            next();
        };
    };
}

/** The hooks Run task needs: owned fields kept from clients, and creation on a user's behalf. */
export function runTaskHooks() {
    return { ...ownedFieldHooks(), 'before:access:create': onBehalfHook() };
}

/** The request's X-Request-Id (or the one the runner's save carries on), passed to the engines and the runs it starts. */
function requestIdOf(req: SubmissionRequest): string | undefined {
    return (req as any)[RUN_TASK_REQUEST_ID] || safeRequestId((req as any).get?.('x-request-id')) || undefined;
}

/** The runs made before the save on this request, by action, until the save gives them a submission. */
function runsBefore(req: SubmissionRequest): Map<object, TaskRunOutcome> {
    const request = req as any;
    request.uagRunsBefore = request.uagRunsBefore || new Map();
    return request.uagRunsBefore;
}

/** Answer a Formflow error as JSON with its status. */
function refuse(res: SubmissionResponse, err: any) {
    res.status(err.status).json({
        name: err.name,
        message: err.message,
        code: err.code || errorCode(err.status),
        ...((err as any).edition && { edition: (err as any).edition })
    });
}

/**
 * "Agent: Run task": run one of the form's tasks on a submission sent to the
 * UAG, before the save (the submitter waits, and Form.io stores the result as
 * the one save) or after it, in the background (the results are saved as an
 * update, which runs the form's update actions in turn).
 */
export const RunTaskAction: Action = {
    get info(): ActionInfo {
        return {
            name: RUN_TASK,
            title: 'Agent: Run task',
            group: 'default',
            description: 'Runs one of the form\'s agent tasks on the submission, before the save or after it in the background.',
            priority: 20,
            defaults: {
                handler: ['before', 'after'],
                method: ['create']
            },
            access: {
                handler: false,
                method: true
            }
        } as ActionInfo;
    },

    async settingsForm(form: FormInterface): Promise<any[]> {
        const tasks = tasksOf(form);
        // An agent never acts with an admin role.
        const roles = Object.values<any>(form.project.access?.roles || {})
            .filter((role) => role?._id && !role.admin)
            .map((role) => ({ label: role.title || String(role._id), value: String(role._id) }));
        return [
            ...(tasks.length ? [] : [{
                type: 'htmlelement',
                key: 'noTasks',
                tag: 'p',
                content: 'This form defines no task. Mark its components with the "uag" property to define one.'
            }]),
            {
                type: 'select',
                input: true,
                key: 'task',
                label: 'Task',
                tooltip: 'The task to run, from the tasks the form defines.',
                dataSrc: 'values',
                data: { values: tasks.map((task) => ({ label: task, value: task })) },
                validate: { required: true }
            },
            {
                type: 'radio',
                input: true,
                key: 'answer',
                label: 'Answer',
                defaultValue: 'task',
                values: [
                    { label: 'The whole task', value: 'task' },
                    { label: 'Its decision fields only', value: 'decisions' }
                ],
                validate: { required: true }
            },
            {
                type: 'select',
                input: true,
                key: 'agentRole',
                label: 'Agent role',
                tooltip: 'Act at Form.io with this role, on behalf of the user, to save the task\'s results and to create submissions users may not create themselves. Needs JWT_SECRET to be the same as Form.io Enterprise\'s. Leave empty to act with the user\'s own token.',
                dataSrc: 'values',
                data: { values: roles }
            },
            {
                type: 'select',
                input: true,
                key: 'submitterRoles',
                label: 'Submitter roles',
                tooltip: 'Who may submit this form through the agent when the form does not let their roles create submissions: the agent creates it on their behalf.',
                multiple: true,
                dataSrc: 'values',
                data: { values: roles },
                customConditional: 'show = !!data.agentRole;'
            },
            {
                type: 'radio',
                input: true,
                key: 'when',
                label: 'When',
                defaultValue: 'after',
                values: [
                    { label: 'After the save, in the background', value: 'after' },
                    { label: 'Before the save (the submitter waits)', value: 'before' }
                ],
                validate: { required: true }
            }
        ];
    },

    async executor(form: FormInterface, action: any, handler: string, method: string) {
        const settings: RunTaskSettings = action?.settings || {};
        const when = settings.when === 'before' ? 'before' : 'after';
        const answer = settings.answer === 'decisions' ? 'decisions' : 'task';
        const project = form.project as UAGProjectInterface;
        const title = action?.title || RUN_TASK;
        if (!settings.task) {
            return async (req: SubmissionRequest, res: SubmissionResponse, next: NextFunction) => next();
        }
        if (when === 'before' && handler === 'before') {
            return async (req: SubmissionRequest, res: SubmissionResponse, next: NextFunction) => {
                // The runner's own save carries the agent's results.
                if ((req as any)[RUN_TASK_SAVE]) return next();
                try {
                    const identity = callerIdentity(req.auth, req as any);
                    // The owned fields were already made the server's own (ownedFieldHooks).
                    const requestId = requestIdOf(req);
                    const run = await withRequestId(requestId, () => formflow(project).runTask(form as unknown as FormflowForm, settings.task, req.submission || { data: {} }, req.auth, { answer, stored: true, identity, requestId }));
                    req.submission = run.submission;
                    // Recorded once the save gives the submission its id (below).
                    const failed = run.failed.map((group) => group.error || 'no engine could answer').join('; ');
                    runsBefore(req).set(action, {
                        status: failed ? 'failed' : 'done',
                        written: run.written,
                        cleared: run.cleared,
                        engines: run.results.map((result) => ({ kind: result.kind, engine: result.engine ?? null, model: result.model ?? null })),
                        saved: true,
                        ...(failed && { error: failed })
                    });
                    return next();
                }
                catch (err: any) {
                    if (err instanceof FormflowError) return refuse(res, err);
                    throw err;
                }
            };
        }
        if (when === 'before') {
            // After the save: record the run made before it, now that the submission has its id.
            return async (req: SubmissionRequest, res: SubmissionResponse, next: NextFunction) => {
                const outcome = runsBefore(req).get(action);
                const saved: any = res.resource?.item;
                if (outcome && saved?._id) {
                    await taskRunner(project).recordBefore({
                        form: form.name, formId: String(form.form._id || ''), method, submission: String(saved._id),
                        task: settings.task!, answer, action: title, actingFor: actingForOf(req.auth, project), requestId: requestIdOf(req)
                    }, outcome);
                }
                next();
            };
        }
        if (handler !== 'after') {
            return async (req: SubmissionRequest, res: SubmissionResponse, next: NextFunction) => next();
        }
        return async (req: SubmissionRequest, res: SubmissionResponse, next: NextFunction) => {
            const saved: any = res.resource?.item;
            const chain: number = (req as any)[RUN_TASK_CHAIN] || 0;
            if (saved?._id && chain > MAX_CHAIN) {
                console.error(`[formio-uag] Run task "${settings.task}" was not run on submission ${saved._id} of "${form.name}": ` +
                    `${MAX_CHAIN} runs in a row were each started by the save of the one before. Check that the form's Run task actions do not start each other without end.`);
            }
            else if (saved?._id) {
                // A run the runner's own save starts acts for the same user as the run that saved:
                // with the caller's own token, or as the user with tokens the UAG signs, never
                // with the agent role of the run that saved.
                const actingFor = (req as any)[RUN_TASK_ACTING_FOR] || actingForOf(req.auth, project);
                const chained: AuthRequest | undefined = (req as any)[RUN_TASK_CALLER];
                const caller: AuthRequest = chained || req.auth;
                const asUser = !chained && !!(req as any)[RUN_TASK_AS_USER];
                // A durable run is recorded before the response is sent.
                await taskRunner(project).enqueue({
                    form: form.name,
                    formId: String(form.form._id || ''),
                    method,
                    submission: String(saved._id),
                    task: settings.task!,
                    answer,
                    actingFor,
                    action: title,
                    requestId: requestIdOf(req),
                    ...(chain && { chain }),
                    ...(settings.agentRole
                        ? { agentRole: project.roleId(String(settings.agentRole)) }
                        : asUser
                            ? { asUser: true }
                            : { caller: caller.clone(), identity: chained ? (req as any)[RUN_TASK_IDENTITY] : callerIdentity(caller, req as any) })
                });
            }
            else {
                debug(`${form.name}: no saved submission to run "${settings.task}" on`);
            }
            next();
        };
    }
};
