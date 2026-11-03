// EditLink v0.2 — zero-dependency server (Node 22.5+: node:http + node:sqlite)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILES = path.join(DATA_DIR, 'files');
fs.mkdirSync(FILES, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'editlink.db'));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS editors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  pin_hash TEXT NOT NULL, salt TEXT NOT NULL, upi_id TEXT DEFAULT '', brand TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, editor_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, editor_id INTEGER NOT NULL, review_token TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL, client_name TEXT DEFAULT '', client_phone TEXT DEFAULT '',
  project_fee INTEGER DEFAULT 0, free_rounds INTEGER DEFAULT 2, extra_round_fee INTEGER DEFAULT 0,
  paid_total INTEGER DEFAULT 0, manual_unlock INTEGER DEFAULT 0, final_url TEXT DEFAULT '',
  deadline TEXT DEFAULT '', round INTEGER DEFAULT 1, status TEXT DEFAULT 'in_review',
  approved_at TEXT, approved_by TEXT, approval_hash TEXT, last_seen_at TEXT,
  created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, round INTEGER NOT NULL,
  video_url TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, round INTEGER NOT NULL,
  ts REAL, text TEXT DEFAULT '', audio_file TEXT, drawing_file TEXT, transcript TEXT,
  author TEXT DEFAULT 'Client', from_editor INTEGER DEFAULT 0, done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, amount INTEGER NOT NULL,
  note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')));
