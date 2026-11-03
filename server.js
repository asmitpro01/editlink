// EditLink — zero-dependency server (Node 22.5+ : node:http + node:sqlite)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'editlink.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  editor_token TEXT UNIQUE NOT NULL,
  review_token TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  client_name TEXT,
  client_phone TEXT,
  editor_name TEXT,
  video_url TEXT NOT NULL,
  free_rounds INTEGER DEFAULT 2,
  extra_round_fee INTEGER DEFAULT 0,
  upi_id TEXT,
  round INTEGER DEFAULT 1,
  status TEXT DEFAULT 'in_review',
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  ts REAL,
  text TEXT,
  audio_file TEXT,
  author TEXT,
  done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

const tok = () => crypto.randomBytes(9).toString('base64url');

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function json(req) { const b = await readBody(req, 1e6); return b.length ? JSON.parse(b.toString()) : {}; }

const projectByEditor = t => db.prepare('SELECT * FROM projects WHERE editor_token = ?').get(t);
const projectByReview = t => db.prepare('SELECT * FROM projects WHERE review_token = ?').get(t);
const commentsFor = id => db.prepare('SELECT * FROM comments WHERE project_id = ? ORDER BY round, ts IS NULL, ts, id').all(id);

// public view of a project (hide editor token)
function publicProject(p) {
  const { editor_token, ...rest } = p;
  const extra = Math.max(0, p.round - p.free_rounds);
  return { ...rest, extra_rounds: extra, amount_due: extra * (p.extra_round_fee || 0) };
}

