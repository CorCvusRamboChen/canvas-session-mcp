import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.CANVAS_MCP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-mcp-test-'));
process.env.CANVAS_MCP_DOWNLOADS = path.join(process.env.CANVAS_MCP_HOME, 'downloads');
const { CanvasClient, query } = await import('../src/canvas.js');
const { TOOLS } = await import('../src/tools.js');
const { sessionProvider } = await import('../src/server.js');
const { htmlToText, fileIdsIn, window } = await import('../src/text.js');

// A tiny fake Canvas: checks the session cookie, paginates, and refuses anything but GET.
let server;
let base;
const seen = [];
before(async () => {
  server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (req.method !== 'GET') return send(405, { errors: [{ message: 'read only' }] });
    if (req.url.startsWith('/dl/')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(req.url === '/dl/558' ? 'Assignment 3: Q1 ...' : req.url === '/dl/559' ? 'Week 1 notes: vectors and matrices' : 'Week 1 notes: vectors and matrices');
    }
    if (req.headers.cookie !== 'canvas_session=good') return send(401, { errors: [{ message: 'Invalid access token.' }] });
    const u = new URL(req.url, base);
    switch (u.pathname) {
      case '/api/v1/users/self': return send(200, 'while(1);{"id":7,"name":"Test Student"}');
      case '/api/v1/courses':
        if (u.searchParams.get('page') === '2') return send(200, [{ id: 2, name: 'Databases', course_code: 'COMP2400' }]);
        return send(200, [{ id: 1, name: 'Linear Algebra', course_code: 'MATH1012', term: { name: 'Sem 2' } }],
          { Link: `<${base}/api/v1/courses?page=2>; rel="next"` });
      case '/api/v1/courses/1': return send(200, { id: 1, name: 'Linear Algebra', course_code: 'MATH1012' });
      case '/api/v1/courses/1/assignments/9':
        return send(200, { name: 'Assignment 3', due_at: '2026-09-20T13:59:00Z', points_possible: 10,
          description: '<p>Show <b>all</b> working.</p><a href="/courses/1/files/555/download">Assign3.pdf</a>',
          rubric: [{ description: 'Q1', points: 4, ratings: [{ points: 4, description: 'Full' }] }],
          submission: { workflow_state: 'unsubmitted', missing: true } });
      case '/api/v1/courses/1/files': return send(403, { status: 'unauthorized' });
      case '/api/v1/courses/1/modules':
        return send(200, [{ name: 'Week 1', items: [{ type: 'File', title: 'notes.txt', content_id: 555 }, { type: 'Page', title: 'Intro', page_url: 'intro' }] }]);
      case '/api/v1/folders/77': return send(200, { id: 77, context_type: 'Course', context_id: 1 });
      case '/api/v1/files/555': return send(200, { id: 555, folder_id: 77, display_name: 'notes.txt', 'content-type': 'text/plain', size: 34, url: `${base}/dl/555` });
      case '/api/v1/announcements': return send(200, [{ context_code: 'course_1', title: 'Assignment 3', message: '<p>See attached</p>', attachments: [{ id: 558, display_name: 'Assing3.pdf' }] }]);
      case '/api/v1/courses/1/assignments': return send(200, [{ id: 9, name: 'A3', description: '<a href="/courses/1/files/555">notes</a>' }]);
      case '/api/v1/files/558': return send(200, { id: 558, display_name: 'Assing3.pdf', 'content-type': 'text/plain', size: 20, url: `${base}/dl/558` });
      case '/api/v1/files/559': return send(200, { id: 559, display_name: 'notes-copy.txt', 'content-type': 'text/plain', size: 34, url: `${base}/dl/559` });
      case '/api/v1/files/556': return send(200, { id: 556, display_name: 'locked.pdf', url: '' });
      case '/api/v1/planner/items':
        return send(200, [{ context_name: 'MATH1012', plannable_type: 'assignment', plannable: { title: 'Assignment 4', points_possible: 10 },
          plannable_date: '2026-10-11T12:59:00Z', submissions: { submitted: false }, course_id: 1, plannable_id: 10, html_url: '/courses/1/assignments/10' }]);
      default: return send(404, { errors: [{ message: 'not found' }] });
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const tool = (name) => TOOLS.find((t) => t.name === name);
const client = (cookies = ['canvas_session=good']) => {
  let i = 0;
  return new CanvasClient({ base, session: async () => ({ cookieHeader: cookies[Math.min(i++, cookies.length - 1)] }) });
};
const body = (r) => r.content[0].text;

test('query encodes arrays the way Canvas expects', () => {
  assert.equal(query({ include: ['term', 'teachers'], per_page: 100, skip: undefined }), 'include%5B%5D=term&include%5B%5D=teachers&per_page=100');
});

test('list follows Link pagination and strips the while(1) prefix', async () => {
  const r = JSON.parse(body(await tool('canvas_list_courses').run(client(), {})));
  assert.deepEqual(r.map((c) => c.code), ['MATH1012', 'COMP2400']);
  assert.equal(r[0].term, 'Sem 2');
  assert.equal(JSON.parse(body(await tool('canvas_whoami').run(client(), {}))).name, 'Test Student');
});

test('an expired cookie is refreshed once, then the call succeeds', async () => {
  const r = await tool('canvas_whoami').run(client(['canvas_session=old', 'canvas_session=good']), {});
  assert.match(body(r), /Test Student/);
});

test('assignment details: HTML → text, linked file ids, rubric, submission', async () => {
  const a = JSON.parse(body(await tool('canvas_get_assignment').run(client(), { course_id: '1', assignment_id: '9' })));
  assert.match(a.instructions, /Show ALL working|Show all working/i);
  assert.deepEqual(a.file_ids, ['555']);
  assert.equal(a.rubric[0].criterion, 'Q1');
  assert.equal(a.submission.missing, true);
});

test('hidden Files tab falls back to files linked in modules', async () => {
  const r = JSON.parse(body(await tool('canvas_list_files').run(client(), { course_id: '1' })));
  assert.match(r.note, /hidden/);
  // modules + announcement attachments (a misspelt assignment sheet, as happened in real life)
  assert.deepEqual(r.files, [{ id: 555, name: 'notes.txt', where: 'Week 1' }, { id: 558, name: 'Assing3.pdf', where: 'Announcements' }]);
});

test('read_file downloads, saves locally and returns the text', async () => {
  const r = body(await tool('canvas_read_file').run(client(), { file_id: '555' }));
  assert.match(r, /Week 1 notes: vectors and matrices/);
  const saved = r.match(/saved to: (.*)/)[1];
  assert.ok(fs.existsSync(saved));
  assert.ok(saved.includes(path.join('downloads', 'MATH1012')), saved);   // filed under its course
  await assert.rejects(tool('canvas_read_file').run(client(), { file_id: '556' }), /locked/);
});

test('save_course_files puts files under <folder>/<course>/<module> and skips unchanged ones', async () => {
  // notes.txt was already read (and saved) by the read_file test: it is moved, not downloaded again
  const first = JSON.parse(body(await tool('canvas_save_course_files').run(client(), { course_id: '1' })));
  assert.equal(first.unchanged, 1);
  assert.ok(first.saved[0].endsWith(path.join('MATH1012', 'Announcements', 'Assing3.pdf')));
  const saved = path.join(process.env.CANVAS_MCP_DOWNLOADS, 'MATH1012', 'Week 1', 'notes.txt');
  assert.equal(fs.readFileSync(saved, 'utf8'), 'Week 1 notes: vectors and matrices');
  const again = JSON.parse(body(await tool('canvas_save_course_files').run(client(), { course_id: '1' })));
  assert.equal(again.unchanged, 2);
  assert.equal(again.saved, undefined);
});

test('identical uploads are stored once', async () => {
  const r = await client().download('559');   // same bytes as 555, uploaded again under another name
  assert.equal(r.duplicate, true);
  assert.ok(r.path.endsWith('notes.txt'));
});

test('upcoming gives absolute links and submission state', async () => {
  const [it] = JSON.parse(body(await tool('canvas_upcoming').run(client(), {})));
  assert.equal(it.title, 'Assignment 4');
  assert.equal(it.submitted, false);
  assert.equal(it.url, `${base}/courses/1/assignments/10`);
});

test('raw API GET refuses absolute URLs and never sends anything but GET', async () => {
  await assert.rejects(tool('canvas_api_get').run(client(), { path: 'https://evil.example/x' }), /relative/);
  assert.ok(seen.every((l) => l.startsWith('GET ')));
});

test('session provider opens the browser once for concurrent calls', async () => {
  let opens = 0;
  const get = sessionProvider(base, async () => { opens++; await new Promise((r) => setTimeout(r, 20)); return { cookieHeader: 'x' }; }, () => null);
  await Promise.all([get(), get(), get()]);
  assert.equal(opens, 1);
  await get({ fresh: true });
  assert.equal(opens, 2);
});

test('saved cookies are used without opening a browser', async () => {
  let opens = 0;
  const get = sessionProvider(base, async () => { opens++; return { cookieHeader: 'fresh' }; }, () => ({ cookieHeader: 'saved' }));
  assert.equal((await get()).cookieHeader, 'saved');
  assert.equal(opens, 0);
  assert.equal((await get({ fresh: true })).cookieHeader, 'fresh');
  assert.equal(opens, 1);
});

test('text helpers', () => {
  assert.equal(htmlToText('<p>a</p><img src="x"><p>b</p>'), 'a\n\nb');
  assert.deepEqual(fileIdsIn('<a href="/courses/1/files/12?wrap=1">x</a><a href="/files/12/download">y</a>'), ['12']);
  assert.match(window('abcdef', { maxChars: 4 }), /^abcd\n\n\[\.\.\. 2 more characters\. Call again with offset=4\.\]$/);
});
