import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, settings } from './settings.mjs';

const CACHE = join(ROOT, 'voices', 'cache');
mkdirSync(CACHE, { recursive: true });

const pending = new Map();

function hashOf(text) {
  return createHash('sha1').update(`rei|${text}`).digest('hex').slice(0, 16);
}

export function voiceUrl(file) {
  return `/voices/cache/${file}`;
}

async function callWorker(text, outPath) {
  const cfg = settings().speech;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 30000);
  try {
    const res = await fetch(new URL('/synth', cfg.worker), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, out: outPath }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`worker ${res.status}`);
    await res.json();
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesize(text) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  if (!settings().speech.enabled) return null;

  const file = `${hashOf(clean)}.wav`;
  const path = join(CACHE, file);
  if (existsSync(path) && statSync(path).size > 2048) {
    return { url: voiceUrl(file), file, cached: true, ms: 0 };
  }
  if (pending.has(file)) return pending.get(file);

  const task = (async () => {
    const started = Date.now();
    try {
      await callWorker(clean, path);
      if (!existsSync(path)) return null;
      return { url: voiceUrl(file), file, cached: false, ms: Date.now() - started };
    } catch (error) {
      console.warn('[speech]', error.message);
      return null;
    } finally {
      pending.delete(file);
    }
  })();

  pending.set(file, task);
  return task;
}
