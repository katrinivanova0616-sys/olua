// Контент-завод: сайт с чатом, в котором работает Claude (Claude Agent SDK) с инструментами монтажа и ARA.
// Безопасность: вход только по паролю; Claude работает в режиме dontAsk со списком разрешённых инструментов,
// без доступа в интернет через WebFetch/WebSearch, а подтверждения в ARA сервер пропускает только после «да» Кати.
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DATA = path.resolve(process.env.DATA_DIR || path.join(HERE, 'data'));
const WS = path.join(DATA, 'workspace');
const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('zavod:' + PASSWORD).digest('hex');
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const BUDGET = Number(process.env.MONTHLY_BUDGET_USD || 50);
const ARA_URL = process.env.ARA_MCP_URL || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : `http://localhost:${PORT}`)).replace(/\/$/, '');

if (!PASSWORD) console.warn('APP_PASSWORD не задан: вход на сайт невозможен.');

/* ---------- storage ---------- */
for (const d of [DATA, WS, path.join(WS, 'uploads'), path.join(WS, 'ready'), path.join(WS, '.claude', 'skills')]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(path.join(WS, 'CLAUDE.md'))) fs.copyFileSync(path.join(HERE, 'workspace-template', 'CLAUDE.md'), path.join(WS, 'CLAUDE.md'));
if (!fs.existsSync(path.join(WS, 'checklist.md'))) fs.writeFileSync(path.join(WS, 'checklist.md'),
  '# Чек-лист рилсов (цель 30)\n\n1. ✅ Тембр мечты (7 ноября)\n2. ✅ Голос срывается (7 ноября)\n3. ✅ Две схемы для трудных мест (8 ноября)\n4. ✅ Белтинг и мелизмы (8 ноября)\n5. ✅ Мелизмы как распевка (9 ноября)\n');

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { const p = path.join(DATA, f); fs.writeFileSync(p + '.tmp', JSON.stringify(v)); fs.renameSync(p + '.tmp', p); };

const state = readJSON('state.json', { sessionId: null });
const chat = readJSON('chat.json', []);
const usage = readJSON('usage.json', {});
let saveT;
const saveChat = () => { clearTimeout(saveT); saveT = setTimeout(() => writeJSON('chat.json', chat), 300); };
const monthKey = () => new Date().toISOString().slice(0, 7);
const monthUsage = () => usage[monthKey()] || 0;

/* ---------- auth ---------- */
const TOKEN = crypto.createHmac('sha256', SECRET).update('kati').digest('base64url');
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const authed = req => safeEq(cookies(req).z || '', TOKEN);
const requireAuth = (req, res, next) => authed(req) ? next() : res.status(401).json({ error: 'auth' });

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));

