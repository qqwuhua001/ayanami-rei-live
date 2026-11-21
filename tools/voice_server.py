"""绫波丽的语音合成服务。

零样本克隆：不训练，只给一段参考音频。模型在内存里常驻，单句 3~6 秒。
HTTP 只在 127.0.0.1 上监听。

  GET  /health              -> {"ok": true, "loaded": true}
  POST /synth {"text","out"} -> {"ok": true, "ms": 1234}
"""

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOVITS_DIR = os.environ.get('GPT_SOVITS_DIR', os.path.join(HERE, 'GPT-SoVITS'))
os.chdir(SOVITS_DIR)
sys.path.insert(0, SOVITS_DIR)
sys.path.insert(0, os.path.join(SOVITS_DIR, 'GPT_SoVITS'))

from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config  # noqa: E402
import soundfile as sf  # noqa: E402
import numpy as np  # noqa: E402

REF = os.path.join(HERE, 'voices', 'rei_5s.wav')
PROMPT_TEXT = 'あなたは他の人がいないと自分が見えないの'
PORT = int(os.environ.get('REI_VOICE_PORT', '8790'))

PARAMS = {
    'top_k': 10,
    'top_p': 1.0,
    'temperature': 0.8,
    'text_split_method': 'cut2',
    'speed_factor': 0.84,
    'seed': 42,
    'parallel_infer': False,
    'repetition_penalty': 1.4,
}

_lock = threading.Lock()
_tts = None


def engine():
    global _tts
    if _tts is None:
        config = dict(TTS_Config.default_configs['v2'])
        config['device'] = 'cpu'
        config['is_half'] = False
        _tts = TTS(TTS_Config(config))
    return _tts


def trim(samples, rate):
    """去掉首尾静音，别让每句话开头都空半秒。"""
    level = np.abs(samples).max() or 1
    index = np.where(np.abs(samples) > level * 0.06)[0]
    if not len(index):
        return samples
    return samples[max(0, index[0] - rate // 20): index[-1] + rate // 20]


def pieces(result):
    """合成结果是流式的：一路 yield (采样率, 音频块)，拼起来才是整句。"""
    if isinstance(result, tuple):
        result = [result]
    chunks, rate = [], 32000
    for item in result:
        if isinstance(item, dict):
            item = (item.get('sample_rate', 32000), item.get('audio'))
        part_rate, audio = item
        rate = int(part_rate or rate)
        chunks.append(np.asarray(audio, dtype=np.float32))
    if not chunks:
        return np.zeros(1, dtype=np.float32), rate
    return np.concatenate(chunks), rate


def synth(text, out_path):
    tts = engine()
    inputs = {
        'text': text,
        'text_lang': 'zh',
        'ref_audio_path': REF,
        'prompt_text': PROMPT_TEXT,
        'prompt_lang': 'ja',
        'ref_free': False,
        **PARAMS,
    }
    with _lock:
        samples, rate = pieces(tts.run(inputs))
    samples = trim(samples, rate)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    sf.write(out_path, samples, rate)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        print('[voice]', fmt % args, flush=True)

    def reply(self, code, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json; charset=utf-8')
        self.send_header('content-length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == '/health':
            self.reply(200, {'ok': True, 'loaded': _tts is not None})
        else:
            self.reply(404, {'ok': False, 'error': 'not found'})

    def do_POST(self):
        if self.path != '/synth':
            return self.reply(404, {'ok': False, 'error': 'not found'})
        length = int(self.headers.get('content-length') or 0)
        try:
            data = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            return self.reply(400, {'ok': False, 'error': 'bad json'})
        text = str(data.get('text') or '').strip()
        out = str(data.get('out') or '').strip()
        if not text or not out:
            return self.reply(400, {'ok': False, 'error': 'text and out required'})
        started = time.time()
        try:
            synth(text, out)
            self.reply(200, {'ok': True, 'ms': int((time.time() - started) * 1000)})
        except Exception as error:  # noqa: BLE001
            self.reply(500, {'ok': False, 'error': str(error)})


if __name__ == '__main__':
    print(f'[voice] ref={REF} port={PORT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
