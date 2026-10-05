import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { upsertCodex, clients } from '../src/setup.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
const launch = { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\Users\\me\\.canvas-session-mcp\\app\\cli.js'] };

test('codex: adds a block, then replaces it in place without touching other settings', () => {
  const first = upsertCodex('model = "o4"\n\n[mcp_servers.other]\ncommand = "x"\n', launch);
  assert.match(first, /\[mcp_servers\.other\]\ncommand = "x"/);
  assert.match(first, /command = 'C:\\Program Files\\nodejs\\node\.exe'/);
  const second = upsertCodex(first, { command: 'node', args: ['b.js'] });
  assert.equal(second.match(/\[mcp_servers\.canvas\]/g).length, 1);
  assert.match(second, /args = \['b\.js'\]/);
  assert.match(second, /\[mcp_servers\.other\]/);
});

test('JSON configs keep existing servers and get a backup', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-mcp-home-'));
  fs.mkdirSync(path.join(home, '.cursor'));
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'gh' } } }));
  const cursor = clients({ home, env: {}, platform: 'linux' }).find((c) => c.id === 'cursor');
  assert.equal(cursor.detect(), true);
  cursor.install(launch);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(cfg.mcpServers), ['github', 'canvas']);
  assert.equal(cfg.mcpServers.canvas.command, launch.command);
  assert.ok(fs.existsSync(path.join(home, '.cursor', 'mcp.json.before-canvas-mcp.bak')));
  assert.equal(clients({ home, env: {}, platform: 'linux' }).find((c) => c.id === 'windsurf').detect(), false);
});

test('setup end to end: saves the folder choice and connects the apps it finds', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-mcp-setup-'));
  const appData = path.join(home, 'AppData', 'Roaming');
  fs.mkdirSync(path.join(appData, 'Claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'));
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.config', 'Claude'), { recursive: true });
  const downloads = path.join(home, 'My Canvas Files');
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: appData, CANVAS_MCP_HOME: path.join(home, '.canvas-session-mcp') };
  const r = spawnSync(process.execPath, [cli, 'setup', '--yes', '--no-login', '--url', 'canvas.example.edu', '--downloads', downloads, '--clients', 'claude-desktop,codex,cursor'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, '.canvas-session-mcp', 'config.json'), 'utf8'));
  assert.equal(cfg.baseUrl, 'https://canvas.example.edu');
  assert.equal(cfg.downloadDir, downloads);
  assert.ok(fs.existsSync(downloads));
  assert.match(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), /\[mcp_servers\.canvas\]/);
  const desktopDir = process.platform === 'win32' ? path.join(appData, 'Claude') : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude') : path.join(home, '.config', 'Claude');
  const desktop = JSON.parse(fs.readFileSync(path.join(desktopDir, 'claude_desktop_config.json'), 'utf8'));
  assert.equal(desktop.mcpServers.canvas.command, process.execPath);
  assert.doesNotMatch(r.stderr, /Cursor/);   // no ~/.cursor → not offered
});
