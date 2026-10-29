---
title: Project setup for agents
description: Configure a Form.io Enterprise project so agents write the fields they own and users cannot, with an agent role, form permissions, uagAuthoritative fields and a shared JWT_SECRET.
section: Build
order: 35
---

An agent that decides an application's outcome is only trustworthy if the applicant cannot decide it instead. This page sets up a Form.io Enterprise project so that the UAG's agents write the fields they own, users can submit but cannot write those fields, and administrators keep full control on Form.io.

The UAG does not enforce this on its own. Form.io's role permissions do, and the UAG acts at Form.io with an **agent role** you create. Every request the UAG makes for a task carries either the credential of the caller who sent the submission or a token for the agent role. The UAG never puts its own project API key in place of either.

## Two ways a task acts

An "Agent: Run task" action acts at Form.io in one of two ways, set by its **Agent role** setting:

| | No agent role | With an agent role |
|---|---|---|
| Saves the task's results as | The user who submitted, with their own token | The agent role, on the user's behalf |
| Users must be allowed to | Create and update their own submissions | Nothing beyond submitting through the UAG |
| Keeps users off the agent's fields | Only for requests sent to the UAG | Everywhere, including requests sent straight to Form.io |
| Runs after the save survive a UAG restart | No | Yes, with the UAG's database (`MONGO`) |
| Needs `JWT_SECRET` shared with Form.io | No | Yes |

Use an agent role for agentic workflows: anything where the agent's answer must not come from the person being judged. Use no agent role when the agent only helps a person fill their own form.