`);

// ---------- helpers ----------
const tok = (n = 9) => crypto.randomBytes(n).toString('base64url');
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const q = (sql) => db.prepare(sql);
const log = (pid, kind, detail = '') => q('INSERT INTO events (project_id, kind, detail) VALUES (?,?,?)').run(pid, kind, detail);
const fmt = s => s == null ? 'General' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function send(res, code, body, type = 'application/json', headers = {}) {
  res.writeHead(code, { 'Content-Type': type, ...headers });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('File bahut badi hai'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
async function json(req) { const b = await readBody(req, 3e6); return b.length ? JSON.parse(b.toString()) : {}; }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(a => a[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])); }
function currentEditor(req) {
  const t = cookies(req).el_sess; if (!t) return null;
  return q('SELECT e.* FROM sessions s JOIN editors e ON e.id = s.editor_id WHERE s.token = ?').get(t) || null;
}
const phoneNorm = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };

// money: what the client owes right now
function money(p) {
  const extraRounds = Math.max(0, p.round - p.free_rounds);
  const total = (p.project_fee || 0) + extraRounds * (p.extra_round_fee || 0);
  const due = Math.max(0, total - (p.paid_total || 0));
  return { extra_rounds: extraRounds, total, due };
}
const unlocked = p => !!p.manual_unlock || (p.status === 'approved' && money(p).due === 0);

function clientView(p, editor) {
  const m = money(p);
  return {
    title: p.title, client_name: p.client_name, review_token: p.review_token, round: p.round, status: p.status,
    deadline: p.deadline, approved_at: p.approved_at, approved_by: p.approved_by, approval_hash: p.approval_hash,
    free_rounds: p.free_rounds, extra_round_fee: p.extra_round_fee, project_fee: p.project_fee, paid_total: p.paid_total,
    ...m, unlocked: unlocked(p), final_url: unlocked(p) ? p.final_url : '', has_final: !!p.final_url,
    editor_name: editor?.name || '', brand: editor?.brand || '', upi_id: editor?.upi_id || '',
  };
}
const versionsFor = id => q('SELECT * FROM versions WHERE project_id = ? ORDER BY round').all(id);
const commentsFor = id => q('SELECT * FROM comments WHERE project_id = ? ORDER BY round, ts IS NULL, ts, id').all(id);

function saveFile(buf, ext) { const name = tok() + '.' + ext; fs.writeFileSync(path.join(FILES, name), buf); return name; }

// ---------- optional AI (any OpenAI-compatible provider) ----------
async function aiTasks(p, comments) {
  const lines = comments.filter(c => c.round === p.round && !c.from_editor)
    .map(c => `[${fmt(c.ts)}] ${c.transcript || c.text}${c.drawing_file ? ' (screen pe drawing bhi hai)' : ''}`).filter(Boolean).join('\n');
  if (!lines) return { tasks: [], source: 'none' };
  const { AI_BASE_URL: base, AI_API_KEY: key, AI_MODEL: model } = process.env;
  if (!base || !key || !model) return { tasks: lines.split('\n'), source: 'basic' };
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, temperature: 0.2, messages: [
        { role: 'system', content: 'You turn client feedback on a video (Hindi/English/Hinglish) into a short numbered task list for the video editor. Keep timestamps like [0:42] at the start. Merge duplicates, split mixed requests, flag contradictions with ⚠️. Simple Hinglish. Only the list.' },
        { role: 'user', content: lines }] }) });
    const j = await r.json();
    const out = j.choices?.[0]?.message?.content || '';
    return out ? { tasks: out.split('\n').map(s => s.trim()).filter(Boolean), source: 'ai' } : { tasks: lines.split('\n'), source: 'basic' };
  } catch { return { tasks: lines.split('\n'), source: 'basic' }; }
}
async function transcribe(file, mime) {
  const { STT_BASE_URL: base, STT_API_KEY: key, STT_MODEL: model } = process.env;
  if (!base || !key || !model) return null;
  try {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(path.join(FILES, file))], { type: mime }), file);
    fd.append('model', model);
    const r = await fetch(base.replace(/\/$/, '') + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
    const j = await r.json(); return j.text || null;
  } catch { return null; }
}

// ---------- static ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
function file(res, name) {
  const root = path.join(__dirname, 'public');
  const f = path.join(root, path.normalize(name).replace(/^(\.\.[\/\\])+/, ''));
  if (!f.startsWith(root) || !fs.existsSync(f)) return send(res, 404, 'Not found', 'text/plain');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}

// ---------- routes ----------
async function route(req, res) {
  const url = new URL(req.url, 'http://x'); const p = url.pathname; const m = req.method; let mt;

  // pages
  if (m === 'GET') {
    if (p === '/' ) return file(res, 'index.html');
    if (p === '/app') return file(res, 'dashboard.html');
    if (/^\/app\/p\/\d+$/.test(p)) return file(res, 'project.html');
    if (/^\/r\/[\w-]+$/.test(p)) return file(res, 'review.html');
    if (/^\/c\/[\w-]+$/.test(p)) return file(res, 'certificate.html');
    if (p.startsWith('/static/')) return file(res, p.slice(8));
    if ((mt = p.match(/^\/f\/([\w-]+\.(webm|ogg|m4a|png))$/))) {
      const f = path.join(FILES, mt[1]); if (!fs.existsSync(f)) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME['.' + mt[2]], 'Cache-Control': 'private, max-age=86400' }); return fs.createReadStream(f).pipe(res);
    }
  }

  // ----- auth -----
  if (m === 'POST' && p === '/api/register') {
    const b = await json(req); const phone = phoneNorm(b.phone);
    if (phone.length < 10 || !b.name || !/^\d{4,6}$/.test(String(b.pin || ''))) return send(res, 400, { error: 'Naam, sahi phone aur 4–6 digit PIN do' });
    if (q('SELECT 1 FROM editors WHERE phone = ?').get(phone)) return send(res, 409, { error: 'Is number se account pehle se hai — login karo' });
    const salt = tok(12);
    const r = q('INSERT INTO editors (phone, name, pin_hash, salt, upi_id, brand) VALUES (?,?,?,?,?,?)').run(phone, b.name.trim(), hashPin(b.pin, salt), salt, (b.upi_id || '').trim(), (b.brand || '').trim());
    return startSession(res, Number(r.lastInsertRowid));
  }
  if (m === 'POST' && p === '/api/login') {
    const b = await json(req); const e = q('SELECT * FROM editors WHERE phone = ?').get(phoneNorm(b.phone));
    if (!e || !crypto.timingSafeEqual(Buffer.from(hashPin(b.pin || '', e.salt), 'hex'), Buffer.from(e.pin_hash, 'hex'))) return send(res, 401, { error: 'Phone ya PIN galat hai' });
    return startSession(res, e.id);
  }
  if (m === 'POST' && p === '/api/logout') {
    const t = cookies(req).el_sess; if (t) q('DELETE FROM sessions WHERE token = ?').run(t);
    return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': 'el_sess=; Path=/; Max-Age=0' });
  }

  // ----- editor API (needs login) -----
  if (p.startsWith('/api/me')) {
    const ed = currentEditor(req); if (!ed) return send(res, 401, { error: 'Login karo' });
    if (m === 'GET' && p === '/api/me') {
      const projects = q('SELECT * FROM projects WHERE editor_id = ? ORDER BY id DESC').all(ed.id).map(pr => ({
        id: pr.id, title: pr.title, client_name: pr.client_name, round: pr.round, status: pr.status, deadline: pr.deadline, created_at: pr.created_at,
        last_seen_at: pr.last_seen_at, ...money(pr), unlocked: unlocked(pr),
        open_comments: q('SELECT COUNT(*) n FROM comments WHERE project_id = ? AND round = ? AND done = 0 AND from_editor = 0').get(pr.id, pr.round).n }));
      const stats = { pending: projects.reduce((a, x) => a + x.due, 0), earned: q('SELECT COALESCE(SUM(pay.amount),0) s FROM payments pay JOIN projects pr ON pr.id = pay.project_id WHERE pr.editor_id = ?').get(ed.id).s,
        in_review: projects.filter(x => x.status !== 'approved').length, approved: projects.filter(x => x.status === 'approved').length };
      return send(res, 200, { editor: { name: ed.name, phone: ed.phone, upi_id: ed.upi_id, brand: ed.brand }, projects, stats });
    }
    if (m === 'POST' && p === '/api/me/settings') {
      const b = await json(req); q('UPDATE editors SET name = COALESCE(?, name), upi_id = COALESCE(?, upi_id), brand = COALESCE(?, brand) WHERE id = ?').run(b.name || null, b.upi_id ?? null, b.brand ?? null, ed.id);
      return send(res, 200, { ok: true });
    }
    if (m === 'POST' && p === '/api/me/projects') {
      const b = await json(req);
      if (!b.title || !b.video_url) return send(res, 400, { error: 'Project ka naam aur video link zaroori hai' });
      const r = q(`INSERT INTO projects (editor_id, review_token, title, client_name, client_phone, project_fee, free_rounds, extra_round_fee, paid_total, deadline)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(ed.id, tok(), b.title.trim(), (b.client_name || '').trim(), phoneNorm(b.client_phone),
        Number(b.project_fee || 0), Number(b.free_rounds ?? 2), Number(b.extra_round_fee || 0), Number(b.advance || 0), b.deadline || '');
      const pid = Number(r.lastInsertRowid);
      q('INSERT INTO versions (project_id, round, video_url, note) VALUES (?,?,?,?)').run(pid, 1, b.video_url.trim(), b.note || '');
      if (Number(b.advance) > 0) q('INSERT INTO payments (project_id, amount, note) VALUES (?,?,?)').run(pid, Number(b.advance), 'Advance');
      log(pid, 'created', 'Version 1');
      return send(res, 201, { id: pid });
    }
    if ((mt = p.match(/^\/api\/me\/projects\/(\d+)(\/.*)?$/))) {
      const pr = q('SELECT * FROM projects WHERE id = ? AND editor_id = ?').get(Number(mt[1]), ed.id);
      if (!pr) return send(res, 404, { error: 'Project nahi mila' });
      const sub = mt[2] || '';
      if (m === 'GET' && sub === '') return send(res, 200, {
        project: { ...pr, ...clientView(pr, ed), final_url: pr.final_url, client_phone: pr.client_phone },
        versions: versionsFor(pr.id), comments: commentsFor(pr.id),
        payments: q('SELECT * FROM payments WHERE project_id = ? ORDER BY id').all(pr.id),
        events: q('SELECT * FROM events WHERE project_id = ? ORDER BY id DESC LIMIT 30').all(pr.id) });
      if (m === 'POST' && sub === '/version') {
        const b = await json(req); if (!b.video_url) return send(res, 400, { error: 'Naye version ka link do' });
        const round = pr.round + 1;
        q('INSERT INTO versions (project_id, round, video_url, note) VALUES (?,?,?,?)').run(pr.id, round, b.video_url.trim(), b.note || '');
        q(`UPDATE projects SET round = ?, status = 'in_review', approved_at = NULL, approved_by = NULL, approval_hash = NULL WHERE id = ?`).run(round, pr.id);
        log(pr.id, 'version', `Version ${round}`); return send(res, 200, { ok: true, round });
      }
      if (m === 'POST' && sub === '/payment') {
        const b = await json(req); const amt = Math.round(Number(b.amount));
        if (!amt) return send(res, 400, { error: 'Amount do' });
        q('INSERT INTO payments (project_id, amount, note) VALUES (?,?,?)').run(pr.id, amt, b.note || '');
        q('UPDATE projects SET paid_total = paid_total + ? WHERE id = ?').run(amt, pr.id);
        log(pr.id, 'payment', `₹${amt}`); return send(res, 200, { ok: true });
      }
      if (m === 'POST' && sub === '/settings') {
        const b = await json(req);
        q(`UPDATE projects SET title = COALESCE(?, title), client_name = COALESCE(?, client_name), client_phone = COALESCE(?, client_phone),
          project_fee = COALESCE(?, project_fee), free_rounds = COALESCE(?, free_rounds), extra_round_fee = COALESCE(?, extra_round_fee),
          final_url = COALESCE(?, final_url), deadline = COALESCE(?, deadline), manual_unlock = COALESCE(?, manual_unlock) WHERE id = ?`)
          .run(b.title ?? null, b.client_name ?? null, b.client_phone != null ? phoneNorm(b.client_phone) : null,
            b.project_fee != null ? Number(b.project_fee) : null, b.free_rounds != null ? Number(b.free_rounds) : null,
            b.extra_round_fee != null ? Number(b.extra_round_fee) : null, b.final_url ?? null, b.deadline ?? null,
            b.manual_unlock != null ? (b.manual_unlock ? 1 : 0) : null, pr.id);
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && (mt = sub.match(/^\/comments\/(\d+)\/toggle$/))) {
        q('UPDATE comments SET done = 1 - done WHERE id = ? AND project_id = ?').run(Number(mt[1]), pr.id); return send(res, 200, { ok: true });
      }
      if (m === 'POST' && sub === '/reply') {
        const b = await json(req); if (!b.text) return send(res, 400, { error: 'Khaali reply' });
        q('INSERT INTO comments (project_id, round, ts, text, author, from_editor, done) VALUES (?,?,?,?,?,1,1)').run(pr.id, pr.round, b.ts ?? null, String(b.text).slice(0, 2000), ed.name);
        return send(res, 200, { ok: true });
      }
      if (m === 'GET' && sub === '/tasks') return send(res, 200, await aiTasks(pr, commentsFor(pr.id)));
      if (m === 'DELETE' && sub === '') {
        for (const t of ['comments', 'versions', 'payments', 'events']) q(`DELETE FROM ${t} WHERE project_id = ?`).run(pr.id);
        q('DELETE FROM projects WHERE id = ?').run(pr.id); return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'not found' });
  }

  // ----- client API (no login, token link) -----
  if ((mt = p.match(/^\/api\/review\/([\w-]+)(\/.*)?$/))) {
    const pr = q('SELECT * FROM projects WHERE review_token = ?').get(mt[1]); if (!pr) return send(res, 404, { error: 'Ye link galat ya purana hai' });
    const ed = q('SELECT * FROM editors WHERE id = ?').get(pr.editor_id);
    const sub = mt[2] || '';
    const locked = () => { if (pr.status !== 'approved') return false; send(res, 409, { error: 'Video approve ho chuka hai' }); return true; };
    if (m === 'GET' && sub === '') {
      if (url.searchParams.get('seen')) { q(`UPDATE projects SET last_seen_at = datetime('now') WHERE id = ?`).run(pr.id); }
      return send(res, 200, { project: clientView(pr, ed), versions: versionsFor(pr.id).map(v => ({ round: v.round, video_url: v.video_url, note: v.note, created_at: v.created_at })),
        comments: commentsFor(pr.id).map(({ project_id, ...c }) => c) });
    }
    if (m === 'POST' && sub === '/comments') {
      if (locked()) return; const b = await json(req);
      let drawing = null;
      if (b.drawing && /^data:image\/png;base64,/.test(b.drawing)) drawing = saveFile(Buffer.from(b.drawing.split(',')[1], 'base64'), 'png');
      if (!(b.text && String(b.text).trim()) && !drawing) return send(res, 400, { error: 'Comment khaali hai' });
      q('INSERT INTO comments (project_id, round, ts, text, drawing_file, author) VALUES (?,?,?,?,?,?)')
        .run(pr.id, pr.round, b.ts == null || b.ts === '' ? null : Number(b.ts), String(b.text || '').slice(0, 2000), drawing, (b.author || pr.client_name || 'Client').slice(0, 60));
      log(pr.id, 'comment', fmt(b.ts)); return send(res, 201, { ok: true });
    }
    if (m === 'POST' && sub === '/voice') {
      if (locked()) return;
      const ct = req.headers['content-type'] || ''; const ext = ct.includes('ogg') ? 'ogg' : ct.includes('mp4') ? 'm4a' : 'webm';
      const buf = await readBody(req, 8e6); if (!buf.length) return send(res, 400, { error: 'Audio khaali hai' });
      const name = saveFile(buf, ext); const ts = url.searchParams.get('ts');
      const r = q('INSERT INTO comments (project_id, round, ts, text, audio_file, author) VALUES (?,?,?,?,?,?)')
        .run(pr.id, pr.round, ts == null || ts === '' ? null : Number(ts), '🎤 Voice note', name, (url.searchParams.get('author') || pr.client_name || 'Client').slice(0, 60));
      log(pr.id, 'voice', fmt(ts));
      transcribe(name, ct).then(t => t && q('UPDATE comments SET transcript = ? WHERE id = ?').run(t, Number(r.lastInsertRowid)));
      return send(res, 201, { ok: true });
    }
    if (m === 'POST' && sub === '/approve') {
      if (locked()) return; const b = await json(req);
      const by = String(b.name || '').trim(); if (by.length < 2) return send(res, 400, { error: 'Approve karne ke liye apna naam likho' });
      const v = versionsFor(pr.id).at(-1); const at = new Date().toISOString();
      const hash = crypto.createHash('sha256').update([pr.id, pr.review_token, v?.video_url, by, at].join('|')).digest('hex').slice(0, 16).toUpperCase();
      q(`UPDATE projects SET status = 'approved', approved_at = ?, approved_by = ?, approval_hash = ? WHERE id = ?`).run(at, by, hash, pr.id);
      log(pr.id, 'approved', `${by} • Version ${pr.round} • ${req.headers['user-agent']?.slice(0, 80) || ''}`);
      return send(res, 200, { ok: true, hash });
    }
  }
  send(res, 404, { error: 'not found' });
}
function startSession(res, editorId) {
  const t = tok(24); q('INSERT INTO sessions (token, editor_id) VALUES (?,?)').run(t, editorId);
  return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': `el_sess=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 180}` });
}

const server = http.createServer((req, res) => route(req, res).catch(e => {
  if (res.headersSent) return console.error(e);
  if (e.code === 413) return send(res, 413, { error: e.message });
  if (e instanceof SyntaxError) return send(res, 400, { error: 'Galat data' });
  console.error(e); send(res, 500, { error: 'Server error' });
}));
if (require.main === module) server.listen(PORT, () => console.log(`EditLink chal raha hai: http://localhost:${PORT}`));
module.exports = { server, db, money, unlocked };