app.post('/api/login', async (req, res) => {
  const p = String(req.body?.password || '');
  if (!PASSWORD || !safeEq(p, PASSWORD)) { await new Promise(r => setTimeout(r, 1200)); return res.status(401).json({ error: 'Неверный пароль' }); }
  res.setHeader('Set-Cookie', `z=${TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${PUBLIC_URL.startsWith('https') ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ authed: authed(req) }));

/* ---------- live events (SSE) ---------- */
const clients = new Set();
const broadcast = ev => { const s = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) c.write(s); };
app.get('/api/events', requireAuth, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`data: ${JSON.stringify({ type: 'hello', busy, usage: monthUsage(), budget: BUDGET })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

/* ---------- uploads & files ---------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(WS, 'uploads')),
    filename: (req, file, cb) => {
      const name = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80) || 'file';
      cb(null, `${new Date().toISOString().slice(0, 10)}_${crypto.randomBytes(3).toString('hex')}_${name}`);
    },
  }),
  limits: { fileSize: 4 * 1024 ** 3 },
});
app.post('/api/upload', requireAuth, upload.array('files', 10), (req, res) => {
  res.json({ files: (req.files || []).map(f => ({ path: 'uploads/' + f.filename, name: Buffer.from(f.originalname, 'latin1').toString('utf8'), size: f.size })) });
});
app.use('/files', requireAuth, express.static(WS, { dotfiles: 'deny', index: false }));

/* ---------- chat ---------- */
let busy = false, abort = null, currentUserText = '';
app.get('/api/chat', requireAuth, (req, res) => res.json({ messages: chat.slice(-200), busy, usage: monthUsage(), budget: BUDGET }));

app.post('/api/chat', requireAuth, (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 20000);
  const files = Array.isArray(req.body?.files) ? req.body.files.filter(f => typeof f?.path === 'string' && /^uploads\/[^/]+$/.test(f.path)) : [];
  if (!text && !files.length) return res.status(400).json({ error: 'empty' });
  if (busy) return res.status(409).json({ error: 'Claude ещё отвечает. Подожди или нажми «Стоп».' });
  if (monthUsage() >= BUDGET) return res.status(402).json({ error: `Лимит месяца ${BUDGET} $ исчерпан. Его можно поднять в настройках сервера (MONTHLY_BUDGET_USD).` });
  const msg = { id: crypto.randomUUID(), role: 'user', text, files, ts: Date.now() };
  chat.push(msg); saveChat(); broadcast({ type: 'msg', msg });
  res.json({ ok: true });
  let prompt = text;
  if (files.length) prompt += `\n\n[Кати прикрепила файлы: ${files.map(f => `${f.path} (${String(f.name || '').slice(0, 100)}, ${(Number(f.size) / 1048576 || 0).toFixed(1)} МБ)`).join('; ')}]`;
  runTurn(prompt, text).catch(e => console.error('turn failed', e));
});

app.post('/api/stop', requireAuth, (req, res) => { abort?.abort(); res.json({ ok: true }); });

app.post('/api/new-session', requireAuth, (req, res) => {
  if (busy) return res.status(409).json({ error: 'busy' });
  state.sessionId = null; writeJSON('state.json', state);
  const msg = { id: crypto.randomUUID(), role: 'system', text: 'Начат новый разговор. Claude не помнит прошлую переписку, но правила, чек-лист и файлы на месте.', ts: Date.now() };
  chat.push(msg); saveChat(); broadcast({ type: 'msg', msg });
  res.json({ ok: true });
});

// Claude may use only these tools; anything else is refused without asking (permissionMode "dontAsk").
const ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Skill', 'TodoWrite', 'mcp__ara'];
const DISALLOWED_TOOLS = ['WebFetch', 'WebSearch'];

// ARA confirmations (publishing, paid generations) need Kati's explicit «да» in the message that started this turn.
const CONFIRM_TOOLS = /^mcp__ara__(publisher_confirm|generation_confirm|security_audit_confirm|niche_breakdown_confirm)$/;
const YES = /^\s*(да|yes|ок|ok|окей|подтверждаю|давай)(?![\p{L}])/iu;
const gateHook = async input => {
  if (input.hook_event_name !== 'PreToolUse' || !CONFIRM_TOOLS.test(input.tool_name) || YES.test(currentUserText)) return {};
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: 'Подтверждение в ARA разрешено только после явного «да» Кати в её последнем сообщении. Покажи сводку и спроси её.' } };
};

function toolSummary(name, input) {
  const short = s => String(s ?? '').split(WS + '/').join('').replace(/\s+/g, ' ').slice(0, 120);
  if (name === 'Bash') return { name: 'Команда', detail: short(input.description || input.command) };
  if (name === 'Read') return { name: 'Читаю', detail: short(input.file_path) };
  if (name === 'Write') return { name: 'Пишу файл', detail: short(input.file_path) };
  if (name === 'Edit') return { name: 'Правлю', detail: short(input.file_path) };
  if (name === 'Skill') return { name: 'Скилл', detail: short(input.skill) };
  return { name: name.replace(/^mcp__ara__/, 'ARA · '), detail: '' };
}

async function runTurn(prompt, userText) {
  busy = true; currentUserText = userText; abort = new AbortController();
  broadcast({ type: 'busy', busy });
  const msg = { id: crypto.randomUUID(), role: 'assistant', text: '', tools: [], ts: Date.now() };
  chat.push(msg); broadcast({ type: 'msg', msg });
  const append = t => { msg.text += t; broadcast({ type: 'delta', id: msg.id, text: t }); saveChat(); };
  try {
    const mcpServers = {};
    const ara = await araAuthHeader().catch(e => { console.error('ARA token', e.message); return null; });
    if (ARA_URL && ara) mcpServers.ara = { type: 'http', url: ARA_URL, headers: { Authorization: ara } };
    const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const q = query({
      prompt,
      options: {
        cwd: WS,
        model: MODEL,
        resume: state.sessionId || undefined,
        systemPrompt: { type: 'preset', preset: 'claude_code',
          append: `Ты работаешь в веб-приложении «Контент-завод» для Кати. Сейчас ${now} МСК. Отвечай по-русски. Правила проекта в CLAUDE.md рабочей папки, чек-лист в checklist.md. Файлы показывай ссылками files/...${ara ? '' : ' ARA сейчас не подключён: если нужна выкладка, попроси Кати подключить его в настройках сайта.'}` },
        settingSources: ['project'],
        skills: 'all',
        permissionMode: 'dontAsk',
        allowedTools: ALLOWED_TOOLS,
        disallowedTools: DISALLOWED_TOOLS,
        includePartialMessages: true,
        mcpServers,
        hooks: { PreToolUse: [{ hooks: [gateHook] }] },
        abortController: abort,
        maxBudgetUsd: Math.max(1, BUDGET - monthUsage()),
        env: { ...process.env, PATH: `${path.join(HERE, 'bin')}:${process.env.PATH}` },
      },
    });
    let textOpen = false;
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init' && m.session_id && m.session_id !== state.sessionId) {
        state.sessionId = m.session_id; writeJSON('state.json', state);
      } else if (m.type === 'stream_event' && !m.parent_tool_use_id) {
        const ev = m.event;
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') { if (msg.text && !textOpen) append('\n\n'); textOpen = true; }
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') append(ev.delta.text);
        else if (ev.type === 'content_block_stop') textOpen = false;
      } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
        for (const b of m.message?.content || []) {
          if (b.type === 'tool_use') { const t = toolSummary(b.name, b.input || {}); msg.tools.push(t); broadcast({ type: 'tool', id: msg.id, tool: t }); saveChat(); }
        }
      } else if (m.type === 'result') {
        if (typeof m.total_cost_usd === 'number') {
          usage[monthKey()] = monthUsage() + m.total_cost_usd; writeJSON('usage.json', usage);
          msg.cost = m.total_cost_usd;
        }
        if (m.subtype !== 'success') append(`\n\n_Ход прервался (${m.subtype})._`);
      }
    }
  } catch (e) {
    const aborted = abort?.signal.aborted;
    append(aborted ? '\n\n_Остановлено._' : `\n\n_Ошибка: ${String(e?.message || e).slice(0, 300)}_`);
  } finally {
    busy = false; abort = null; saveChat();
    broadcast({ type: 'done', id: msg.id, cost: msg.cost, usage: monthUsage() });
    broadcast({ type: 'busy', busy });
  }
}

