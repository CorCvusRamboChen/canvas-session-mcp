import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

// Starts the real server over stdio, like Claude Desktop would, without any Canvas login.
test('MCP server lists read-only tools and reports a missing login as a tool error', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-mcp-empty-'));
  const env = { ...process.env, CANVAS_MCP_HOME: home };
  delete env.CANVAS_URL;
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli], env }));
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 15);
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
    assert.ok(tools.find((t) => t.name === 'canvas_read_file').inputSchema.required.includes('file_id'));
    const r = await client.callTool({ name: 'canvas_whoami', arguments: {} });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /login/);
  } finally {
    await client.close();
  }
});
