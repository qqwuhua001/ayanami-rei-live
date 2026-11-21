import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { ROOT, settings, loadSettings, savePatch, publicSettings } from './settings.mjs';
import { loadBank, all as allLines, pick, toggle, edit, remove, add } from './lines.mjs';
import { synthesize } from './speech.mjs';
import { reply, tidy } from './mind.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.ico': 'image/x-icon' };

const stream = new Set();
const events = [];
const stats = { comments: 0, said: 0, sessions: 0, startedAt: Date.now() };
let lastCommentAt = 0;
let lastSayAt = 0;

function push(type, payload = {}) {
  const event = { type, at: Date.now(), ...payload };
  events.push(event);
  if (events.length > 160) events.shift();
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of stream) res.write(line);
  return event;
}

function snapshot() {
  return {
    ok: true,
    now: Date.now(),
    stats,
    settings: publicSettings(),
    lines: { total: allLines().length, on: allLines().filter((l) => !l.off).length },
    read: readState(),
  };
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

async function body(req, limit = 512 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/* ---------- 朗读 ---------- */

const read = { queue: [], index: 0, total: 0, running: false, timer: null, title: '', startedAt: 0 };

function readState() {
  return { running: read.running, index: read.index, total: read.total, title: read.title };
}

function chunkText(raw, min = 90, max = 110) {
  const text = String(raw).replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  const sentences = text.split(/(?<=[。！？；\n])/).filter(Boolean);
  const chunks = [];
  let buf = '';
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (buf.length + piece.length <= max) {
      buf += piece;
      continue;
    }
    if (buf.length >= min) {
      chunks.push(buf);
      buf = piece;
    } else {
      buf += piece;
      if (buf.length >= min) {
        chunks.push(buf);
        buf = '';
      }
    }
    while (buf.length > max) {
      chunks.push(buf.slice(0, max));
      buf = buf.slice(max);
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter((c) => c.length > 1);
}

function stopRead(reason = 'stop') {
  if (read.timer) clearTimeout(read.timer);
  read.timer = null;
  read.queue = [];
  read.running = false;
  read.index = 0;
  read.total = 0;
  read.title = '';
  push('read', { running: false, reason });
}

async function speakChunk(text, meta = {}) {
  const voice = await synthesize(text);
  stats.said += 1;
  lastSayAt = Date.now();
  push('say', { text, voice: voice?.url || '', cached: !!voice?.cached, ms: voice?.ms || 0, ...meta });
  return voice;
}

async function pumpRead() {
  if (!read.running) return;
  const index = read.index;
  if (index >= read.queue.length) {
    read.timer = setTimeout(() => {
      stopRead('done');
      push('caption', { text: '', author: '绫波丽', clear: true });
    }, 2500);
    return;
  }
  const chunk = read.queue[index];
  await speakChunk(chunk, { read: true, index: index + 1, total: read.queue.length });
  read.index += 1;
  push('read', { running: true, index: read.index, total: read.queue.length, title: read.title });
  /* 每读一段长文，停两秒让她换口气。 */
  const hold = settings().read.holdEvery || 8;
  if (read.index % hold === 0) await new Promise((r) => setTimeout(r, 2000));
  pumpRead();
}

function startRead(text, title) {
  const limit = settings().read.maxChars;
  const clean = String(text || '').trim();
  if (!clean) return { error: 'empty' };
  if (clean.length > limit) return { error: `超过 ${limit} 字上限` };
  if (read.running) stopRead('restart');
  const chunks = chunkText(clean, settings().read.chunkMin, settings().read.chunkMax);
  read.queue = chunks;
  read.index = 0;
  read.total = chunks.length;
  read.title = String(title || '').slice(0, 60);
  read.running = true;
  read.startedAt = Date.now();
  push('read', { running: true, index: 0, total: chunks.length, title: read.title });
  pumpRead();
  return { ok: true, total: chunks.length, running: true };
}

/* ---------- 说话与评论 ---------- */

async function say(text, meta = {}) {
  const clean = tidy(text) || text;
  if (!clean) return null;
  return speakChunk(clean, meta);
}

async function intro() {
  const lines = ['我是绫波丽。', '坐着画画。你想看就待一会儿。', '想让我知道你在，留句话，我会念到你的名字。'];
  for (const line of lines) {
    await say(line, { intro: true });
    await new Promise((r) => setTimeout(r, 900));
  }
  return lines.length;
}

let replyBusy = false;

async function onComment(user, text) {
  stats.comments += 1;
  lastCommentAt = Date.now();
  push('viewer', { user, text });
  if (replyBusy) return;
  replyBusy = true;
  try {
    const answer = (await reply(text, user)) || `${user}，看见了。`;
    if (answer) {
      await new Promise((r) => setTimeout(r, 600));
      await say(answer, { to: user });
    }
  } finally {
    setTimeout(() => { replyBusy = false; }, settings().model.gapMs || 4000);
  }
}

/* ---------- 定时自语 ---------- */

function tick() {
  const rhythm = settings().rhythm;
  const perHour = Math.max(1, rhythm.linesPerHour || 120);
  const interval = Math.max(8000, Math.round(3600_000 / perHour));
  const now = Date.now();
  if (now - lastCommentAt < (rhythm.quietAfterCommentSec || 8) * 1000) return;
  if (read.running) return;
  if (now - lastSayAt > interval) {
    const line = pick();
    if (line) say(line.text, { idle: true });
  }
}
setInterval(tick, 5000);

/* ---------- 路由 ---------- */

const SHARED = /^(assets\/|voices\/cache\/|preview[\w-]*\.(png|jpg)$)/;

async function staticFile(res, pathname) {
  const safe = normalize(pathname).replace(/^\/+/, '');
  if (safe.includes('..')) return false;
  /* 只对外开页面、素材和合成缓存，源码、配置、台词库不外露。 */
  const candidates = SHARED.test(safe) ? [join(ROOT, safe)] : [join(ROOT, 'web', safe)];
  for (const file of candidates) {
    if (existsSync(file)) {
      const info = await stat(file).catch(() => null);
      if (!info || info.isDirectory()) continue;
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      createReadStream(file).pipe(res);
      return true;
    }
  }
  return false;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  try {
    if (req.method === 'GET' && path === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', state: snapshot() })}\n\n`);
      stream.add(res);
      req.on('close', () => stream.delete(res));
      return;
    }

    if (req.method === 'GET' && path === '/state') return json(res, 200, snapshot());

    if (req.method === 'GET' && path === '/lines') return json(res, 200, { ok: true, lines: allLines() });

    if (req.method === 'POST' && path === '/lines/toggle') {
      const { id, off } = await body(req);
      const item = toggle(id, !!off);
      return item ? json(res, 200, { ok: true, line: item }) : json(res, 404, { ok: false, error: '没有这句' });
    }

    if (req.method === 'POST' && path === '/lines/edit') {
      const { id, text } = await body(req);
      const result = edit(id, String(text || ''));
      if (!result) return json(res, 404, { ok: false, error: '没有这句' });
      if (result.error === 'dup') return json(res, 409, { ok: false, error: '已经有一样的句子' });
      if (result.error === 'empty') return json(res, 400, { ok: false, error: '不能为空' });
      return json(res, 200, { ok: true, line: result });
    }

    if (req.method === 'POST' && path === '/lines/remove') {
      const { id } = await body(req);
      return remove(id) ? json(res, 200, { ok: true }) : json(res, 404, { ok: false, error: '没有这句' });
    }

    if (req.method === 'POST' && path === '/lines/add') {
      const { text, cat } = await body(req);
      const item = add(text, cat || 'plain');
      return item ? json(res, 200, { ok: true, line: item }) : json(res, 409, { ok: false, error: '重复或为空' });
    }

    if (req.method === 'POST' && path === '/lines/say') {
      const { id } = await body(req);
      const item = allLines().find((l) => l.id === id);
      if (!item) return json(res, 404, { ok: false, error: '没有这句' });
      await say(item.text, { manual: true });
      return json(res, 200, { ok: true, text: item.text });
    }

    if (req.method === 'POST' && path === '/say') {
      const { text } = await body(req);
      if (!text) return json(res, 400, { ok: false, error: '空的' });
      const voice = await say(text);
      return json(res, 200, { ok: true, voice: voice?.url || '', ms: voice?.ms || 0 });
    }

    if (req.method === 'POST' && path === '/intro') {
      const count = await intro();
      return json(res, 200, { ok: true, said: count });
    }

    if (req.method === 'POST' && path === '/read/start') {
      const { text, title } = await body(req);
      const result = startRead(text, title);
      return result.error ? json(res, 400, result) : json(res, 200, result);
    }

    if (req.method === 'POST' && path === '/read/stop') {
      stopRead('manual');
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && path === '/read/state') return json(res, 200, readState());

    if (req.method === 'POST' && path === '/feed/comment') {
      const { user, text } = await body(req);
      if (!text) return json(res, 400, { ok: false, error: '空的' });
      onComment(String(user || '观众').slice(0, 20), String(text).slice(0, 200));
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && path === '/settings') return json(res, 200, { ok: true, settings: publicSettings() });

    if (req.method === 'POST' && path === '/settings') {
      const patch = await body(req);
      savePatch(patch);
      push('settings', { settings: publicSettings() });
      return json(res, 200, { ok: true, settings: publicSettings() });
    }

    if (path === '/panel' || path === '/panel/') {
      const html = await readFile(join(ROOT, 'web', 'panel.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (await staticFile(res, path === '/' ? '/index.html' : path)) return;

    json(res, 404, { ok: false, error: 'not found' });
  } catch (error) {
    console.error('[http]', error);
    if (!res.headersSent) json(res, 500, { ok: false, error: error.message });
  }
});

process.on('unhandledRejection', (error) => console.error('[unhandled]', error));
process.on('uncaughtException', (error) => console.error('[uncaught]', error));

loadSettings();
loadBank();
mkdirSync(join(ROOT, 'data'), { recursive: true });
mkdirSync(join(ROOT, 'voices', 'cache'), { recursive: true });

const port = settings().port;
server.listen(port, () => {
  console.log(`绫波丽直播间: http://127.0.0.1:${port}/  控制台 /panel`);
  push('boot', { port });
});
