# Form.io UAG — Claude Integration

Connects [Claude](https://www.anthropic.com/claude) to the [Form.io Universal Agent Gateway](https://hub.docker.com/r/formio/uag), so an agentic workflow can be triggered by a single API call — typically from a Webhook Action on a form submission.

The integration runs its own MCP client and connects **outward** to the UAG, so the UAG does not need to be publicly reachable. It only needs to be reachable from this container, such as over a private Docker network or `localhost`.

Also published as [`@formio/uag-claude`](https://www.npmjs.com/package/@formio/uag-claude) on npm.

## What it does

Exposes an HTTP endpoint that starts an agentic Form.io process. On a form submission, a Webhook Action calls the endpoint; the integration then drives Claude through the UAG's MCP tools to read the submission, apply your criteria, and write its own data and analysis back into the record.

Commands include `agent_provide_data` for contributing data and analysis to an existing submission, and `collect_field_data` for gathering field values from unstructured input.

## Quick start

```bash
docker run -d --name formio-uag-claude -p 3300:3300 \
  -e UAG_SERVER=http://formio-uag:3200 \
  -e PROJECT_KEY=your-project-api-key \
  -e CLAUDE_API_KEY=your-anthropic-api-key \
  --restart unless-stopped \
  formio/uag-claude
```

Requests are served at `POST /agent/claude` on port `3300` by default. Docker Compose is the practical choice, since this container and the UAG normally share a private network — working stacks are in the [examples directory](https://github.com/formio/uag/tree/main/examples).

## Configuration

| Variable | Description |
| --- | --- |
| `CLAUDE_API_KEY` | **Required.** Anthropic API key. |
| `UAG_SERVER` | API endpoint of the deployed UAG, e.g. `http://formio-uag:3200`. Needs to be reachable only from this container. Falls back to `BASE_URL` if unset. |
| `PROJECT_KEY` | Enterprise only. The project's API key. |
| `ADMIN_KEY` | Open Source only. The Form.io OSS admin key. |
| `CLAUDE_MODEL` | Model used for the agentic analysis, e.g. `claude-opus-5`. |
| `CLAUDE_MAX_TOKENS` | Token ceiling for a single agent run. |
| `CLAUDE_MAX_ITERATIONS` | Maximum Claude API round-trips (tool-use iterations) per command. Default `25`. |
| `PORT` | Port for this integration server. Default `3300`. |

Supply keys through an `.env` file or your platform's secret store rather than inline in a committed file.

## Version compatibility

This integration is versioned independently of the UAG — it shares no code with it and does not change on every UAG release. Check the compatibility matrix in the [UAG README](https://github.com/formio/uag#integration-version-compatibility) before pinning a pair.

## Links

- Source and full documentation: https://github.com/formio/uag/tree/main/integrations/claude
- Universal Agent Gateway: https://hub.docker.com/r/formio/uag
- License: MIT
