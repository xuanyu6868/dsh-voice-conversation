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
  const request = (path, payload, options = {}) => new Promise((resolve, reject) => {
    const req = Object.assign(new EventEmitter(), { method: 'POST', url: path, destroy() {} });
    const headers = {}, chunks = [];
    const res = Object.assign(new EventEmitter(), { statusCode: 200, headersSent: false, writableEnded: false, destroyed: false,
      setHeader(k,v) { headers[k] = v; }, flushHeaders() { this.headersSent = true; },
      write(value) { this.headersSent = true; chunks.push(Buffer.from(value)); options.onChunk?.(value, res); return !options.backpressure; },
      end(body) { this.headersSent = true; this.writableEnded = true; resolve({ status: this.statusCode, headers, body: chunks.length ? Buffer.concat(chunks) : body, destroyed: this.destroyed }); },
      destroy() { this.destroyed = true; this.emit('close'); resolve({ status: this.statusCode, headers, body: Buffer.concat(chunks), destroyed: true }); },
    });
    options.onResponse?.(res);
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
  globalThis.fetch = async (url) => { calls.push(url); return { ok: true, headers: new Headers(), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; };
  try {
    const res = await h.request('/voice-tts/tts', { text: '测试', stream: false });
    assert.equal(res.status, 200); assert.equal(res.headers['content-type'], 'audio/mpeg');
    assert.deepEqual([...res.body], [1, 2, 3]); assert.ok(calls.every(url => url.startsWith('http://127.0.0.1:9884')));
  } finally { globalThis.fetch = original; await h.dispose(); }
});


test('Edge proxy forwards its first MPEG bytes before upstream completes', async () => {
  const h = await host(), original = globalThis.fetch;
  let controller, firstResolve, response;
  const first = new Promise(resolve => { firstResolve = resolve; });
  globalThis.fetch = async url => url.endsWith('/speak') ? new Response(new ReadableStream({ start(c) { controller=c; c.enqueue(new Uint8Array([1,2])); } }), { headers: { 'x-edge-stream': '1', 'x-edge-first-chunk-ms': '123' } }) : new Response('ok');
  try {
    const pending = h.request('/voice-tts/tts', { text: '流式测试', engine: 'edge', stream: true }, { onChunk: () => firstResolve(), onResponse: r => { response=r; } });
    await first; assert.equal(response.writableEnded, false); controller.enqueue(new Uint8Array([3,4])); controller.close();
    const result = await pending; assert.deepEqual([...result.body], [1,2,3,4]); assert.equal(result.headers['x-voice-stream'], 'mp3');
  } finally { globalThis.fetch = original; await h.dispose(); }
});

test('Edge proxy cancels the upstream reader when the downstream disconnects', async () => {
  const h = await host(), original = globalThis.fetch; let cancelled = false, signal;
  globalThis.fetch = async (url, init) => {
    if (!url.endsWith('/speak')) return new Response('ok'); signal = init.signal;
    return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); }, cancel() { cancelled=true; } }), { headers: { 'x-edge-stream': '1' } });
  };
  try {
    const result = await h.request('/voice-tts/tts', { text:'取消', engine:'edge', stream:true }, { onChunk: (_,res) => res.destroy() });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(result.destroyed,true); assert.equal(signal.aborted,true); assert.equal(cancelled,true);
  } finally { globalThis.fetch=original; await h.dispose(); }
});

test('Edge backpressure pauses forwarding until drain and survives disconnect during drain', async () => {
  const h=await host(), original=globalThis.fetch; let chunks=0, response, firstResolve;
  const first = new Promise(resolve=>{firstResolve=resolve;});
  globalThis.fetch=async url=>url.endsWith('/speak') ? new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.enqueue(new Uint8Array([2])); c.close(); } }),{headers:{'x-edge-stream':'1'}}) : new Response('ok');
  try {
    const pending=h.request('/voice-tts/tts',{text:'背压',engine:'edge',stream:true},{backpressure:true,onResponse:r=>{response=r;},onChunk:()=>{chunks++;firstResolve();}});
    await first;await new Promise(resolve=>setImmediate(resolve));assert.equal(chunks,1);response.emit('drain');
    await new Promise(resolve=>setImmediate(resolve));assert.equal(chunks,2);response.destroy();assert.equal((await pending).destroyed,true);
  } finally {globalThis.fetch=original;await h.dispose();}
});

test('an upstream error after audio headers closes transport rather than appending JSON to MP3',async()=>{
 const h=await host(),original=globalThis.fetch;let controller;
 globalThis.fetch=async url=>url.endsWith('/speak')?new Response(new ReadableStream({start(c){controller=c;c.enqueue(new Uint8Array([1,2]));}}),{headers:{'x-edge-stream':'1'}}):new Response('ok');
 try {const result=await h.request('/voice-tts/tts',{text:'错误',engine:'edge',stream:true},{onChunk:()=>controller.error(new Error('upstream lost'))});
 assert.equal(result.destroyed,true);assert.equal(result.headers['content-type'],'audio/mpeg');assert.deepEqual([...result.body],[1,2]);
 }finally{globalThis.fetch=original;await h.dispose();}
});
