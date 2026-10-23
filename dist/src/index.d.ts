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
export type FetchLike = (input: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
}>;
export interface LaxMcpServerOptions {
    baseUrl?: string;
    fetch?: FetchLike;
}
export declare function createLaxMcpServer(options?: LaxMcpServerOptions): McpServer;
export default createLaxMcpServer;
