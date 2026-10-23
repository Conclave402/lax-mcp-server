#!/usr/bin/env node
// lax-mcp bin. stdio by default; --http serves Streamable HTTP on --port or PORT.
//
// The server never logs a contact, a payout address or a header. In stdio mode
// all logs go to stderr; only protocol messages are written to stdout.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createLaxMcpServer } from '../dist/src/index.js';

function log(...args) {
  process.stderr.write(`${args.join(' ')}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const httpIndex = args.indexOf('--http');
  const baseUrl = process.env.LAX_BASE_URL || undefined;

  if (httpIndex !== -1) {
    const portFlag = args.indexOf('--port');
    const port =
      portFlag !== -1 && args[portFlag + 1] ? Number(args[portFlag + 1]) : Number(process.env.PORT || 3000);

    // One server + transport for the process: the client sends an initialize
    // request, then reuses the returned session id, so state must persist.
    const server = createLaxMcpServer(baseUrl ? { baseUrl } : {});
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    await server.connect(transport);

    const httpServer = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let body;
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      } catch {
        res.writeHead(400).end();
        return;
      }
      await transport.handleRequest(req, res, body);
    });

    httpServer.listen(port, () => log(`lax-mcp Streamable HTTP listening on port ${port}`));
    return;
  }

  const server = createLaxMcpServer(baseUrl ? { baseUrl } : {});
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('lax-mcp running on stdio');
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
