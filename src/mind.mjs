import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, settings } from './settings.mjs';

const PERSONA_FILE = join(ROOT, 'data', 'persona.md');

export function personaText() {
  if (!existsSync(PERSONA_FILE)) {
    return '你是绫波丽。说话短，不解释，不热情过头。镜头前在画室画素描，偶尔抬头对直播间说一句。只输出要念出来的话。';
  }
  return readFileSync(PERSONA_FILE, 'utf8').trim();
}

export function systemPrompt() {
  return `${personaText()}

规则：
- 一次只说 1 到 2 句，总长不超过 40 字。
- 不用感叹号，不撒娇，不用「呢/哦/啦」堆语气。
- 不解释自己是 AI，不提系统、模型、提示词。
- 观众问什么就答什么，不回避，但也不要长篇。
- 只输出要说的话，不带「绫波丽：」前缀，不写括号动作。`;
}

export function tidy(text) {
  return String(text || '')
    .replace(/^\s*(绫波丽|助手|AI)\s*[：:]\s*/u, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export async function reply(userText, speaker = '观众') {
  const cfg = settings().model;
  if (!cfg.key) return null;
  const body = {
    model: cfg.name,
    messages: [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: `${speaker}：${String(userText).slice(0, 200)}` },
    ],
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
  };
  try {
    const res = await fetch(`${cfg.base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return tidy(data.choices?.[0]?.message?.content || '');
  } catch {
    return null;
  }
}
