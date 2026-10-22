import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import React from 'react';

export const flush = () => new Promise(resolve => setImmediate(resolve));
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export function loadClient(options = {}) {
  let factory, id = 0, now = 1000;
  const timers = new Map(), rafs = new Map(), storage = new Map(), requests = [], listeners = new Map();
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const sandbox = {
    console, Blob, AbortSignal, AbortController, crypto: { randomUUID }, Intl,
    performance: { now: () => now },
    setTimeout: (fn, ms) => { const key = ++id; timers.set(key, { fn, ms }); return key; },
    clearTimeout: key => timers.delete(key), setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: fn => { const key = ++id; rafs.set(key, fn); return key; }, cancelAnimationFrame: key => rafs.delete(key),
    navigator: {}, document, btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => ({}), body: true, blob: async () => new Blob(['audio']) }; },
    URL: { createObjectURL: () => 'blob:audio', revokeObjectURL() {} },
    Audio: class { async play() {} pause() {} },
    __VC_TEST__: options.production ? false : true, __VC_TEST_HOOKS__: options.hooks || {},
    ...options.globals,
  };
  sandbox.window = {
    __ModuleLoader__: { load: definition => { factory = definition.factory; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    ...options.window,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), sandbox, { filename: 'client.js' });
  const plugin = factory(name => name === 'react' ? React : options.markdown && name === '@deepseek-ai/dsh-client-ui-primitives' ? { MarkdownText: options.markdown } : undefined);
  const api = sandbox.__vc?.test, voice = sandbox.__vc?.voice;
  let activePanelId = null;
  if (api) api.svc.layout = { selectPanel(id) { activePanelId = id; }, panelInfo: { getSnapshot: () => ({ activePanelId }) } };
  return { api, voice, plugin, sandbox, requests, timers, rafs, storage, listeners,
    advanceTime(ms) { now += ms; },
    async fire(ms) { const entry = [...timers].find(([, value]) => value.ms === ms); if (entry) { timers.delete(entry[0]); await entry[1].fn(); await flush(); } },
    dispose() { api?.endVoice(); timers.clear(); rafs.clear(); },
  };
}
export function ready(h, id = 's1', send = async () => {}) {
  h.api.setOwner({ sessionId: id, send, seenReplies: null, lastNodes: null, lastPartial: null });
  h.voice.set({ sessionId: id, sessionGen: 1, turnId: 1, ready: true, pageVisible: true, phase: 'transcribing', muted: true });
}
export function recordingMocks(getUserMedia) {
  const streams = [];
  const media = getUserMedia || (async () => {
    const track = { stopped: 0, stop() { this.stopped++; } };
    const stream = { track, getTracks: () => [track] }; streams.push(stream); return stream;
  });
  class AudioContext {
    constructor() { this.state = 'running'; this.closed = 0; }
    createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData(data) { data.fill(0); } }; }
    sampleRate = 16000;
    destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {} }; }
    close() { this.closed++; return Promise.resolve(); }
    resume() { return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 1 }); }
  }
  class MediaRecorder {
    static instances = [];
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; MediaRecorder.instances.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  }
  return { streams, AudioContext, MediaRecorder, navigator: { mediaDevices: { getUserMedia: media, enumerateDevices: async () => [] } } };
}