> **Tip:** The [admissions workflow prompt](https://github.com/formio/ai/blob/main/examples/agents/admissions-workflow.md) builds an agent role setup like this with the [Agentic Coding Plugin](/developers/agentic-coding). Its `formio-uag` skill marks the owned fields authoritative and hands the agent role and form permissions to its `formio-auth` skill.

## What you need

| Requirement | Why |
|---|---|
| Form.io Enterprise, self-hosted | The UAG signs tokens with the server's JWT secret. Form.io's hosted service does not share its secret, so on it every task acts as the user. |
| The same `JWT_SECRET` on the UAG and the Form.io server | Form.io accepts the agent's tokens only if they are signed with its own secret. |
| A license that includes the UAG | Agentic Formflow needs one. See [Deployment](/developers/deployment). |
| Applications that send submissions to the UAG | The UAG runs tasks only on submissions it receives. Point the application's project URL at the UAG. |

## 1. Create the agent role

In the Form.io portal, open **Access** and add a role, for example `Agent`. Leave **Admin** off: the UAG never acts with an admin role, and refuses to sign a token for one.

Do not assign the role to any user. The UAG is the only one that acts with it.

## 2. Set the form's permissions

For each form an agent works on, open the form's **Access** settings:

| Permission | Agent role | Users who submit (for example `Applicant`) | Staff who review (for example `Reviewer`) |
|---|---|---|---|
| Create Own Submissions | | no | |
| Create All Submissions | yes | no | as needed |
| Read Own Submissions | | yes, to see their own | |
| Read All Submissions | yes | | yes |
| Update Own Submissions | | no | |
| Update All Submissions | yes | | as needed |

With these permissions, a user cannot create or change a submission through Form.io at all, so they cannot set a field the agent owns, not even by calling Form.io's API directly. Through the UAG they can still submit: the agent creates the submission on their behalf, and it is theirs (its owner is the user).

Administrators are unaffected: they edit submissions on Form.io as before, and the UAG does not touch those edits.

## 3. Mark the fields the agent owns

Give each field a task writes the property `uagAuthoritative: "true"`, alongside its `uag` task property. See [Form properties](/developers/form-properties).

The UAG removes any value a client sends for these fields, on every request to the UAG, whatever the action's conditions or methods. On an update, the field keeps its stored value. Fields without `uagAuthoritative` stay editable, so a person can still correct a suggestion.

## 4. Add "Agent: Run task"

On the form, add an **Agent: Run task** action:

| Setting | Set it to |
|---|---|
| Task | The task to run. |
| Answer | **The whole task**, or **Its decision fields only**. |
| When | **After the save, in the background** for workflows; **Before the save** when the submitter should wait for the answer. |
| Agent role | The role from step 1. |
| Submitter roles | The roles allowed to submit this form through the agent, for example `Applicant`. Add `Anonymous` for a public form. |
| Methods | **Create** for the first task; **Update**, with conditions, for a task that follows another. |

When several Run task actions on a form run on create, give them all the same agent role. Different agent roles on create are refused as a configuration error.

## 5. Share the secret

Set `JWT_SECRET` on the UAG to the Form.io server's `JWT_SECRET`. The UAG then also accepts users' Form.io tokens directly, and signs its own tokens (for MCP clients) with the same secret.

## How a submission is created

When a submission arrives at the UAG, it decides how to create it from the form's permissions:

| The form... | The UAG... |
|---|---|
| Lets one of the user's roles create submissions (Create Own or Create All) | Forwards the create with the user's own token. |
| Does not, grants the agent role Create All, and the user has a submitter role | Creates the submission with the agent role, owned by the user. |
| Neither | Answers 403, and nothing is created. |

## Worked example: college admissions

The [demo project](https://github.com/formio/uag/blob/main/demo/module/project.json) admits applicants with an `admissions` task and awards aid with a `finance` task. The demo site runs on Form.io's hosted service, so its actions name no agent role and act as the site; on a self-hosted Enterprise project, set it up with an agent role as follows.

1. Roles: `Applicant` (signs in), `Agent` (no users), `Reviewer` (staff).
2. The Application form grants `Agent` Create All, Read All and Update All; `Applicant` Read Own only; `Reviewer` Read All.
3. Every field the tasks fill is `uagAuthoritative`: `status`, `decision`, the scores and `agentRationale` (admissions), and `awardLevel` and `financeRationale` (finance).
4. Two Run task actions, both with agent role `Agent` and submitter role `Applicant`:
   - `admissions`, the whole task, after the save, on create;
   - `finance`, the whole task, after the save, on update, when `status` is `scholarshipEvaluation` and `awardLevel` is empty.

An applicant submits to the UAG. The agent creates the application, owned by the applicant, and the applicant gets Form.io's response at once. In the background, the admissions task runs and the agent saves its decision as an update. That update starts the finance task. If the applicant posts to Form.io directly, Form.io refuses: their role may not create applications there.

## Limitations

- **Form.io's hosted service:** acting on the user's behalf is not available, because its secret is not shared. Tasks act as the user, and runs after the save are kept in memory. To develop locally with an agent role, run a Form.io Enterprise server alongside the UAG.
- **Roles are recorded when the user submits.** A run after the save researches with the roles the user had then, leaving out any admin role: the UAG never signs a token with one, so a user who holds an admin role researches with their other roles.
- **Without an agent role**, a run after the save uses the user's token while it lasts. If the user logs out, or the token expires, before the run, the run fails.

## Security notes

- `JWT_SECRET` is equivalent to administrator access on the Form.io server: anyone who holds it can sign any token. Keep it as secret as the Form.io server's own.
- The UAG never signs a token that makes its holder an administrator, nor one with an admin role. Its tokens expire after 5 minutes and are never logged or stored. None is given to an engine, except that a token for research reaches a remote engine server sealed inside a [scoped token](/developers/security#scoped-tokens-for-remote-engines), which it cannot read.
- Tasks research with the identity of the user who submitted, never the agent role, so an agent never sees more than that user may.
- The UAG uses its project API key to read the project (at startup and on each `PROJECT_TTL` refresh) and for template sync, never to run a task. A caller who sends an API key, such as a server using `x-token`, has its tasks run with that key: give such callers an agent role's action, or have users submit with their own tokens.

## Troubleshooting

| Message | Cause |
|---|---|
| "Form.io refused the token the UAG signed ... JWT_SECRET must be the same as Form.io Enterprise's" | The UAG's `JWT_SECRET` differs from the Form.io server's. |
| 403 "You may not submit this form." | The user has no create permission, and is not one of the action's submitter roles, or the agent role lacks Create All. |
| 500 "... its Run task actions name different agent roles." | Two Run task actions on create name different agent roles. Choose one. |
| "An agent cannot act with an admin role." | The action's agent role is marked admin. Use a role without admin access. |
