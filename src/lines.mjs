import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './settings.mjs';

const FILE = join(ROOT, 'data', 'lines.json');
const SEED = join(ROOT, 'data', 'lines.seed.json');

let bank = [];

export function idOf(item) {
  return createHash('sha1').update(`${item.cat || 'plain'}|${item.text}`).digest('hex').slice(0, 10);
}

function readBank() {
  const source = existsSync(FILE) ? FILE : SEED;
  if (!existsSync(source)) return [];
  const raw = JSON.parse(readFileSync(source, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.lines || [];
  return list.map((item) => ({ cat: item.cat || 'plain', text: item.text, off: item.off === true, id: idOf(item) }));
}

export function loadBank() {
  bank = readBank();
  return bank;
}

function persist() {
  const body = { version: 2, note: '她的台词库：cat 分类，off 关闭，id 由内容决定', lines: bank.map(({ cat, text, off }) => (off ? { cat, text, off } : { cat, text })) };
  writeFileSync(FILE, JSON.stringify(body, null, 2));
}

export function all() {
  return bank;
}

export function active() {
  return bank.filter((l) => !l.off);
}

let tail = [];

export function pick(cat) {
  const pool = active().filter((l) => !cat || l.cat === cat);
  const fresh = pool.filter((l) => !tail.includes(l.text));
  const list = fresh.length ? fresh : pool;
  if (!list.length) return null;
  const line = list[Math.floor(Math.random() * list.length)];
  tail.push(line.text);
  tail = tail.slice(-9);
  return line;
}

export function toggle(id, off) {
  const item = bank.find((l) => l.id === id);
  if (!item) return null;
  item.off = off;
  persist();
  return item;
}

export function edit(id, text) {
  const item = bank.find((l) => l.id === id);
  if (!item) return null;
  const next = text.trim().slice(0, 300);
  if (!next) return { error: 'empty' };
  if (bank.some((l, i) => l !== item && l.text === next)) return { error: 'dup' };
  item.text = next;
  item.id = idOf(item);
  persist();
  return item;
}

export function remove(id) {
  const index = bank.findIndex((l) => l.id === id);
  if (index < 0) return false;
  bank.splice(index, 1);
  persist();
  return true;
}

export function add(text, cat = 'plain') {
  const clean = text.trim().slice(0, 300);
  if (!clean || bank.some((l) => l.text === clean)) return null;
  const item = { cat, text: clean, off: false };
  item.id = idOf(item);
  bank.push(item);
  persist();
  return item;
}
