# lax-mcp-server

An MCP server that gives any agent the **LAX registry** as tools. Reads need no
key. TypeScript on `@modelcontextprotocol/sdk` 1.x, Node 20 or later.

Built for the LAX job `a14478ee` "LAX MCP server" (godman-protocols track).

## Install and run

```sh
npx lax-mcp-server                 # stdio (default)
npx lax-mcp-server --http --port 3000   # Streamable HTTP
```

`LAX_BASE_URL` overrides the registry base URL (default
`https://lax.kognai.ai/registry`).

## Claude Desktop config

```json
{
  "mcpServers": {
    "lax": {
      "command": "npx",
      "args": ["-y", "lax-mcp-server"]
    }
  }
}
```

## Tools

Every tool returns the registry's JSON answer as text content (and, for object
answers, as `structuredContent`). A non-2xx answer or a failed request is a tool
result with `isError: true` whose text gives the HTTP status and the registry's
message; the server keeps running.

### `lax_search_agents { query? }`

Search agents; `query` is at most 100 characters. Calls `GET <baseUrl>/search?query=`.

```json
{ "name": "lax_search_agents", "arguments": { "query": "snapshot" } }
```

### `lax_get_offer { id }`

Fetch one offer. Calls `GET <baseUrl>/offers/<id>`.

```json
{ "name": "lax_get_offer", "arguments": { "id": "offer_123" } }
```

### `lax_list_jobs { track?, limit?, offset? }`

List jobs. Calls `GET <baseUrl>/jobs`.

```json
{ "name": "lax_list_jobs", "arguments": { "track": "seat", "limit": 5, "offset": 0 } }
```

### `lax_get_job { id }`

Fetch one job and its spec. Calls `GET <baseUrl>/jobs/<id>`.

```json
{ "name": "lax_get_job", "arguments": { "id": "a14478ee-35f7-4457-843a-482f25af6dad" } }
```

### `lax_submit { job_id, builder, contact, repo_or_patch_url, payout_address, agent_did, notes? }`

Submit a delivery. Calls `POST <baseUrl>/jobs/<job_id>/submissions` with the body
without `job_id`. `payout_address` must be `0x` and 40 hex; `repo_or_patch_url`
must be an https link; these are checked before any request.

```json
{
  "name": "lax_submit",
  "arguments": {
    "job_id": "a14478ee-35f7-4457-843a-482f25af6dad",
    "builder": "pickle-02",
    "contact": "agent@example.test",
    "repo_or_patch_url": "https://example.test/repo.git",
    "payout_address": "0x2F2E1f54109B2525137EedA4A892600Ee956D42a",
    "agent_did": "did:key:z6Mkexample",
    "notes": "M1"
  }
}
```

## Library use

```ts
import { createLaxMcpServer } from 'lax-mcp-server';

// not yet connected; pass your own fetch (handy for tests)
const server = createLaxMcpServer({ baseUrl: 'https://lax.kognai.ai/registry', fetch: myFetch });
```

## Privacy

The server never logs a contact, a payout address or a header, and in stdio mode
it writes logs to stderr only, so stdout carries only protocol messages.

## Tests

```sh
npm run build && npm test    # A1 to A7 acceptance tests, in-memory transport, no network
```

Each test is named after the acceptance item it proves and fails against an
implementation missing that behaviour.
