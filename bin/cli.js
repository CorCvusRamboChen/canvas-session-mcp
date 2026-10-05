#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import readline from 'node:readline/promises';
import { normalizeBaseUrl, readConfig, writeConfig, HOME, baseUrl, downloadDir, DEFAULT_DOWNLOADS } from '../src/config.js';

const HELP = `canvas-session-mcp — connect AI assistants to Canvas LMS without an access token

Usage:
  canvas-session-mcp setup     one-step setup: Canvas address, download folder, sign in, connect your AI apps
  canvas-session-mcp login     sign in again (when status says the session expired)
  canvas-session-mcp status    check that the saved login still works
  canvas-session-mcp           run the MCP server (stdio); your AI app starts this

Options:
  --url <canvas address>   e.g. https://canvas.your-school.edu
  --downloads <folder>     where course files are saved
  --yes                    accept the defaults, connect every AI app found
  --clients <ids>          only these apps: claude-desktop,claude-code,cursor,windsurf,codex

Data folder: ${HOME}
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' }, downloads: { type: 'string' }, clients: { type: 'string' },
    yes: { type: 'boolean', short: 'y' }, 'no-login': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});
const cmd = positionals[0] || 'serve';

// stdout belongs to the MCP protocol in serve mode, so all human output goes to stderr.
const say = (s = '') => process.stderr.write(s + '\n');

let rl = null;
async function ask(question, fallback) {
  if (values.yes || !process.stdin.isTTY) return fallback;
  rl ||= readline.createInterface({ input: process.stdin, output: process.stderr });
  const a = (await rl.question(fallback ? `${question} [${fallback}] ` : `${question} `)).trim();
  return a || fallback;
}
const yes = async (question) => /^(y|yes|是|)$/i.test(await ask(`${question} (Y/n)`, 'y'));

async function canvasUrl() {
  const url = values.url || process.env.CANVAS_URL || readConfig().baseUrl
    || await ask('Your Canvas address (e.g. https://canvas.lms.unimelb.edu.au):', '');
  if (!url) throw new Error('A Canvas address is required (--url).');
  return normalizeBaseUrl(url);
}

async function signIn(base) {
  const { openSession } = await import('../src/browser.js');
  say(`Opening ${base} … sign in in the browser window (SSO / MFA as usual). It closes by itself when done.`);
  const { me } = await openSession(base, { headless: false, onLoginPath: (p) => writeConfig({ loginPath: p }) });
  writeConfig({ baseUrl: base, user: me.name, loggedInAt: new Date().toISOString() });
  say(`✓ Signed in as ${me.name}`);
  return me;
}

async function currentUser(base) {
  const { CanvasClient } = await import('../src/canvas.js');
  const { sessionProvider } = await import('../src/server.js');
  return new CanvasClient({ base, session: sessionProvider(base) }).get('users/self');
}

async function setup() {
  say('canvas-session-mcp setup\n');
  // 1. Canvas address
  const base = await canvasUrl();
  writeConfig({ baseUrl: base });

  // 2. Where course files go
  const dir = path.resolve(values.downloads || await ask('Where should course files be saved?', readConfig().downloadDir || DEFAULT_DOWNLOADS));
  fs.mkdirSync(dir, { recursive: true });
  writeConfig({ downloadDir: dir });
  say(`✓ Course files will be saved in ${dir}\n`);

  // 3. Sign in (skipped when the saved session still works)
  if (!values['no-login']) {
    // Only the saved cookies are tried here (no hidden browser), so a first-time user sees
    // the sign-in window straight away.
    const { savedSession } = await import('../src/browser.js');
    const { CanvasClient } = await import('../src/canvas.js');
    const saved = savedSession(base);
    const me = saved ? await new CanvasClient({ base, session: async () => saved }).get('users/self').catch(() => null) : null;
    if (me?.name) say(`✓ Already signed in as ${me.name}\n`);
    else { await signIn(base); say(); }
  }

  // 4. Connect AI apps
  const { ensureStableInstall, clients } = await import('../src/setup.js');
  const launch = ensureStableInstall({ log: say });
  const only = values.clients ? new Set(values.clients.split(',').map((s) => s.trim())) : null;
  const found = clients().filter((c) => (!only || only.has(c.id)) && c.detect());
  if (!found.length) say('No supported AI app found on this computer. Add the server by hand: see the README.');
  const done = [];
  for (const c of found) {
    if (!await yes(`Connect ${c.name}?`)) continue;
    try { const where = c.install(launch); done.push(c.name); say(`✓ ${c.name} → ${where}`); }
    catch (e) { say(`✗ ${c.name}: ${e.message}`); }
  }
  rl?.close();
  say('\nAll set.');
  if (done.length) say(`Restart ${done.join(', ')} and try asking: "What's due this week on Canvas?"`);
  say(`\nOther apps can start the server with:\n  ${launch.command} ${launch.args.join(' ')}`);
}

try {
  if (values.help || cmd === 'help') {
    say(HELP);
  } else if (cmd === 'setup') {
    await setup();
  } else if (cmd === 'login') {
    const base = await canvasUrl();
    await signIn(base);
    rl?.close();
  } else if (cmd === 'status') {
    const base = baseUrl();
    const me = await currentUser(base);
    say(`✓ ${base} — signed in as ${me.name}\n  files are saved in ${downloadDir()}`);
  } else if (cmd === 'serve') {
    const { startServer } = await import('../src/server.js');
    await startServer();
  } else {
    say(HELP);
    process.exitCode = 1;
  }
} catch (e) {
  rl?.close();
  say(`✗ ${e.message}`);
  process.exitCode = 1;
}
