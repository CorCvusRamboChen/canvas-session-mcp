import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { PROFILE_DIR, HOME } from './config.js';

// Canvas and most school SSOs use *session* cookies, which Chrome drops when the window
// closes. So after a successful sign-in we keep the cookies ourselves (in your home folder,
// readable only by you) and put them back the next time. This is the same data the browser
// profile would hold anyway; it never leaves your computer.
const SESSION_FILE = path.join(HOME, 'session.json');

function loadCookies() {
  try {
    const now = Date.now() / 1000;
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')).filter((c) => c.expires === -1 || c.expires > now);
  } catch { return []; }
}

function saveCookies(cookies) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies), { mode: 0o600 });
}

const matches = (host, c) => { const d = c.domain.replace(/^\./, ''); return host === d || host.endsWith('.' + d); };
const cookieHeader = (cookies, base) => {
  const host = new URL(base).hostname;
  return cookies.filter((c) => matches(host, c)).map((c) => `${c.name}=${c.value}`).join('; ');
};

// Cookies saved by the last sign-in, without starting a browser. Null if there are none.
export function savedSession(base) {
  const header = cookieHeader(loadCookies(), base);
  return header ? { cookieHeader: header } : null;
}

// Many schools switched off "New Access Token" for students. Canvas's own web app calls
// /api/v1 with your session cookie, so we do the same: a real Chrome/Edge window (with its
// own profile, separate from your everyday browser) where you sign in once through your
// school's SSO. Later runs reuse that profile headlessly; your identity provider's
// "stay signed in" cookie usually signs you back in without any prompt.
export async function launch({ headless }) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const errors = [];
  const channels = process.env.CANVAS_MCP_BROWSER ? [process.env.CANVAS_MCP_BROWSER] : ['chrome', 'msedge', 'chromium'];
  for (const channel of channels) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, { channel, headless, viewport: headless ? undefined : null });
    } catch (e) { errors.push(`${channel}: ${e.message.split('\n')[0]}`); }
  }
  throw new Error(`Could not start Chrome or Edge. Install one of them, or set CANVAS_MCP_BROWSER.\n${errors.join('\n')}`);
}

// Asks Canvas who we are from inside the page, so the request carries the browser's cookies.
async function whoAmI(page) {
  return page.evaluate(async () => {
    try {
      const r = await fetch('/api/v1/users/self', { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!r.ok) return null;
      return JSON.parse((await r.text()).replace(/^while\(1\);/, ''));
    } catch { return null; }
  }).catch(() => null);
}

const sameOrigin = (url, base) => { try { return new URL(url).origin === base; } catch { return false; } };

// Canvas's own sign-in entry points (/login/saml, /login/openid_connect, ...). The one you
// used at login is remembered so a renewal can go straight to your school's SSO.
const LOGIN_PATH = /^\/login\/(?!canvas\b)[a-z_]+(\/\d+)?$/;

// Opens Canvas and waits until the page is on Canvas and /users/self answers.
//   startPath  where to start (default "/"; renewals use the remembered SSO entry)
//   onLoginPath(path)  called with the SSO entry point the browser went through
// Headless gives the SSO redirects a little time to bounce back on their own; a visible
// window waits for you to finish signing in, MFA included.
export async function openSession(base, { headless = true, startPath = '/', timeoutMs = headless ? 20000 : 600000, onLoginPath } = {}) {
  const ctx = await launch({ headless });
  try {
    const saved = loadCookies();
    if (saved.length) await ctx.addCookies(saved).catch(() => {});
    const first = ctx.pages()[0] || await ctx.newPage();
    let loginPath = null;
    ctx.on('page', (p) => watch(p));
    const watch = (p) => p.on('framenavigated', (f) => {
      if (f !== p.mainFrame() || !sameOrigin(f.url(), base)) return;
      const pathname = new URL(f.url()).pathname;
      if (LOGIN_PATH.test(pathname)) loginPath = pathname;
    });
    watch(first);
    await first.goto(base + startPath, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // SSO sometimes continues in another tab; watch whichever Canvas tab is still open.
      const open = ctx.pages().filter((p) => !p.isClosed());
      if (!open.length) throw new Error('The browser window was closed before sign-in finished.');
      const page = open.find((p) => sameOrigin(p.url(), base)) || open[0];
      if (sameOrigin(page.url(), base) && !/\/login/.test(new URL(page.url()).pathname)) {
        const me = await whoAmI(page);
        if (me?.id) {
          const all = await ctx.cookies();   // Canvas and the SSO provider, so SSO can renew later
          saveCookies(all);
          if (loginPath && onLoginPath) onLoginPath(loginPath);
          return { me, cookieHeader: cookieHeader(all, base) };
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(headless ? 'Canvas did not sign in silently.' : 'Timed out waiting for you to sign in to Canvas.');
  } finally {
    await ctx.close().catch(() => {});
  }
}

// What the server does when Canvas rejects the saved cookies:
//  1. a hidden browser, for schools whose SSO bounces straight back;
//  2. otherwise a visible window opened at your school's SSO entry. While the SSO still
//     remembers you it signs in and closes by itself in a second or two; if the SSO session
//     has ended too, the window waits for you to sign in (bot checks are left to you, never automated).
// CANVAS_MCP_RENEW=hidden skips step 2 (then run `login` yourself when the session expires).
//  `hiddenWorks: false` (remembered after the first failure) skips step 1, which saves ~20 s.
export async function renewSession(base, { loginPath, onLoginPath, hiddenWorks, onHiddenResult = () => {}, log = () => {} } = {}) {
  if (hiddenWorks !== false) {
    try { const s = await openSession(base, { headless: true, onLoginPath }); onHiddenResult(true); return s; }
    catch { onHiddenResult(false); }
  }
  if (process.env.CANVAS_MCP_RENEW === 'hidden') {
    throw new Error('Your Canvas session has expired. Run: npx canvas-session-mcp login');
  }
  log('Canvas session expired; opening a sign-in window…');
  try {
    return await openSession(base, { headless: false, startPath: loginPath || '/', timeoutMs: 180000, onLoginPath });
  } catch (e) {
    throw new Error(`Your Canvas session has expired and the sign-in window was not completed (${e.message}). Run: npx canvas-session-mcp login`);
  }
}
