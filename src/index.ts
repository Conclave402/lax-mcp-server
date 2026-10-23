/**
 * LAX registry as MCP tools.
 *
 * createLaxMcpServer(options?) returns an SDK McpServer with five tools wired to
 * the LAX registry HTTP API. It is NOT connected: the caller connects a transport.
 *
 * The `fetch` option (default globalThis.fetch) is injected so the hidden tests
 * can connect an SDK client over an in-memory transport with their own fetch and
 * never touch the network.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface LaxMcpServerOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

const DEFAULT_BASE_URL = 'https://lax.kognai.ai/registry';

const HEX40 = /^0x[0-9a-fA-F]{40}$/;

interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  const result: ToolResult = { content: [{ type: 'text', text }] };
  if (structured) result.structuredContent = structured;
  return result;
}

function fail(status: number | null, message: string): ToolResult {
  const prefix = status == null ? 'request failed' : `HTTP ${status}`;
  return { content: [{ type: 'text', text: `${prefix}: ${message}` }], isError: true };
}

// Parse a registry response; a non-2xx status or a throwing body is an error
// result, never a crash.
async function readResponse(res: {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}): Promise<ToolResult> {
  if (!res.ok) {
    let message = '';
    try {
      const raw = await res.text();
      try {
        const parsed = JSON.parse(raw) as { error?: string; message?: string };
        message = parsed.error ?? parsed.message ?? raw;
      } catch {
        message = raw;
      }
    } catch {
      message = '';
    }
    return fail(res.status, message || 'registry returned an error');
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    return fail(res.status, err instanceof Error ? err.message : String(err));
  }
  let structured: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      structured = parsed as Record<string, unknown>;
    } else {
      structured = { result: parsed };
    }
  } catch {
    structured = undefined;
  }
  return ok(text, structured);
}

async function doRequest(
  fetchImpl: FetchLike,
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<ToolResult> {
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    return fail(null, err instanceof Error ? err.message : String(err));
  }
  return readResponse(res);
}

export function createLaxMcpServer(options: LaxMcpServerOptions = {}): McpServer {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl: FetchLike =
    options.fetch ?? (globalThis.fetch as unknown as FetchLike);

  const server = new McpServer({ name: 'lax-mcp', version: '0.1.0' });

  server.registerTool(
    'lax_search_agents',
    {
      title: 'Search LAX agents',
      description: 'Search the LAX agent registry by a free-text query (at most 100 characters).',
      inputSchema: { query: z.string().max(100).optional() },
    },
    async ({ query }) => {
      const url = new URL(`${baseUrl}/search`);
      if (query != null) url.searchParams.set('query', query);
      return doRequest(fetchImpl, url.toString());
    },
  );

  server.registerTool(
    'lax_get_offer',
    {
      title: 'Get a LAX offer',
      description: 'Fetch a single LAX offer by its id.',
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      if (!id || typeof id !== 'string') {
        return fail(null, 'id is required');
      }
      return doRequest(fetchImpl, `${baseUrl}/offers/${encodeURIComponent(id)}`);
    },
  );

  server.registerTool(
    'lax_list_jobs',
    {
      title: 'List LAX jobs',
      description: 'List open LAX jobs, optionally filtered by track, with limit and offset.',
      inputSchema: {
        track: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      },
    },
    async ({ track, limit, offset }) => {
      const url = new URL(`${baseUrl}/jobs`);
      if (track != null) url.searchParams.set('track', track);
      if (limit != null) url.searchParams.set('limit', String(limit));
      if (offset != null) url.searchParams.set('offset', String(offset));
      return doRequest(fetchImpl, url.toString());
    },
  );

  server.registerTool(
    'lax_get_job',
    {
      title: 'Get a LAX job',
      description: 'Fetch a single LAX job by its id, including its spec.',
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      if (!id || typeof id !== 'string') {
        return fail(null, 'id is required');
      }
      return doRequest(fetchImpl, `${baseUrl}/jobs/${encodeURIComponent(id)}`);
    },
  );

  server.registerTool(
    'lax_submit',
    {
      title: 'Submit to a LAX job',
      description:
        'Submit a delivery to a LAX job. body is sent as JSON without job_id at the top level.',
      inputSchema: {
        job_id: z.string().min(1),
        builder: z.string().min(2).max(80),
        contact: z.string().min(1),
        repo_or_patch_url: z.string().url(),
        payout_address: z.string().regex(HEX40),
        agent_did: z.string().regex(/^did:[a-z0-9]+:.+/),
        notes: z.string().max(2000).optional(),
      },
    },
    async ({
      job_id,
      builder,
      contact,
      repo_or_patch_url,
      payout_address,
      agent_did,
      notes,
    }) => {
      if (!repo_or_patch_url.startsWith('https://')) {
        return fail(null, 'repo_or_patch_url must be an https link');
      }
      if (!HEX40.test(payout_address)) {
        return fail(null, 'payout_address must be 0x followed by 40 hex characters');
      }
      const body = { builder, contact, repo_or_patch_url, payout_address, agent_did, notes };
      return doRequest(fetchImpl, `${baseUrl}/jobs/${encodeURIComponent(job_id)}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
  );

  return server;
}

export default createLaxMcpServer;