// Optional AI: turn feedback into a clean task list. Uses any OpenAI-compatible API if configured.
async function aiTasks(p, comments) {
  const base = process.env.AI_BASE_URL, key = process.env.AI_API_KEY, model = process.env.AI_MODEL;
  const lines = comments.filter(c => c.round === p.round && c.text)
    .map(c => `[${c.ts != null ? fmt(c.ts) : 'general'}] ${c.text}`).join('\n');
  if (!lines) return { tasks: [], source: 'none' };
  if (!base || !key || !model) {
    // fallback: one task per comment, sorted by timestamp
    return { tasks: lines.split('\n'), source: 'basic' };
  }
  const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, messages: [
      { role: 'system', content: 'You convert client video feedback (Hindi, English or Hinglish) into a short, clear, numbered edit task list for a video editor. Keep timestamps like [0:42]. Merge duplicates. Reply in simple Hinglish, one task per line, no extra text.' },
      { role: 'user', content: lines } ] })
  });
  const j = await r.json();
  const out = j.choices?.[0]?.message?.content || '';
  return { tasks: out.split('\n').map(s => s.trim()).filter(Boolean), source: 'ai' };
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.mp4': 'audio/mp4' };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname; const m = req.method;
    let mt;

    // pages
    if (m === 'GET' && (p === '/' || p === '/index.html')) return file(res, 'index.html');
    if (m === 'GET' && /^\/e\/[\w-]+$/.test(p)) return file(res, 'editor.html');
    if (m === 'GET' && /^\/r\/[\w-]+$/.test(p)) return file(res, 'review.html');
    if (m === 'GET' && p.startsWith('/static/')) return file(res, p.slice(8));
    if (m === 'GET' && (mt = p.match(/^\/audio\/([\w-]+\.(webm|ogg|mp4))$/))) {
      const f = path.join(AUDIO_DIR, mt[1]);
      if (!fs.existsSync(f)) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME['.' + mt[2]] }); return fs.createReadStream(f).pipe(res);
    }

    // create project
    if (m === 'POST' && p === '/api/projects') {
      const b = await json(req);
      if (!b.title || !b.video_url) return send(res, 400, { error: 'title aur video_url zaroori hai' });
      const et = tok(), rt = tok();
      db.prepare(`INSERT INTO projects (editor_token, review_token, title, client_name, client_phone, editor_name, video_url, free_rounds, extra_round_fee, upi_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(et, rt, b.title, b.client_name || '', (b.client_phone || '').replace(/\D/g, ''), b.editor_name || '',
        b.video_url, Number(b.free_rounds ?? 2), Number(b.extra_round_fee || 0), b.upi_id || '');
      return send(res, 201, { editor_token: et, review_token: rt });
    }

    // editor API
    if ((mt = p.match(/^\/api\/editor\/([\w-]+)(\/.*)?$/))) {
      const proj = projectByEditor(mt[1]); if (!proj) return send(res, 404, { error: 'project nahi mila' });
      const sub = mt[2] || '';
      if (m === 'GET' && sub === '') return send(res, 200, { project: { ...publicProject(proj), editor_token: proj.editor_token }, comments: commentsFor(proj.id) });
      if (m === 'POST' && sub === '/new-version') {
        const b = await json(req);
        db.prepare(`UPDATE projects SET video_url = COALESCE(?, video_url), round = round + 1, status = 'in_review', approved_at = NULL WHERE id = ?`).run(b.video_url || null, proj.id);
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && (mt = sub.match(/^\/comments\/(\d+)\/toggle$/))) {
        db.prepare('UPDATE comments SET done = 1 - done WHERE id = ? AND project_id = ?').run(Number(mt[1]), proj.id);
        return send(res, 200, { ok: true });
      }
      if (m === 'GET' && sub === '/tasks') return send(res, 200, await aiTasks(proj, commentsFor(proj.id)));
      if (m === 'DELETE' && sub === '') {
        db.prepare('DELETE FROM comments WHERE project_id = ?').run(proj.id);
        db.prepare('DELETE FROM projects WHERE id = ?').run(proj.id);
        return send(res, 200, { ok: true });
      }
    }

    // client review API
    if ((mt = p.match(/^\/api\/review\/([\w-]+)(\/.*)?$/))) {
      const proj = projectByReview(mt[1]); if (!proj) return send(res, 404, { error: 'link galat hai' });
      const sub = mt[2] || '';
      if (m === 'GET' && sub === '') return send(res, 200, { project: publicProject(proj), comments: commentsFor(proj.id).filter(c => c.round === proj.round) });
      if (m === 'POST' && sub === '/comments') {
        if (proj.status === 'approved') return send(res, 409, { error: 'Video already approved hai' });
        const b = await json(req);
        if (!b.text || !String(b.text).trim()) return send(res, 400, { error: 'comment khaali hai' });
        db.prepare('INSERT INTO comments (project_id, round, ts, text, author) VALUES (?,?,?,?,?)')
          .run(proj.id, proj.round, b.ts == null ? null : Number(b.ts), String(b.text).slice(0, 2000), b.author || proj.client_name || 'Client');
        return send(res, 201, { ok: true });
      }
      if (m === 'POST' && sub === '/voice') {
        if (proj.status === 'approved') return send(res, 409, { error: 'Video already approved hai' });
        const ct = req.headers['content-type'] || '';
        const ext = ct.includes('ogg') ? 'ogg' : ct.includes('mp4') ? 'mp4' : 'webm';
        const buf = await readBody(req, 8 * 1024 * 1024);
        if (!buf.length) return send(res, 400, { error: 'audio khaali hai' });
        const name = tok() + '.' + ext; fs.writeFileSync(path.join(AUDIO_DIR, name), buf);
        const ts = url.searchParams.get('ts');
        db.prepare('INSERT INTO comments (project_id, round, ts, text, audio_file, author) VALUES (?,?,?,?,?,?)')
          .run(proj.id, proj.round, ts == null || ts === '' ? null : Number(ts), '🎤 Voice note', name, proj.client_name || 'Client');
        return send(res, 201, { ok: true });
      }
      if (m === 'POST' && sub === '/approve') {
        db.prepare(`UPDATE projects SET status = 'approved', approved_at = datetime('now') WHERE id = ?`).run(proj.id);
        return send(res, 200, { ok: true });
      }
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e); send(res, 500, { error: 'server error' });
  }
});

function file(res, name) {
  const f = path.join(__dirname, 'public', path.normalize(name).replace(/^(\.\.[\/\\])+/, ''));
  if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f)) return send(res, 404, 'Not found', 'text/plain');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}

if (require.main === module) server.listen(PORT, () => console.log(`EditLink chal raha hai: http://localhost:${PORT}`));
module.exports = { server, db };
