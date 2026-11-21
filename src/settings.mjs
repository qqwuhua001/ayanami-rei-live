import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CONFIG_PATH = join(ROOT, 'config.json');

const DEFAULTS = {
  port: 8788,
  stage: { width: 540, height: 960 },
  model: {
    base: 'https://api.deepseek.com',
    key: '',
    name: 'deepseek-chat',
    temperature: 0.95,
    maxTokens: 180,
    gapMs: 4000,
  },
  speech: {
    enabled: true,
    worker: 'http://127.0.0.1:8790',
    volume: 0.9,
    timeoutMs: 30000,
  },
  rhythm: {
    linesPerHour: 120,
    quietAfterCommentSec: 8,
  },
  read: {
    chunkMin: 90,
    chunkMax: 110,
    maxChars: 120000,
    holdEvery: 8,
  },
};

function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object') {
      out[key] = merge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

let current = DEFAULTS;

export function loadSettings() {
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(ROOT, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));
  }
  try {
    current = merge(DEFAULTS, JSON.parse(readFileSync(CONFIG_PATH, 'utf8')));
  } catch {
    current = DEFAULTS;
  }
  return current;
}

export function settings() {
  return current;
}

export function savePatch(patch) {
  current = merge(current, patch);
  writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2));
  return current;
}

export function publicSettings() {
  return {
    port: current.port,
    model: { ...current.model, key: current.model.key ? '已配置' : '' },
    speech: current.speech,
    rhythm: current.rhythm,
    read: current.read,
  };
}
