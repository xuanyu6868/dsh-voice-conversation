"""Edge TTS bridge: buffered compatibility plus incremental MPEG transport."""
import asyncio
from contextlib import aclosing
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import edge_tts

DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'


def to_edge_rate(rate):
    try:
        pct = round((float(rate) - 1.0) * 100)
    except (TypeError, ValueError):
        pct = 0
    return ('+' if pct >= 0 else '') + str(pct) + '%'


async def audio_chunks(text, voice, rate):
    stream = edge_tts.Communicate(text, voice or DEFAULT_VOICE, rate=to_edge_rate(rate))
    async with aclosing(stream.stream()) as chunks:
        async for chunk in chunks:
            if chunk['type'] == 'audio' and chunk['data']:
                yield chunk['data']


async def synthesize(text, voice, rate, mark):
    out = bytearray()
    async for data in audio_chunks(text, voice, rate):
        if mark[0] is None:
            mark[0] = time.monotonic()
        out += data
    return bytes(out)


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):
        self.send_response(200)
        self.send_header('content-length', '2')
        self.end_headers()
        self.wfile.write(b'ok')

    async def _stream_audio(self, payload, t0):
        count = 0
        async with aclosing(audio_chunks(str(payload['text']).strip(), payload.get('voice'), payload.get('speed', 1))) as chunks:
            async for data in chunks:
                if count == 0:
                    self.send_response(200)
                    self.send_header('content-type', 'audio/mpeg')
                    self.send_header('transfer-encoding', 'chunked')
                    self.send_header('cache-control', 'no-store')
                    self.send_header('x-edge-stream', '1')
                    self.send_header('x-edge-first-chunk-ms', str(round((time.monotonic() - t0) * 1000)))
                    self.end_headers()
                    self.response_started = True
                self.wfile.write(('%x\r\n' % len(data)).encode('ascii'))
                self.wfile.write(data)
                self.wfile.write(b'\r\n')
                self.wfile.flush()
                count += 1
        if not count:
            raise ValueError('Edge returned no audio')
        self.wfile.write(b'0\r\n\r\n')
        self.wfile.flush()

    def do_POST(self):
        self.response_started = False
        try:
            n = int(self.headers.get('content-length') or 0)
            if n <= 0 or n > 65536:
                self.close_connection = True
                self._err(400, 'invalid body size')
                return
            payload = json.loads(self.rfile.read(n))
            text = str(payload.get('text', '')).strip()
            if not text or len(text) > 4000:
                self._err(400, 'text required (<=4000)')
                return
            t0 = time.monotonic()
            if payload.get('stream') is True:
                asyncio.run(self._stream_audio(payload, t0))
                return
            mark = [None]
            data = asyncio.run(synthesize(text, payload.get('voice'), payload.get('speed', 1), mark))
            self.send_response(200)
            self.send_header('content-type', 'audio/mpeg')
            self.send_header('x-edge-first-chunk-ms', 'na' if mark[0] is None else str(round((mark[0] - t0) * 1000)))
            self.send_header('content-length', str(len(data)))
            self.end_headers()
            self.response_started = True
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as error:
            if self.response_started:
                # Truncated chunked transport must be an error, not a successful
                # EOF or a second HTTP response appended to the MPEG bytes.
                self.close_connection = True
            else:
                self._err(502, type(error).__name__)

    def _err(self, code, msg):
        body = str(msg)[:300].encode()
        self.send_response(code)
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 9884), H).serve_forever()
