import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// npm and claude are .cmd shims on Windows, which Node only starts through a shell; a shell
// takes one command line, so build it with every argument quoted.
const q = (a) => (process.platform === 'win32' ? `"${String(a).replace(/"/g, '""')}"` : `'${String(a).replace(/'/g, "'\\''")}'`);
const sh = (cmd, args, opts = {}) => spawnSync([cmd, ...args.map(q)].join(' '), { shell: true, stdio: 'ignore', ...opts });
import { fileURLToPath } from 'node:url';
import { HOME } from './config.js';

export const PACKAGE_SPEC = 'https://github.com/CorCvusRamboChen/canvas-session-mcp/archive/refs/heads/main.tar.gz';
const SELF_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

// npx runs us from a temporary cache that can be cleaned at any time, and AI apps on Windows
// cannot start "npx" without a shell. So setup installs one stable copy in the data folder
// and points every AI app at `node <that copy>`: starts fast, works offline, same on every OS.
export function ensureStableInstall({ spec = process.env.CANVAS_MCP_SPEC || PACKAGE_SPEC, log = () => {} } = {}) {
  const fromNpxCache = /[\\/]_npx[\\/]/.test(SELF_CLI);
  if (!fromNpxCache) return { command: process.execPath, args: [path.resolve(SELF_CLI)] };   // a git clone or global install: use it as is
  const prefix = path.join(HOME, 'app');
  fs.mkdirSync(prefix, { recursive: true });
  log(`Installing a local copy in ${prefix} …`);
  const r = sh('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--omit=dev', spec], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('npm install failed');
  return { command: process.execPath, args: [path.join(prefix, 'node_modules', 'canvas-session-mcp', 'bin', 'cli.js')] };
}

function backup(file) {
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.before-canvas-mcp.bak`);
}

function mergeJson(file, key, launch) {
  let cfg = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').trim();
    try { cfg = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`${file} is not valid JSON; fix or remove it, then run setup again`); }
  }
  backup(file);
  cfg[key] = { ...(cfg[key] || {}), canvas: { command: launch.command, args: launch.args } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}

// TOML literal strings ('...') keep Windows backslashes as they are.
const tomlStr = (s) => (s.includes("'") ? JSON.stringify(s) : `'${s}'`);
export function codexBlock(launch) {
  return `[mcp_servers.canvas]\ncommand = ${tomlStr(launch.command)}\nargs = [${launch.args.map(tomlStr).join(', ')}]\n`;
}
export function upsertCodex(text, launch) {
  const block = codexBlock(launch);
  const re = /^\[mcp_servers\.canvas\][^\n]*\n(?:(?!\[)[^\n]*\n?)*/m;
  if (re.test(text)) return text.replace(re, block + '\n');
  return (text && !text.endsWith('\n') ? text + '\n' : text) + (text.trim() ? '\n' : '') + block;
}

const onPath = (cmd) => sh(cmd, ['--version']).status === 0;

// Every AI app we know how to configure: how to tell it is installed, and how to add the server.
export function clients({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const claudeDesktopDir = platform === 'win32' ? path.join(appData, 'Claude')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude')
      : path.join(home, '.config', 'Claude');
  return [
    {
      id: 'claude-desktop', name: 'Claude Desktop',
      detect: () => fs.existsSync(claudeDesktopDir),
      install: (l) => { const f = path.join(claudeDesktopDir, 'claude_desktop_config.json'); mergeJson(f, 'mcpServers', l); return f; },
    },
    {
      id: 'claude-code', name: 'Claude Code',
      detect: () => onPath('claude'),
      install: (l) => {
        sh('claude', ['mcp', 'remove', '--scope', 'user', 'canvas']);
        const r = sh('claude', ['mcp', 'add', '--scope', 'user', 'canvas', '--', l.command, ...l.args]);
        if (r.status !== 0) throw new Error('`claude mcp add` failed');
        return 'claude mcp (user scope)';
      },
    },
    {
      id: 'cursor', name: 'Cursor',
      detect: () => fs.existsSync(path.join(home, '.cursor')),
      install: (l) => { const f = path.join(home, '.cursor', 'mcp.json'); mergeJson(f, 'mcpServers', l); return f; },
    },
    {
      id: 'windsurf', name: 'Windsurf',
      detect: () => fs.existsSync(path.join(home, '.codeium', 'windsurf')),
      install: (l) => { const f = path.join(home, '.codeium', 'windsurf', 'mcp_config.json'); mergeJson(f, 'mcpServers', l); return f; },
    },
    {
      id: 'codex', name: 'Codex',
      detect: () => fs.existsSync(path.join(home, '.codex')),
      install: (l) => {
        const f = path.join(home, '.codex', 'config.toml');
        const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
        backup(f);
        fs.writeFileSync(f, upsertCodex(old, l));
        return f;
      },
    },
  ];
}
