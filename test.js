// quick smoke test: node test.js
process.env.DATA_DIR = require('fs').mkdtempSync(require('os').tmpdir() + '/el-');
const { server } = require('./server');
server.listen(0, async () => {
  const b = `http://localhost:${server.address().port}`;
  const j = (u, o = {}) => fetch(b + u, { headers: { 'Content-Type': 'application/json' }, ...o }).then(async r => [r.status, await r.json()]);
  const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1) } console.log('ok', m) };
  let [s, p] = await j('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'Test', video_url: 'https://youtu.be/dQw4w9WgXcQ', free_rounds: 1, extra_round_fee: 300, upi_id: 'a@upi' }) });
  ok(s === 201, 'create');
  [s] = await j(`/api/review/${p.review_token}/comments`, { method: 'POST', body: JSON.stringify({ ts: 42, text: 'logo bada karo' }) }); ok(s === 201, 'comment');
  const v = await fetch(`${b}/api/review/${p.review_token}/voice?ts=10`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.from('fake') }); ok(v.status === 201, 'voice');
  let [, e] = await j(`/api/editor/${p.editor_token}`); ok(e.comments.length === 2, 'editor sees comments');
  ok((await fetch(`${b}/audio/${e.comments.find(c => c.audio_file).audio_file}`)).status === 200, 'audio served');
  [s] = await j(`/api/editor/${p.editor_token}/new-version`, { method: 'POST', body: '{}' }); ok(s === 200, 'new round');
  let [, r] = await j(`/api/review/${p.review_token}`); ok(r.project.amount_due === 300 && !r.project.editor_token && r.comments.length === 0, 'paid round + token hidden');
  [s] = await j(`/api/review/${p.review_token}/approve`, { method: 'POST' }); ok(s === 200, 'approve');
  [s] = await j(`/api/review/${p.review_token}/comments`, { method: 'POST', body: JSON.stringify({ text: 'x' }) }); ok(s === 409, 'locked after approve');
  [, r] = await j(`/api/editor/${p.editor_token}/tasks`); ok(r.tasks.length === 0 || r.source, 'tasks');
  for (const u of ['/', '/r/x', '/e/x', '/static/style.css', '/static/common.js']) ok((await fetch(b + u)).status === 200, 'page ' + u);
  console.log('ALL PASS'); server.close();
});
