import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'node:module';
import { baseUrl, readConfig, writeConfig } from './config.js';
import { renewSession, savedSession } from './browser.js';
import { CanvasClient } from './canvas.js';
import { registerTools } from './tools.js';

const { version } = createRequire(import.meta.url)('../package.json');

// The browser is only started to get (or refresh) the session cookie; API calls then go
// straight from Node. One refresh at a time even if the model calls several tools at once.
// Saved cookies are tried first (no browser at all); the browser only opens when Canvas rejects them.
const renewWithConfig = (base) => renewSession(base, {
  loginPath: readConfig().loginPath,
  onLoginPath: (p) => writeConfig({ loginPath: p }),
  hiddenWorks: readConfig().hiddenRenewWorks,
  onHiddenResult: (ok) => writeConfig({ hiddenRenewWorks: ok }),
  log: (m) => process.stderr.write(m + '\n'),
});

export function sessionProvider(base, open = renewWithConfig, saved = savedSession) {
  let pending = null;
  let cached = null;
  return async ({ fresh = false } = {}) => {
    if (!cached && !fresh) cached = saved(base);
    if (cached && !fresh) return cached;
    if (!pending) pending = open(base).then((s) => { cached = s; return s; }).finally(() => { pending = null; });
    return pending;
  };
}

export async function startServer() {
  const server = new McpServer({ name: 'canvas-session-mcp', version });
  let client = null;
  registerTools(server, async () => {
    if (!client) { const base = baseUrl(); client = new CanvasClient({ base, session: sessionProvider(base) }); }
    return client;
  });
  await server.connect(new StdioServerTransport());
}
