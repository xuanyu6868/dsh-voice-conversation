"""Real loopback HTTP tests with a deterministic Edge generator; no cloud calls."""
import asyncio
import http.client
import importlib.util
from pathlib import Path
import sys
import threading
import types
import unittest
from http.server import ThreadingHTTPServer

state = {'mode': 'normal'}
gate = threading.Event()
closed = threading.Event()

class Communicate:
    def __init__(self, *args, **kwargs):
        pass

    async def stream(self):
        try:
            if state['mode'] == 'early-error':
                raise RuntimeError('synthetic')
            yield {'type': 'audio', 'data': b'ONE!'}
            await asyncio.to_thread(gate.wait, 2)
            if state['mode'] == 'late-error':
                raise RuntimeError('synthetic')
            yield {'type': 'audio', 'data': b'TWO!'}
        finally:
            closed.set()

sys.modules['edge_tts'] = types.SimpleNamespace(Communicate=Communicate)
spec = importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1] / 'edge-bridge' / 'edge-server.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class BridgeTest(unittest.TestCase):
    def setUp(self):
        gate.clear()
        closed.clear()
        state['mode'] = 'normal'
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), bridge.H)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)

    def tearDown(self):
        gate.set()
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)

    def request(self, stream):
        import json
        self.connection.request('POST', '/speak', json.dumps({'text': 'test', 'stream': stream}), {'Content-Type': 'application/json'})
        return self.connection.getresponse()

    def test_first_chunk_arrives_before_generation_finishes(self):
        response = self.request(True)
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader('x-edge-stream'), '1')
        self.assertEqual(response.getheader('transfer-encoding'), 'chunked')
        self.assertEqual(response.read(4), b'ONE!')
        self.assertFalse(gate.is_set())
        gate.set()
        self.assertEqual(response.read(), b'TWO!')
        self.assertTrue(closed.wait(1))

    def test_buffered_compatibility_has_complete_body(self):
        gate.set()
        response = self.request(False)
        self.assertEqual(response.getheader('content-length'), '8')
        self.assertEqual(response.read(), b'ONE!TWO!')
        self.assertIsNotNone(response.getheader('x-edge-first-chunk-ms'))

    def test_error_before_first_chunk_returns_502(self):
        state['mode'] = 'early-error'
        response = self.request(True)
        self.assertEqual(response.status, 502)
        self.assertEqual(response.read(), b'RuntimeError')

    def test_error_after_first_chunk_is_truncated_transport(self):
        state['mode'] = 'late-error'
        response = self.request(True)
        self.assertEqual(response.read(4), b'ONE!')
        gate.set()
        with self.assertRaises(http.client.IncompleteRead):
            response.read()
        self.assertTrue(closed.wait(1))

    def test_disconnect_closes_generator_without_second_response(self):
        response = self.request(True)
        self.assertEqual(response.read(4), b'ONE!')
        response.close()
        self.connection.close()
        gate.set()
        self.assertTrue(closed.wait(2))

if __name__ == '__main__':
    unittest.main()
