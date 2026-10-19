import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../impl.mjs';

async function host(rejection) {
  const home = await mkdtemp(join(tmpdir(), 'voice-host-')), routes = new Map(), disposers = [];
  const ctx = {
    get: name => name === 'connection' ? { requestRejection: () => rejection } : undefined,
    effect: fn => { const d = fn(); if (typeof d === 'function') disposers.push(d); },
    webServer: { register: spec => { routes.set(spec.path, spec); return () => routes.delete(spec.path); } },
    timer: { interval: () => () => {}, timeout: (...args) => typeof args[0] === 'function' ? () => {} : Promise.resolve() },
  };
  apply(ctx, { home });
  const request = (path, payload) => new Promise((resolve, reject) => {
    const req = Object.assign(new EventEmitter(), { method: 'POST', url: path, destroy() {} });
    const headers = {}, res = { statusCode: 200, setHeader: (k, v) => { headers[k] = v; }, end: body => resolve({ status: res.statusCode, headers, body }) };
    Promise.resolve(routes.get(path).handler(req, res)).catch(reject);
    queueMicrotask(() => { req.emit('data', Buffer.from(JSON.stringify(payload))); req.emit('end'); });
  });
  return { home, request, async dispose() { disposers.reverse().forEach(fn => fn()); await new Promise(r => setTimeout(r, 20)); await rm(home, { recursive: true, force: true }); } };
}

test('host logging writes bounded lines asynchronously while the route returns promptly', async () => {
  const h = await host(); const res = await h.request('/voice-tts/control', { action: 'flow', lines: Array.from({ length: 100 }, (_, i) => 'line-' + i) });
  assert.equal(res.status, 200); assert.equal(JSON.parse(res.body).status, 'logged');
  let content;
  for (let i = 0; i < 30; i++) { try { content = await readFile(join(h.home, 'voice-flow.log'), 'utf8'); break; } catch { await new Promise(r => setTimeout(r, 5)); } }
  assert.ok(content.includes('line-0\n')); assert.ok(!content.includes('line-64\n')); await h.dispose();
});
test('host keeps the existing authentication gate for both speech routes', async () => {
  const h = await host(401);
  assert.equal((await h.request('/voice-tts/tts', { text: 'test' })).status, 401);
  assert.equal((await h.request('/voice-tts/control', { action: 'status' })).status, 401); await h.dispose();
});
test('default Edge engine returns MP3 content type without starting a local clone model', async () => {
  const h = await host(), original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; };
  try {
    const res = await h.request('/voice-tts/tts', { text: '测试', stream: false });
    assert.equal(res.status, 200); assert.equal(res.headers['content-type'], 'audio/mpeg');
    assert.deepEqual([...res.body], [1, 2, 3]); assert.ok(calls.every(url => url.startsWith('http://127.0.0.1:9884')));
  } finally { globalThis.fetch = original; await h.dispose(); }
});
