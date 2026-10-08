// 잿빛 심연 서버: 게임 파일을 보여 주고, 참여자 진행 보고와 관리자 선물을 주고받는다.
// 의존성 없음 (Node 18 이상). 데이터는 data/data.json 에 저장하고,
// GH_TOKEN 과 GH_REPO 가 있으면 GitHub 저장소의 data 브랜치에 백업해서 서버가 다시 켜져도 남게 한다.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const GH_TOKEN = process.env.GH_TOKEN || '', GH_REPO = process.env.GH_REPO || '', GH_BRANCH = process.env.GH_BRANCH || 'data';
const PUB = path.join(__dirname, 'public'), DATA_DIR = path.join(__dirname, 'data'), DATA_FILE = path.join(DATA_DIR, 'data.json');
let DB = { players: {}, gifts: {}, codes: {}, notices: [], mail: {}, inbox: [], blocked: {} }, dirty = false, ghSha = null;

function loadLocal() { try { DB = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); DB.players ||= {}; DB.gifts ||= {}; DB.codes ||= {}; DB.notices ||= []; DB.mail ||= {}; DB.inbox ||= []; DB.blocked ||= {}; } catch (e) {} }
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
    const d = JSON.parse(dec(txt)); DB = { players: d.players || {}, gifts: d.gifts || {}, codes: d.codes || {}, notices: d.notices || [], mail: d.mail || {}, inbox: d.inbox || [], blocked: d.blocked || {} }; saveLocal();
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
/* 선물 코드: 32글자 12자리 무작위(60비트). 틀린 시도는 10분에 모험가마다 8번, 같은 인터넷(학교 등)마다 40번까지 */
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { let c; do { c = Array.from({ length: 12 }, () => CODE_ABC[crypto.randomInt(32)]).join(''); } while (DB.codes[c]); return c; }
const fmtCode = c => c.replace(/(.{4})(?=.)/g, '$1-');
const FAILS = new Map();
function tooMany(k, lim) { const f = FAILS.get(k); if (!f) return false; if (Date.now() - f.t > 600000) { FAILS.delete(k); return false; } return f.n >= lim; }
function fail(ip) { const f = FAILS.get(ip); if (!f || Date.now() - f.t > 600000) FAILS.set(ip, { n: 1, t: Date.now() }); else f.n++; }
const rid = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const clean = (t, n) => String(t || '').replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim().slice(0, n);
const SENT = new Map();
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
    /* 참여자: 선물 코드 쓰기 */
    if (P === '/api/redeem' && req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const b = await body(req), who = 'p:' + String(b.pid || '').slice(0, 32);
      if (tooMany('i:' + ip, 40) || tooMany(who, 8)) return send(res, 429, { error: '잠시 뒤 다시 입력해 주세요' }); if (!playerOk(b.pid, b.psec)) { fail('i:' + ip); fail(who); return send(res, 200, { error: '먼저 게임을 저장해 주세요' }); }
      const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), c = DB.codes[code];
      if (!c) { fail('i:' + ip); fail(who); return send(res, 200, { error: '올바르지 않은 코드예요' }); }
      if (c.to !== b.pid) { fail('i:' + ip); fail(who); return send(res, 200, { error: '다른 모험가에게 보낸 코드예요' }); }
      if (c.used) return send(res, 200, { error: '이미 쓴 코드예요' });
      c.used = Date.now(); changed(); return send(res, 200, { gift: c.g });
    }
    /* 참여자: 우편함 (공지 · 관리자 우편 · 첨부 받기 · 관리자에게 보내기) */
    if (P === '/api/mail' && req.method === 'POST') {
      const b = await body(req), ok = playerOk(b.pid, b.psec);
      return send(res, 200, { notices: DB.notices.slice(-30), mail: ok ? (DB.mail[b.pid] || []).slice(-60) : [], sent: ok ? DB.inbox.filter(m => m.pid === b.pid).slice(-10).map(m => ({ id: m.id, t: m.t, text: m.text })) : [], blocked: ok ? !!DB.blocked[b.pid] : false });
    }
    if (P === '/api/mail/claim' && req.method === 'POST') {
      const b = await body(req); if (!playerOk(b.pid, b.psec)) return send(res, 403, { error: '먼저 게임을 저장해 주세요' });
      const m = (DB.mail[b.pid] || []).find(x => x.id === b.id); if (!m || !m.g) return send(res, 200, { error: '받을 것이 없어요' });
      if (m.claimed) return send(res, 200, { error: '이미 받았어요' });
      m.claimed = Date.now(); changed(); return send(res, 200, { gift: m.g });
    }
    if (P === '/api/mail/send' && req.method === 'POST') {
      const b = await body(req); if (!playerOk(b.pid, b.psec)) return send(res, 403, { error: '먼저 게임을 저장해 주세요' });
      if (DB.blocked[b.pid]) return send(res, 200, { error: '관리자에게 메시지를 보낼 수 없어요' });
      const text = clean(b.text, 300); if (!text) return send(res, 200, { error: '내용을 적어 주세요' });
      const last = SENT.get(b.pid) || 0; if (Date.now() - last < 10000) return send(res, 200, { error: '잠시 뒤 다시 보내 주세요' });
      SENT.set(b.pid, Date.now());
      DB.inbox.push({ id: rid(), t: Date.now(), pid: b.pid, name: (DB.players[b.pid].report || {}).name || '', text, read: 0 }); if (DB.inbox.length > 1000) DB.inbox = DB.inbox.slice(-1000);
      changed(); return send(res, 200, { ok: 1 });
    }
    /* 관리자 */
    if (P.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'admin' });
      if (P === '/api/admin/players') return send(res, 200, { players: Object.values(DB.players).map(p => p.report), codes: Object.entries(DB.codes).map(([k, c]) => ({ code: fmtCode(k), to: c.to, what: c.what, t: c.t, used: c.used || 0 })).sort((a, b) => b.t - a.t).slice(0, 200) });
      if (P === '/api/admin/gift' && req.method === 'POST') {
        const b = await body(req), g = b.gift || {};
        if (!okId(g.to) || !DB.players[g.to] || typeof g.gid !== 'string') return send(res, 400, { error: 'bad' });
        const code = newCode(); DB.codes[code] = { g, to: g.to, what: String(b.what || '').slice(0, 80), t: Date.now(), used: 0 }; changed();
        return send(res, 200, { ok: 1, code: fmtCode(code) });
      }
      if (P === '/api/admin/inbox') return send(res, 200, { inbox: DB.inbox.slice(-300), blocked: Object.keys(DB.blocked), notices: DB.notices.slice(-30) });
      if (P === '/api/admin/inbox/read' && req.method === 'POST') { const b = await body(req), ids = new Set(b.ids || []); for (const m of DB.inbox) if (b.all || ids.has(m.id)) m.read = 1; changed(); return send(res, 200, { ok: 1 }); }
      if (P === '/api/admin/notice' && req.method === 'POST') { const b = await body(req), text = clean(b.text, 500); if (!text) return send(res, 400, { error: 'empty' }); DB.notices.push({ id: rid(), t: Date.now(), text, notice: 1 }); if (DB.notices.length > 50) DB.notices = DB.notices.slice(-50); changed(); return send(res, 200, { ok: 1 }); }
      if (P === '/api/admin/notice/delete' && req.method === 'POST') { const b = await body(req); DB.notices = DB.notices.filter(n => n.id !== b.id); changed(); return send(res, 200, { ok: 1 }); }
      if (P === '/api/admin/mail' && req.method === 'POST') {
        const b = await body(req), text = clean(b.text, 500), g = b.gift && typeof b.gift === 'object' ? b.gift : null;
        if (!text && !g) return send(res, 400, { error: 'empty' });
        const to = b.to === 'all' ? Object.keys(DB.players) : (DB.players[b.to] ? [b.to] : []);
        if (!to.length) return send(res, 400, { error: 'no player' });
        for (const pid of to) { const box = (DB.mail[pid] ||= []); box.push({ id: rid(), t: Date.now(), text, what: clean(b.what, 80), g: g ? { ...g, gid: rid(), to: pid } : null, claimed: 0 }); if (box.length > 100) DB.mail[pid] = box.slice(-100); }
        changed(); return send(res, 200, { ok: 1, n: to.length });
      }
      if (P === '/api/admin/block' && req.method === 'POST') { const b = await body(req); if (b.on) DB.blocked[b.pid] = Date.now(); else delete DB.blocked[b.pid]; changed(); return send(res, 200, { ok: 1 }); }
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
