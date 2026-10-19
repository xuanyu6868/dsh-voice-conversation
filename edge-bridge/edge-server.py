"""Edge TTS local bridge: POST /speak {text, voice, rate} -> mp3 bytes."""
import asyncio, json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import edge_tts

DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'

def to_edge_rate(rate):
    try:
        pct = round((float(rate) - 1.0) * 100)
    except Exception:
        pct = 0
    return ('+' if pct >= 0 else '') + str(pct) + '%'

async def synthesize(text, voice, rate):
    stream = edge_tts.Communicate(text, voice or DEFAULT_VOICE, rate=to_edge_rate(rate))
    out = bytearray()
    async for chunk in stream.stream():
        if chunk['type'] == 'audio':
            out += chunk['data']
    return bytes(out)

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'ok'
        self.send_response(200); self.send_header('content-length', '2'); self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        try:
            payload = json.loads(self.rfile.read(n) or b'{}')
            text = str(payload.get('text', '')).strip()
            if not text or len(text) > 4000:
                self._err(400, 'text required (<=4000)'); return
            data = asyncio.run(synthesize(text, payload.get('voice'), payload.get('speed', 1)))
            self.send_response(200)
            self.send_header('content-type', 'audio/mpeg')
            self.send_header('content-length', str(len(data)))
            self.end_headers(); self.wfile.write(data)
        except Exception as e:
            self._err(502, str(e))
    def _err(self, code, msg):
        body = str(msg)[:300].encode()
        self.send_response(code); self.send_header('content-length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass

ThreadingHTTPServer(('127.0.0.1', 9884), H).serve_forever()