/* ---------- ARA connector (MCP OAuth: discovery, dynamic registration, PKCE) ---------- */
const araStore = () => readJSON('ara.json', {});
async function getJSON(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error(`${r.status} ${new URL(url).pathname}`); return r.json(); }

async function araDiscover() {
  const u = new URL(ARA_URL);
  let asBase = null;
  for (const p of [`/.well-known/oauth-protected-resource${u.pathname.replace(/\/$/, '')}`, '/.well-known/oauth-protected-resource']) {
    try { const j = await getJSON(u.origin + p); if (j.authorization_servers?.[0]) { asBase = j.authorization_servers[0]; break; } } catch {}
  }
  if (!asBase) {
    try {
      const r = await fetch(ARA_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' });
      const m = /resource_metadata="([^"]+)"/.exec(r.headers.get('www-authenticate') || '');
      if (m) { const j = await getJSON(m[1]); asBase = j.authorization_servers?.[0]; }
    } catch {}
  }
  const a = new URL(asBase || u.origin);
  const suffix = a.pathname === '/' ? '' : a.pathname.replace(/\/$/, '');
  for (const p of [`/.well-known/oauth-authorization-server${suffix}`, `/.well-known/openid-configuration${suffix}`, `${suffix}/.well-known/openid-configuration`]) {
    try { const j = await getJSON(a.origin + p); if (j.authorization_endpoint) return j; } catch {}
  }
  throw new Error('ARA не отдаёт настройки входа (OAuth metadata)');
}

