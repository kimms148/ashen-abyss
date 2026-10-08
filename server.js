// 잿빛 심연 서버: 게임 파일을 보여 주고, 참여자 진행 보고와 관리자 선물을 주고받는다.
// 의존성 없음 (Node 18 이상). 데이터는 data/data.json 에 저장하고,
// GH_TOKEN 과 GH_REPO 가 있으면 GitHub 저장소의 data 브랜치에 백업해서 서버가 다시 켜져도 남게 한다.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const GH_TOKEN = process.env.GH_TOKEN || '', GH_REPO = process.env.GH_REPO || '', GH_BRANCH = process.env.GH_BRANCH || 'data';
const PUB = path.join(__dirname, 'public'), DATA_DIR = path.join(__dirname, 'data'), DATA_FILE = path.join(DATA_DIR, 'data.json');
let DB = { players: {}, gifts: {} }, dirty = false, ghSha = null;

function loadLocal() { try { DB = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); DB.players ||= {}; DB.gifts ||= {}; } catch (e) {} }
function saveLocal() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(DB)); } catch (e) { console.error('save', e.message); } }

/* ---------- GitHub 백업 (공개 저장소여도 남이 못 읽게 ADMIN_KEY로 암호화) ---------- */
const encKey = () => crypto.scryptSync(ADMIN_KEY || 'ashen-abyss', 'ashen-abyss-backup', 32);
function enc(txt) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encKey(), iv), d = Buffer.concat([c.update(txt, 'utf8'), c.final()]); return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), d: d.toString('base64') }); }
function dec(txt) { const o = JSON.parse(txt); if (!o.iv) return txt; const c = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(o.iv, 'base64')); c.setAuthTag(Buffer.from(o.tag, 'base64')); return Buffer.concat([c.update(Buffer.from(o.d, 'base64')), c.final()]).toString('utf8'); }
const gh = (p, opt = {}) => fetch('https://api.github.com/repos/' + GH_REPO + p, { ...opt, headers: { Authorization: 'Bearer ' + GH_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'ashen-abyss', ...(opt.headers || {}) } });
async function ghEnsureBranch() {
  const r = await gh('/git/ref/heads/' + GH_BRANCH); if (r.ok) return;
  const repo = await (await gh('')).json(), base = await (await gh('/git/ref/heads/' + repo.default_branch)).json();
  await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + GH_BRANCH, sha: base.object.sha }) });
}
async function ghLoad() {
  if (!GH_TOKEN || !GH_REPO) return;
  try {
    await ghEnsureBranch();
    const r = await gh('/contents/data.json?ref=' + GH_BRANCH);
    if (!r.ok) return;
    const j = await r.json(); ghSha = j.sha;
    let txt = Buffer.from(j.content || '', 'base64').toString('utf8');
    if (!txt && j.download_url) txt = await (await fetch(j.download_url, { headers: { Authorization: 'Bearer ' + GH_TOKEN } })).text();
    const d = JSON.parse(dec(txt)); DB = { players: d.players || {}, gifts: d.gifts || {} }; saveLocal();
    console.log('GitHub 백업에서 불러옴:', Object.keys(DB.players).length, '명');
  } catch (e) { console.error('ghLoad', e.message); }
}
async function ghSave() {
  if (!GH_TOKEN || !GH_REPO || !dirty) return; dirty = false;
  try {
    const body = { message: '진행 보고 백업 ' + new Date().toISOString(), branch: GH_BRANCH, content: Buffer.from(enc(JSON.stringify(DB))).toString('base64') };
    if (ghSha) body.sha = ghSha;
    let r = await gh('/contents/data.json', { method: 'PUT', body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) { const g = await gh('/contents/data.json?ref=' + GH_BRANCH); if (g.ok) { body.sha = (await g.json()).sha; r = await gh('/contents/data.json', { method: 'PUT', body: JSON.stringify(body) }); } }
    if (r.ok) ghSha = (await r.json()).content.sha; else { dirty = true; console.error('ghSave', r.status, await r.text()); }
  } catch (e) { dirty = true; console.error('ghSave', e.message); }
}
setInterval(ghSave, 60 * 1000);
function changed() { dirty = true; saveLocal(); }

/* ---------- 도우미 ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
function send(res, code, obj) { const b = typeof obj === 'string' ? obj : JSON.stringify(obj); res.writeHead(code, { 'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store' }); res.end(b); }
function body(req) { return new Promise((ok, no) => { let n = 0, c = []; req.on('data', d => { n += d.length; if (n > 2e6) { no(new Error('too big')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { ok(JSON.parse(Buffer.concat(c).toString('utf8') || '{}')); } catch (e) { no(e); } }); req.on('error', no); }); }
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const isAdmin = req => ADMIN_KEY && safeEq(req.headers['x-admin-key'] || '', ADMIN_KEY);
const okId = s => typeof s === 'string' && /^[a-z0-9]{6,32}$/.test(s);
const okSec = s => typeof s === 'string' && /^[a-z0-9]{12,64}$/.test(s);
function playerOk(pid, psec) { const p = DB.players[pid]; return p && safeEq(p.psec, psec); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), P = u.pathname;
  try {
    if (P === '/ping') return send(res, 200, 'ok');
    if (P === '/api/ping') return send(res, 200, { ok: 1, admin: !!ADMIN_KEY });
    /* 참여자: 진행 보고 (처음 보고할 때 비밀 열쇠가 등록되고, 그 뒤로는 같은 열쇠로만 고칠 수 있다) */
    if (P === '/api/report' && req.method === 'POST') {
      const b = await body(req); const r = b.report || {};
      if (!okId(b.pid) || !okSec(b.psec) || typeof r !== 'object') return send(res, 400, { error: 'bad' });
      const cur = DB.players[b.pid]; if (cur && !safeEq(cur.psec, b.psec)) return send(res, 403, { error: 'key' });
      r.pid = b.pid; r.t = Date.now(); r.net = 1; DB.players[b.pid] = { psec: b.psec, report: r }; changed();
      return send(res, 200, { ok: 1 });
    }
    /* 참여자: 나에게 온 선물 */
    if (P === '/api/gifts' && req.method === 'POST') {
      const b = await body(req); if (!playerOk(b.pid, b.psec)) return send(res, 200, { gifts: [] });
      return send(res, 200, { gifts: DB.gifts[b.pid] || [] });
    }
    if (P === '/api/claim' && req.method === 'POST') {
      const b = await body(req); if (!playerOk(b.pid, b.psec)) return send(res, 403, { error: 'key' });
      DB.gifts[b.pid] = (DB.gifts[b.pid] || []).filter(g => g.gid !== b.gid); changed(); return send(res, 200, { ok: 1 });
    }
    /* 관리자 */
    if (P.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'admin' });
      if (P === '/api/admin/players') return send(res, 200, { players: Object.values(DB.players).map(p => p.report), pending: Object.fromEntries(Object.entries(DB.gifts).map(([k, v]) => [k, v.length])) });
      if (P === '/api/admin/gift' && req.method === 'POST') {
        const b = await body(req), g = b.gift || {};
        if (!okId(g.to) || !DB.players[g.to] || typeof g.gid !== 'string') return send(res, 400, { error: 'bad' });
        (DB.gifts[g.to] ||= []).push(g); changed(); return send(res, 200, { ok: 1 });
      }
      if (P === '/api/admin/delete' && req.method === 'POST') { const b = await body(req); delete DB.players[b.pid]; delete DB.gifts[b.pid]; changed(); return send(res, 200, { ok: 1 }); }
      return send(res, 404, { error: 'none' });
    }
    /* 파일 */
    let f = P === '/' ? '/index.html' : P === '/admin' ? '/admin.html' : P === '/dex' ? '/dex.html' : P;
    f = path.normalize(decodeURIComponent(f)).replace(/^([/\\])+/, '');
    const fp = path.join(PUB, f); if (!fp.startsWith(PUB)) return send(res, 403, 'no');
    fs.readFile(fp, (e, d) => { if (e) return send(res, 404, '없는 페이지예요'); res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(d); });
  } catch (e) { send(res, 400, { error: String(e.message || e) }); }
});
loadLocal();
ghLoad().finally(() => server.listen(PORT, () => console.log('잿빛 심연 서버 켜짐 :' + PORT + (ADMIN_KEY ? '' : ' (ADMIN_KEY 없음: 관리자 기능 꺼짐)'))));
process.on('SIGTERM', async () => { await ghSave(); process.exit(0); });
