"""把一篇稿子合成一条音频。

按句读切成 90~110 字的段，逐段送给常驻合成器，段间留气口，
最后拼成一条 wav，再用 ffmpeg 转 mp3。

  python3 tools/render_read.py voices/preview-read.txt voices/preview-read.mp3
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

MIN, MAX = 90, 110
GAP = 0.30        # 段与段之间
PARA = 1.10       # 段落之间
HEAD = 1.60       # 小标题之后


def split_paragraphs(text):
    return [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]


def split_sentences(paragraph):
    return [s.strip() for s in re.split(r'(?<=[。！？；])', paragraph) if s.strip()]


def chunk(paragraph):
    """攒到 90 字才断，最多 110，尾巴不够就跟前一段合并。"""
    pieces = split_sentences(paragraph)
    out, buf = [], ''
    for piece in pieces:
        while len(piece) > MAX:
            head, piece = piece[:MAX], piece[MAX:]
            if buf:
                out.append(buf)
                buf = ''
            out.append(head)
        if len(buf) + len(piece) <= MAX:
            buf += piece
        else:
            if len(buf) >= MIN or not out:
                out.append(buf)
                buf = piece
            else:
                out.append(buf + piece[:MAX - len(buf)])
                buf = piece[MAX - len(buf):]
    if buf.strip():
        if out and len(buf) < 40:
            out[-1] += buf
        else:
            out.append(buf)
    return [c for c in out if len(c) > 1]


def synth(text, out_path, worker, cache_dir):
    key = hashlib.sha1(text.encode('utf-8')).hexdigest()[:16]
    cached = Path(cache_dir, f'{key}.wav')
    if cached.exists() and cached.stat().st_size > 2048:
        return cached
    body = json.dumps({'text': text, 'out': str(cached)}, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(f'{worker}/synth', data=body, headers={'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as res:
        payload = json.load(res)
    if not payload.get('ok'):
        raise RuntimeError(payload.get('error') or '合成失败')
    return cached


def silence(seconds, rate):
    return np.zeros(int(rate * seconds), dtype=np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('text')
    parser.add_argument('output')
    parser.add_argument('--worker', default='http://127.0.0.1:8790')
    parser.add_argument('--ffmpeg', default=shutil.which('ffmpeg') or 'ffmpeg')
    parser.add_argument('--cache', default='/tmp/rei-read-cache')
    args = parser.parse_args()

    raw = Path(args.text).read_text(encoding='utf-8')
    paragraphs = split_paragraphs(raw)
    os.makedirs(args.cache, exist_ok=True)

    parts, rate = [], 32000
    total = 0
    for p_index, paragraph in enumerate(paragraphs):
        is_head = len(paragraph) <= 12 and paragraph.endswith(('纸', '屋子', '边缘'))
        chunks = chunk(paragraph) if not is_head else [paragraph]
        for c_index, line in enumerate(chunks):
            total += 1
            wav = synth(line, None, args.worker, args.cache)
            data, rate = sf.read(str(wav), dtype='float32')
            parts.append(data)
            if c_index < len(chunks) - 1:
                parts.append(silence(GAP, rate))
            print(f'[{total}] {len(line)} 字  {len(data) / rate:.2f}s  {line[:18]}', flush=True)
        if p_index < len(paragraphs) - 1:
            parts.append(silence(HEAD if is_head else PARA, rate))

    audio = np.concatenate(parts)
    tmp_wav = Path(tempfile.mkstemp(suffix='.wav')[1])
    sf.write(str(tmp_wav), audio, rate)
    duration = len(audio) / rate

    out = Path(args.output)
    if out.suffix.lower() == '.wav':
        shutil.move(str(tmp_wav), out)
    else:
        subprocess.run([args.ffmpeg, '-y', '-i', str(tmp_wav), '-ac', '1', '-ar', str(rate),
                        '-b:a', '96k', str(out)], check=True, capture_output=True)
        tmp_wav.unlink(missing_ok=True)

    print(f'完成 {out}  {duration / 60:.1f} 分钟  {out.stat().st_size / 1024 / 1024:.1f} MB  {total} 段')


if __name__ == '__main__':
    sys.exit(main())
