import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HOME, downloadDir } from './config.js';

const MAX_DOWNLOAD = 60 * 1024 * 1024;

const parseJson = (text) => JSON.parse(text.replace(/^while\(1\);/, ''));   // Canvas's anti-XSSI prefix

function nextLink(header) {
  const part = String(header || '').split(',').find((s) => s.includes('rel="next"'));
  return part ? part.slice(part.indexOf('<') + 1, part.indexOf('>')) : null;
}

export function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) for (const x of v) q.append(k.endsWith('[]') ? k : `${k}[]`, String(x));
    else q.append(k, String(v));
  }
  return q.toString();
}

// Read-only Canvas client. It only ever sends GET requests.
// `session()` returns { cookieHeader } and is called again (fresh=true) once if Canvas says 401.
export class CanvasClient {
  constructor({ base, session, fetchImpl = fetch }) {
    this.base = base;
    this.session = session;
    this.fetch = fetchImpl;
    this.cookie = null;
    this.courseFolders = new Map();   // course id → folder name (course code)
    this.fileCourse = new Map();      // file id → course id, noted whenever a tool sees the file inside a course
  }

  noteFiles(courseId, ids) { for (const id of ids || []) if (id) this.fileCourse.set(String(id), String(courseId)); }

  async courseCode(courseId) {
    if (!this.courseFolders.has(String(courseId))) {
      const c = await this.get(`courses/${courseId}`).catch(() => ({}));
      this.courseFolders.set(String(courseId), c.course_code || c.name || null);
    }
    return this.courseFolders.get(String(courseId));
  }

  async request(url, { raw = false } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.cookie || attempt === 1) this.cookie = (await this.session({ fresh: attempt === 1 })).cookieHeader;
      const res = await this.fetch(url, {
        method: 'GET',
        headers: { Accept: raw ? '*/*' : 'application/json', Cookie: this.cookie },
        redirect: 'follow',
      });
      if (res.status === 401 && attempt === 0) { await res.body?.cancel?.(); continue; }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let msg = text.slice(0, 200);
        try { const j = parseJson(text); msg = j.errors?.[0]?.message || j.message || msg; } catch { /* not JSON */ }
        const err = new Error(`Canvas ${res.status}${msg ? `: ${msg}` : ''}`);
        err.status = res.status;
        throw err;
      }
      return res;
    }
    throw new Error('Canvas keeps answering 401. Run: npx canvas-session-mcp login');
  }

  url(p, params) {
    const rel = p.startsWith('/') ? p : `/api/v1/${p}`;
    const q = query(params);
    return `${this.base}${rel}${q ? (rel.includes('?') ? '&' : '?') + q : ''}`;
  }

  async get(p, params = {}) {
    const res = await this.request(this.url(p, params));
    return parseJson(await res.text());
  }

  // Follows Canvas's Link: rel="next" pagination.
  async list(p, params = {}, { maxPages = 10 } = {}) {
    let url = this.url(p, { per_page: 100, ...params });
    const out = [];
    for (let i = 0; url && i < maxPages; i++) {
      const res = await this.request(url);
      const data = parseJson(await res.text());
      out.push(...(Array.isArray(data) ? data : [data]));
      url = nextLink(res.headers.get('link'));
    }
    return out;
  }

  // Course folder for a file: from where a tool saw it, else from its Canvas folder
  // (students often may not read folders, hence the first). Null if unknown.
  async courseFolderOf(fileId, meta) {
    if (this.fileCourse.has(String(fileId))) return this.courseCode(this.fileCourse.get(String(fileId)));
    try {
      const folder = await this.get(`folders/${meta.folder_id}`);
      return folder.context_type === 'Course' ? this.courseCode(folder.context_id) : null;
    } catch { return null; }
  }

  // Saves a course file under your download folder (by default in a subfolder named after the
  // course) and returns its path and contents. A small index remembers which Canvas file went
  // where, so the same file is not downloaded twice and two different files that share a name
  // never overwrite each other.

  async download(fileId, { subdir } = {}) {
    const meta = await this.get(`files/${fileId}`);
    if (!meta.url) throw new Error(`File ${fileId} (${meta.display_name || 'unknown'}) is locked or not available to you yet.`);
    if (meta.size > MAX_DOWNLOAD) throw new Error(`File is ${(meta.size / 1048576).toFixed(1)} MB; the limit is ${MAX_DOWNLOAD / 1048576} MB.`);
    const info = { name: meta.display_name, contentType: meta['content-type'], updatedAt: meta.updated_at };
    const dir = path.join(downloadDir(), ...String(subdir ?? (await this.courseFolderOf(fileId, meta)) ?? '').split('/').filter(Boolean).map(safeName));
    const index = readIndex();
    let known = index[fileId];
    if (known && !fs.existsSync(known.path)) known = null;
    // Saved before under another folder (e.g. read first, then the whole course saved): move it,
    // unless that copy also stands in for an identical upload (then it stays where it is).
    const shared = known && Object.entries(index).some(([k, v]) => k !== String(fileId) && v.path === known.path);
    if (known && !shared && path.dirname(known.path) !== dir) {
      const to = freePath(path.join(dir, path.basename(known.path)));
      fs.mkdirSync(dir, { recursive: true });
      fs.renameSync(known.path, to);
      known = { ...known, path: to };
      index[fileId] = known;
      writeIndex(index);
    }
    if (known && known.updatedAt === meta.updated_at && fs.statSync(known.path).size === meta.size) {
      return { ...info, path: known.path, buffer: fs.readFileSync(known.path), size: meta.size, cached: true };
    }
    const res = await this.request(meta.url, { raw: true });
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    // Teachers often upload the same PDF twice (an announcement and the assignment page):
    // identical content is kept once.
    const twin = !known && Object.values(index).find((v) => v.sha === sha && fs.existsSync(v.path));
    if (twin) {
      index[fileId] = { path: twin.path, updatedAt: meta.updated_at, sha };
      writeIndex(index);
      return { ...info, path: twin.path, buffer: buf, size: buf.length, cached: true, duplicate: true };
    }
    const file = known?.path || freePath(path.join(dir, safeName(meta.display_name || meta.filename || `file-${fileId}`)));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buf);
    index[fileId] = { path: file, updatedAt: meta.updated_at, sha };
    writeIndex(index);
    return { ...info, path: file, buffer: buf, size: buf.length, cached: false };
  }
}

const INDEX_FILE = path.join(HOME, 'downloads.json');
function readIndex() { try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch { return {}; } }
function writeIndex(index) { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 1)); }
export const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 150);
function freePath(file) {
  if (!fs.existsSync(file)) return file;
  const { dir, name, ext } = path.parse(file);
  for (let i = 2; ; i++) { const f = path.join(dir, `${name} (${i})${ext}`); if (!fs.existsSync(f)) return f; }
}
