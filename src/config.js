import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Everything lives in one folder in your home directory: the saved Canvas URL, the
// browser profile that holds your login, and downloaded files. Nothing is sent anywhere else.
export const HOME = process.env.CANVAS_MCP_HOME || path.join(os.homedir(), '.canvas-session-mcp');
export const PROFILE_DIR = process.env.CANVAS_MCP_PROFILE || path.join(HOME, 'browser-profile');
const CONFIG_FILE = path.join(HOME, 'config.json');
// What to tell people to run (the package is installed straight from GitHub, not from npm).
export const CMD = 'npx -y https://github.com/CorCvusRamboChen/canvas-session-mcp/archive/refs/heads/main.tar.gz';
export const DEFAULT_DOWNLOADS = path.join(os.homedir(), 'Documents', 'Canvas');

// Where course files are saved: chosen during `setup`, or CANVAS_MCP_DOWNLOADS.
export function downloadDir() {
  return process.env.CANVAS_MCP_DOWNLOADS || readConfig().downloadDir || DEFAULT_DOWNLOADS;
}

export function normalizeBaseUrl(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const parsed = new URL(u);
  return parsed.origin;
}

export function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

export function writeConfig(patch) {
  fs.mkdirSync(HOME, { recursive: true });
  const next = { ...readConfig(), ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

// CANVAS_URL (env) wins over the URL saved by `login`, so one install can point at another school.
export function baseUrl() {
  const u = normalizeBaseUrl(process.env.CANVAS_URL || readConfig().baseUrl);
  if (!u) throw new Error(`No Canvas URL configured. Run: ${CMD} setup`);
  return u;
}