const pending = new Map();
app.get('/api/ara/status', requireAuth, (req, res) => {
  const s = araStore();
  res.json({ configured: !!ARA_URL, connected: !!s.access_token, expires_at: s.expires_at || null });
});
app.get('/api/ara/connect', requireAuth, async (req, res) => {
  try {
    if (!ARA_URL) throw new Error('Не задан ARA_MCP_URL в настройках сервера');
    const meta = await araDiscover();
    const redirect = PUBLIC_URL + '/api/ara/callback';
    const s = araStore();
    let client = s.client && s.client.redirect === redirect ? s.client : null;
    if (!client) {
      if (!meta.registration_endpoint) throw new Error('ARA не поддерживает регистрацию сторонних приложений');
      const reg = await getJSON(meta.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        client_name: 'Kontent-zavod', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
      client = { id: reg.client_id, secret: reg.client_secret || null, redirect };
    }
    writeJSON('ara.json', { ...s, client, meta });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const st = crypto.randomBytes(16).toString('base64url');
    pending.set(st, verifier);
    const q = new URLSearchParams({ response_type: 'code', client_id: client.id, redirect_uri: redirect, state: st,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: ARA_URL });
    if (meta.scopes_supported?.length) q.set('scope', meta.scopes_supported.join(' '));
    res.redirect(meta.authorization_endpoint + (meta.authorization_endpoint.includes('?') ? '&' : '?') + q);
  } catch (e) { res.status(500).send(page('Не получилось подключить ARA', e.message)); }
});
app.get('/api/ara/callback', requireAuth, async (req, res) => {
  try {
    const st = String(req.query.state || '');
    const verifier = pending.get(st);
    if (!verifier) throw new Error('Ссылка устарела, попробуй ещё раз');
    pending.delete(st);
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const s = araStore();
    saveToken(s, await tokenRequest(s, { grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: s.client.redirect, code_verifier: verifier }));
    res.redirect('/#settings');
  } catch (e) { res.status(500).send(page('Не получилось подключить ARA', e.message)); }
});
app.post('/api/ara/disconnect', requireAuth, (req, res) => { const s = araStore(); delete s.access_token; delete s.refresh_token; writeJSON('ara.json', s); res.json({ ok: true }); });

async function tokenRequest(s, params) {
  const body = new URLSearchParams({ ...params, client_id: s.client.id, resource: ARA_URL });
  if (s.client.secret) body.set('client_secret', s.client.secret);
  return getJSON(s.meta.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
}
function saveToken(s, tok) {
  writeJSON('ara.json', { ...s, access_token: tok.access_token, refresh_token: tok.refresh_token || s.refresh_token, expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null });
}
async function araAuthHeader() {
  let s = araStore();
  if (!s.access_token) return null;
  if (s.expires_at && s.expires_at < Date.now() + 120000 && s.refresh_token) {
    saveToken(s, await tokenRequest(s, { grant_type: 'refresh_token', refresh_token: s.refresh_token }));
    s = araStore();
  }
  return 'Bearer ' + s.access_token;
}

/* ---------- settings: skills, instructions, library ---------- */
const skillUpload = multer({ dest: path.join(DATA, 'tmp'), limits: { fileSize: 200 * 1024 ** 2 } });
const skillsDir = path.join(WS, '.claude', 'skills');
app.get('/api/skills', requireAuth, (req, res) => {
  res.json({ skills: fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, 'SKILL.md'))).map(d => d.name) });
});
app.post('/api/skills', requireAuth, skillUpload.single('zip'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const tmp = path.join(DATA, 'tmp', 'unz_' + crypto.randomBytes(4).toString('hex'));
  execFile('unzip', ['-o', '-q', req.file.path, '-d', tmp], err => {
    fs.rmSync(req.file.path, { force: true });
    if (err) { fs.rmSync(tmp, { recursive: true, force: true }); return res.status(400).json({ error: 'Не получилось распаковать zip' }); }
    const found = [];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (!e.isDirectory() || e.name === '__MACOSX') continue; const p = path.join(d, e.name); if (fs.existsSync(path.join(p, 'SKILL.md'))) found.push(p); else walk(p); } };
    if (fs.existsSync(path.join(tmp, 'SKILL.md'))) found.push(tmp); else walk(tmp);
    const names = [];
    for (const f of found) {
      const name = (f === tmp ? path.parse(Buffer.from(req.file.originalname, 'latin1').toString('utf8')).name : path.basename(f)).replace(/[^\w.-]/g, '_');
      fs.rmSync(path.join(skillsDir, name), { recursive: true, force: true });
      fs.cpSync(f, path.join(skillsDir, name), { recursive: true });
      names.push(name);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!names.length) return res.status(400).json({ error: 'В архиве нет SKILL.md' });
    res.json({ installed: names });
  });
});
app.get('/api/instructions', requireAuth, (req, res) => res.json({ text: fs.readFileSync(path.join(WS, 'CLAUDE.md'), 'utf8') }));
app.put('/api/instructions', requireAuth, (req, res) => {
  const t = String(req.body?.text || '');
  if (t.length < 20) return res.status(400).json({ error: 'Слишком коротко' });
  fs.writeFileSync(path.join(WS, 'CLAUDE.md'), t); res.json({ ok: true });
});
app.get('/api/library', requireAuth, (req, res) => {
  const list = d => { try { return fs.readdirSync(path.join(WS, d)).filter(n => !n.startsWith('.')).map(n => { const st = fs.statSync(path.join(WS, d, n)); return { path: `${d}/${n}`, size: st.size, mtime: st.mtimeMs }; }).filter(x => x.size).sort((a, b) => b.mtime - a.mtime); } catch { return []; } };
  res.json({ ready: list('ready'), uploads: list('uploads'), checklist: fs.readFileSync(path.join(WS, 'checklist.md'), 'utf8'), usage: monthUsage(), budget: BUDGET });
});

function page(title, text) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><body style="font-family:-apple-system,system-ui,sans-serif;padding:24px;max-width:520px;margin:auto"><h2>${esc(title)}</h2><p>${esc(text)}</p><p><a href="/#settings">Вернуться</a></p>`;
}

app.use(express.static(path.join(HERE, 'public'), { index: 'index.html' }));
app.listen(PORT, () => console.log(`Контент-завод на ${PUBLIC_URL} (порт ${PORT}), данные в ${DATA}`));
