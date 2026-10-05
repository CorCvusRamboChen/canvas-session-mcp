// Live check against your own Canvas, through a real MCP client, the same way an AI app uses it.
// Read-only. Prints a short pass/fail per tool, never the content of your courses.
//   node scripts/verify-live.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
const client = new Client({ name: 'verify-live', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli], env: process.env, stderr: 'inherit' }));

const results = [];
async function check(label, name, args, expect) {
  const t = Date.now();
  let ok = false; let note = '';
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text || '';
    if (r.isError) note = text.slice(0, 160);
    else { const v = expect(text); ok = v === true || (typeof v === 'string' && !v.startsWith('✗')); note = typeof v === 'string' ? v : ''; }
  } catch (e) { note = e.message; }
  results.push({ ok, label, ms: Date.now() - t, note });
  process.stderr.write(`${ok ? '✓' : '✗'} ${label} (${Date.now() - t} ms) ${note}\n`);
  return ok;
}
const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };

let courses = [];
await check('whoami', 'canvas_whoami', {}, (t) => !!parse(t)?.id);
await check('list courses', 'canvas_list_courses', {}, (t) => { courses = parse(t) || []; return courses.length ? `${courses.length} current courses` : '✗ none'; });
await check('upcoming (planner)', 'canvas_upcoming', { days: 14, past_days: 14 }, (t) => Array.isArray(parse(t)) ? `${parse(t).length} items` : '✗');
await check('announcements', 'canvas_list_announcements', { days: 60 }, (t) => Array.isArray(parse(t)) ? `${parse(t).length} items` : '✗');
await check('overall grades', 'canvas_grades', {}, (t) => Array.isArray(parse(t)));
await check('inbox', 'canvas_inbox', { max: 5 }, (t) => Array.isArray(parse(t)));
await check('calendar', 'canvas_calendar', { days: 30 }, (t) => Array.isArray(parse(t)));

// Per course: modules, files (incl. hidden-Files-tab fallback), assignments, one file read as text
let readOne = false;
for (const c of courses) {
  const cid = String(c.id);
  let mods = [];
  await check(`${c.code}: modules`, 'canvas_list_modules', { course_id: cid }, (t) => { mods = parse(t) || []; return `${mods.length} modules`; });
  await check(`${c.code}: files`, 'canvas_list_files', { course_id: cid }, (t) => {
    const j = parse(t); const n = Array.isArray(j) ? j.length : j?.files?.length;
    return `${n} files${Array.isArray(j) ? '' : ' (Files tab hidden → module fallback)'}`;
  });
  await check(`${c.code}: assignments`, 'canvas_list_assignments', { course_id: cid }, (t) => Array.isArray(parse(t)) ? `${parse(t).length} assignments` : '✗');
  const pdf = mods.flatMap((m) => m.items || []).find((it) => it.file_id && /\.pdf$/i.test(it.title));
  if (pdf && !readOne) {
    readOne = await check(`${c.code}: read a PDF as text`, 'canvas_read_file', { file_id: String(pdf.file_id), max_chars: 2000 },
      (t) => (/--- page 1 ---/.test(t) && t.replace(/\s/g, '').length > 300 ? 'text extracted' : '✗ no text'));
  }
  const page = mods.flatMap((m) => m.items || []).find((it) => it.page_url);
  if (page) await check(`${c.code}: read a page`, 'canvas_get_page', { course_id: cid, page_url: page.page_url, max_chars: 500 }, (t) => t.startsWith('# '));
}

await client.close();
const failed = results.filter((r) => !r.ok);
process.stderr.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
process.exitCode = failed.length ? 1 : 0;
