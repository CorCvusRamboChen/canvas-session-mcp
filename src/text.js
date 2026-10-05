import { convert } from 'html-to-text';

// Canvas stores pages, assignment descriptions and announcements as HTML. Models read plain
// text better, and it is far fewer tokens. Links are kept so file links stay discoverable.
export function htmlToText(html) {
  if (!html) return '';
  return convert(String(html), {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true, ignoreHref: false } },
    ],
  }).replace(/\n{3,}/g, '\n\n').trim();
}

// Canvas file links look like /courses/1/files/123 or /files/123/download. Surfacing the ids
// lets the model call canvas_read_file on handouts that are only linked from a page.
export function fileIdsIn(html) {
  const ids = new Set();
  for (const m of String(html || '').matchAll(/\/files\/(\d+)/g)) ids.add(m[1]);
  return [...ids];
}

const ext = (name) => String(name || '').toLowerCase().split('.').pop();

// Turns a downloaded file into text. Returns null for formats we cannot read
// (the caller still gets the local path, so another tool can open it).
export async function extractText(buffer, { name, contentType } = {}) {
  const e = ext(name);
  const ct = String(contentType || '').toLowerCase();
  if (e === 'pdf' || ct.includes('pdf')) {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await pdfText(pdf, { mergePages: false });
    return text.map((t, i) => `--- page ${i + 1} ---\n${t.trim()}`).join('\n\n');
  }
  if (e === 'docx' || ct.includes('wordprocessingml')) {
    const mammoth = await import('mammoth');
    return (await mammoth.default.extractRawText({ buffer })).value;
  }
  if (['html', 'htm'].includes(e) || ct.includes('text/html')) return htmlToText(buffer.toString('utf8'));
  if (['txt', 'md', 'csv', 'json', 'py', 'java', 'c', 'cpp', 'js', 'ts', 'sql', 'r', 'tex', 'xml', 'yaml', 'yml'].includes(e) || ct.startsWith('text/')) {
    return buffer.toString('utf8');
  }
  return null;
}

// Long documents are returned in windows so a model can page through them.
export function window(text, { offset = 0, maxChars = 20000 } = {}) {
  const slice = text.slice(offset, offset + maxChars);
  const end = offset + slice.length;
  const more = end < text.length ? `\n\n[... ${text.length - end} more characters. Call again with offset=${end}.]` : '';
  return slice + more;
}
