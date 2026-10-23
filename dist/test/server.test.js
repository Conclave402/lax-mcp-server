/**
 * Acceptance tests, named after the job's acceptance items A1 to A7.
 * Each test fails against an implementation missing the behaviour it proves.
 *
 * The client talks to the server over an in-memory transport with the test's own
 * fetch: no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLaxMcpServer } from '../src/index.js';
const BODY = { ok: true, marker: 'registry-answer' };
function fakeFetch(record, reply) {
    return async (url, init) => {
        record.push({ url, init });
        const status = reply ? reply.status : 200;
        const payload = JSON.stringify(reply ? reply.body : BODY);
        return {
            ok: status >= 200 && status < 300,
            status,
            text: async () => payload,
            json: async () => JSON.parse(payload),
        };
    };
}
async function connect(record, reply) {
    const server = createLaxMcpServer({ baseUrl: 'https://example.test/registry', fetch: fakeFetch(record, reply) });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return { client, server };
}
function text(result) {
    return (result.content ?? []).map((c) => c.text ?? '').join('\n');
}
test('A1 tools/list returns the five tools, each with a description and an input schema', async () => {
    const { client, server } = await connect([]);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
        'lax_get_job',
        'lax_get_offer',
        'lax_list_jobs',
        'lax_search_agents',
        'lax_submit',
    ]);
    for (const t of tools) {
        assert.ok(t.description && t.description.length > 0, `${t.name} has a description`);
        assert.ok(t.inputSchema && typeof t.inputSchema === 'object', `${t.name} has an input schema`);
    }
    await server.close();
});
test('A2 lax_search_agents calls GET <baseUrl>/search?query= and returns the registry answer', async () => {
    const record = [];
    const { client, server } = await connect(record);
    const res = await client.callTool({ name: 'lax_search_agents', arguments: { query: 'snapshot' } });
    assert.equal(record.length, 1);
    assert.equal(record[0].url, 'https://example.test/registry/search?query=snapshot');
    assert.equal(res.isError, undefined);
    assert.match(text(res), /registry-answer/);
    await server.close();
});
test('A2b lax_list_jobs passes track, limit and offset', async () => {
    const record = [];
    const { client, server } = await connect(record);
    await client.callTool({ name: 'lax_list_jobs', arguments: { track: 'seat', limit: 5, offset: 10 } });
    const url = new URL(record[0].url);
    assert.equal(url.pathname, '/registry/jobs');
    assert.equal(url.searchParams.get('track'), 'seat');
    assert.equal(url.searchParams.get('limit'), '5');
    assert.equal(url.searchParams.get('offset'), '10');
    await server.close();
});
test('A2c lax_get_job calls GET <baseUrl>/jobs/<id>', async () => {
    const record = [];
    const { client, server } = await connect(record);
    await client.callTool({ name: 'lax_get_job', arguments: { id: 'abcd1234' } });
    assert.equal(record[0].url, 'https://example.test/registry/jobs/abcd1234');
    await server.close();
});
test('A2d lax_get_offer calls GET <baseUrl>/offers/<id>', async () => {
    const record = [];
    const { client, server } = await connect(record);
    await client.callTool({ name: 'lax_get_offer', arguments: { id: 'offer-1' } });
    assert.equal(record[0].url, 'https://example.test/registry/offers/offer-1');
    await server.close();
});
test('A2e lax_submit POSTs the body without job_id to the submissions route', async () => {
    const record = [];
    const { client, server } = await connect(record);
    await client.callTool({
        name: 'lax_submit',
        arguments: {
            job_id: 'job-9',
            builder: 'pickle-02',
            contact: 'agent@example.test',
            repo_or_patch_url: 'https://example.test/repo.git',
            payout_address: '0x2F2E1f54109B2525137EedA4A892600Ee956D42a',
            agent_did: 'did:key:z6Mkexample',
            notes: 'M1',
        },
    });
    assert.equal(record[0].url, 'https://example.test/registry/jobs/job-9/submissions');
    assert.equal(record[0].init?.method, 'POST');
    const sent = JSON.parse(record[0].init?.body ?? '{}');
    assert.equal(sent.job_id, undefined, 'job_id is not in the body');
    assert.equal(sent.builder, 'pickle-02');
    assert.equal(sent.agent_did, 'did:key:z6Mkexample');
    await server.close();
});
test('A3 a 4xx answer gives isError with the status and the message, and the next call still works', async () => {
    const record = [];
    let call = 0;
    const fetchImpl = async (url, init) => {
        record.push({ url, init });
        call += 1;
        if (call === 1) {
            return {
                ok: false,
                status: 400,
                text: async () => JSON.stringify({ error: 'bad id' }),
                json: async () => ({ error: 'bad id' }),
            };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify(BODY), json: async () => BODY };
    };
    const server = createLaxMcpServer({ baseUrl: 'https://example.test/registry', fetch: fetchImpl });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    const bad = await client.callTool({ name: 'lax_get_job', arguments: { id: 'x' } });
    assert.equal(bad.isError, true);
    assert.match(text(bad), /400/);
    assert.match(text(bad), /bad id/);
    const good = await client.callTool({ name: 'lax_get_job', arguments: { id: 'y' } });
    assert.equal(good.isError, undefined);
    assert.match(text(good), /registry-answer/);
    await server.close();
});
test('A3b a network failure gives isError and the server keeps running', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        if (calls === 1)
            throw new Error('connection refused');
        return { ok: true, status: 200, text: async () => JSON.stringify(BODY), json: async () => BODY };
    };
    const server = createLaxMcpServer({ baseUrl: 'https://example.test/registry', fetch: fetchImpl });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    const bad = await client.callTool({ name: 'lax_get_job', arguments: { id: 'x' } });
    assert.equal(bad.isError, true);
    assert.match(text(bad), /connection refused/);
    const good = await client.callTool({ name: 'lax_get_job', arguments: { id: 'y' } });
    assert.equal(good.isError, undefined);
    await server.close();
});
test('A4 invalid input is refused without a request', async () => {
    const record = [];
    const { client, server } = await connect(record);
    // missing id -> schema refusal
    const missingId = await client.callTool({ name: 'lax_get_job', arguments: {} });
    assert.equal(missingId.isError, true);
    // bad payout address -> refused before any request
    const badPay = await client.callTool({
        name: 'lax_submit',
        arguments: {
            job_id: 'j',
            builder: 'pickle-02',
            contact: 'c',
            repo_or_patch_url: 'https://example.test/r.git',
            payout_address: 'nothex',
            agent_did: 'did:key:z',
        },
    });
    assert.equal(badPay.isError, true);
    // non https link -> refused
    const badLink = await client.callTool({
        name: 'lax_submit',
        arguments: {
            job_id: 'j',
            builder: 'pickle-02',
            contact: 'c',
            repo_or_patch_url: 'http://example.test/r.git',
            payout_address: '0x2F2E1f54109B2525137EedA4A892600Ee956D42a',
            agent_did: 'did:key:z',
        },
    });
    assert.equal(badLink.isError, true);
    assert.equal(record.length, 0, 'no registry request was made for invalid input');
    await server.close();
});
test('A5 the server never logs a contact, payout address or header', async () => {
    // Capture any writes to stdout/stderr during a submit call.
    const chunks = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (c) => {
        chunks.push(String(c));
        return true;
    };
    process.stderr.write = (c) => {
        chunks.push(String(c));
        return true;
    };
    try {
        const { client, server } = await connect([]);
        await client.callTool({
            name: 'lax_submit',
            arguments: {
                job_id: 'j',
                builder: 'pickle-02',
                contact: 'secret-contact@example.test',
                repo_or_patch_url: 'https://example.test/r.git',
                payout_address: '0x2f2e1f54109b2525137eeda4a892600ee956d42a',
                agent_did: 'did:key:z',
            },
        });
        await server.close();
    }
    finally {
        process.stdout.write = origOut;
        process.stderr.write = origErr;
    }
    const joined = chunks.join('');
    assert.doesNotMatch(joined, /secret-contact@example\.test/);
    assert.doesNotMatch(joined, /0x2f2e1f54109b/i);
});
test('A6 stdio and Streamable HTTP both work and the package has a bin', async () => {
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.ok(pkg.bin && pkg.bin['lax-mcp'], 'a lax-mcp bin is declared');
    const exists = await readFile(new URL('../../bin/lax-mcp.js', import.meta.url), 'utf8').catch(() => null);
    assert.ok(exists && exists.includes('StdioServerTransport'), 'the bin wires stdio');
    assert.ok(exists.includes('StreamableHTTP'), 'the bin wires Streamable HTTP');
});
test('A7 the README lists the mcpServers config and every tool with an example', async () => {
    const { readFile } = await import('node:fs/promises');
    const md = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
    assert.match(md, /mcpServers/);
    for (const name of ['lax_search_agents', 'lax_get_offer', 'lax_list_jobs', 'lax_get_job', 'lax_submit']) {
        assert.ok(md.includes(name), `README documents ${name}`);
    }
});
