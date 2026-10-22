import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadClient, recordingMocks, deferred, flush } from './client-harness.mjs';

async function drain(h) {
  // The real WAV/base64 encoder yields in bounded blocks. Run only those
  // zero-delay tasks, never recognition/send deadlines in this helper.
  for (let i = 0; i < 30; i++) { await flush(); await h.fire(0); }
}
async function capture(transcribe = async () => ({ text: '测试语音' }), options = {}) {
  const sent = [], mocks = recordingMocks(), requests = [];
  const h = loadClient({ globals: { ...mocks, ...options.globals } });
  h.api.svc.speech = { transcribe: (request, signal) => { requests.push({ request, signal }); return transcribe(request, signal); } };
  await h.api.startVoice({ sessionId: 'a', send: (text, sessionId, mode) => { sent.push({ text, sessionId, mode }); return options.send?.(text); } });
  await flush(); const run = h.api.rec.current; assert.ok(run);
  return { ...h, sent, requests, run, feed(count, level = .04, target = run) {
    for (let i = 0; i < count; i++) { h.advanceTime(100); h.api.processPcm(target, new Float32Array(1600).fill(level)); }
  } };
}

test('continuous PCM shows partial revisions in one bubble, then directly submits exactly one final utterance', async () => {
  let n = 0; const h = await capture(async () => ({ text: ++n === 1 ? '打开' : '。打开灯带。' }));
  h.feed(12); await drain(h);
  assert.equal(h.voice.inputRows.length, 1); assert.equal(h.voice.inputRows[0].text, '打开'); assert.deepEqual(h.sent, []);
  h.api.setPageVisible(false); h.api.setKeyboardOpen(true); h.feed(3); h.feed(8, 0); await drain(h);
  assert.deepEqual(h.sent, [{ text: '打开灯带。', sessionId: 'a', mode: 'queue' }]);
  assert.equal(h.api.rec.current, h.run); assert.equal(h.run.stream.track.stopped, 0);
  h.api.deliverInputs(); await drain(h); assert.equal(h.sent.length, 1); h.dispose();
});
test('silence and isolated noise never call recognition', async () => {
  const h = await capture(); h.feed(120, 0);
  for (let i = 0; i < 15; i++) { h.feed(1, .04); h.feed(3, 0); }
  await drain(h); assert.equal(h.requests.length, 0); assert.equal(h.voice.inputRows.length, 0); h.dispose();
});
test('a punctuation-only final result discards the utterance even if a partial looked meaningful', async () => {
  let n = 0; const h = await capture(async () => ({ text: ++n === 1 ? '错误中间结果' : '。？！' }));
  h.feed(12); await drain(h); assert.equal(h.voice.inputRows[0].text, '错误中间结果');
  h.feed(8, 0); await drain(h); assert.equal(h.voice.inputRows[0].status, 'discarded'); assert.equal(h.sent.length, 0); h.dispose();
});
test('endpoint cancels a slow partial and gives the final request priority with AbortSignal', async () => {
  const slow = deferred(); let n = 0;
  const h = await capture(async () => ++n === 1 ? slow.promise : { text: '最终句子' });
  h.feed(12); await drain(h); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].signal.aborted, false);
  h.feed(8, 0); await drain(h); assert.equal(h.requests[0].signal.aborted, true); assert.equal(h.sent[0].text, '最终句子');
  slow.resolve({ text: '迟到的中间结果' }); await drain(h); assert.equal(h.sent.length, 1); assert.equal(h.voice.inputRows[0].text, '最终句子'); h.dispose();
});
test('recognition timeout never submits a partial or stops the continuous microphone', async () => {
  const h = await capture(() => new Promise(() => {})); h.feed(4); h.feed(8, 0); await drain(h);
  assert.equal(h.requests.length, 1); await h.fire(12000); await drain(h);
  assert.equal(h.requests[0].signal.aborted, true); assert.equal(h.voice.inputRows[0].status, 'failed');
  assert.equal(h.sent.length, 0); assert.equal(h.api.rec.current, h.run); h.dispose();
});
test('late recognition from A cannot display, submit or play in B', async () => {
  const slow = deferred(), h = await capture(() => slow.promise); h.feed(4); h.feed(8, 0); await drain(h);
  await h.api.startVoice({ sessionId: 'b', send: () => assert.fail('old recognition sent to B') }); await flush();
  slow.resolve({ text: 'A 的迟到语音' }); await drain(h);
  assert.equal(h.voice.sessionId, 'b'); assert.equal(h.voice.inputRows.length, 0); assert.equal(h.sent.length, 0); assert.equal(h.run.stream.track.stopped, 1); h.dispose();
});
test('speech onset interrupts playback before final recognition; the new prompt uses steer', async () => {
  const h = await capture(); h.api.acceptChatSnapshot({ nodes: [] }); h.api.acceptRunning(true);
  h.sandbox.__vc.speak('旧回答正在朗读，请听完。'); await flush(); assert.equal(h.api.isSpeaking(), true);
  h.feed(3); assert.equal(h.api.isSpeaking(), false); assert.equal(h.voice.readBlocked, true); assert.equal(h.sent.length, 0);
  h.feed(8, 0); await drain(h); assert.equal(h.sent[0].mode, 'steer'); assert.equal(h.api.rec.current, h.run); h.dispose();
});
test('interrupted old replies remain silent until the new user record is admitted', async () => {
  const spoken = [], h = loadClient({ hooks: { speak: text => spoken.push(text) } });
  await h.api.startVoice({ sessionId: 'a', send: async () => {} }); h.api.acceptChatSnapshot({ nodes: [] });
  h.voice.set({ readBlocked: true }); const old = { kind: 'assistant', seq: 1, messageId: 'old', blocks: [{ kind: 'text', text: '旧回复' }] };
  h.api.acceptChatSnapshot({ nodes: [old] }); assert.deepEqual(spoken, []);
  await h.api.dispatchMessage('新问题', 'keyboard');
  const user = { kind: 'steering', seq: 2, content: [{ type: 'text', text: '新问题' }] };
  h.api.acceptChatSnapshot({ nodes: [old, user] });
  const fresh = { kind: 'assistant', seq: 3, messageId: 'fresh', blocks: [{ kind: 'text', text: '新回复' }] };
  h.api.acceptChatSnapshot({ nodes: [old, user, fresh] }); assert.deepEqual(spoken, ['新回复']); h.dispose();
});
test('two identical spoken phrases reconcile to two distinct native records without duplicate bubbles', async () => {
  const h = await capture(); h.api.acceptChatSnapshot({ nodes: [] });
  h.feed(4); h.feed(8, 0); await drain(h); h.feed(4); h.feed(8, 0); await drain(h);
  assert.equal(h.sent.length, 2);
  const node = seq => ({ kind: 'user', seq, content: [{ type: 'text', text: '测试语音' }] });
  h.api.acceptChatSnapshot({ nodes: [node(1)] }); assert.equal(h.voice.inputRows.filter(row => row.matchedSeq === null).length, 1);
  h.api.acceptChatSnapshot({ nodes: [node(1), node(2)] }); assert.equal(h.voice.inputRows.filter(row => row.matchedSeq === null).length, 0);
  assert.equal(h.voice.messages.filter(row => row.who === 'you').length, 2); h.dispose();
});
test('long speech uses bounded overlapping chunks and submits only once after the final endpoint', async () => {
  const results = ['打开客厅', '客厅的灯带', '灯带并调暗']; let n = 0;
  const h = await capture(async () => ({ text: results[Math.min(n++, 2)] }));
  // Avoid intermediate timers while enqueueing; final chunks supersede partials.
  h.feed(52); await drain(h); assert.equal(h.sent.length, 0);
  h.feed(50); await drain(h); assert.equal(h.sent.length, 0);
  h.feed(8, 0); await drain(h);
  assert.equal(h.sent.length, 1);
  for (const { request } of h.requests) {
    const wav = Buffer.from(request.audioBase64, 'base64'); assert.equal(wav.readUInt32LE(24), 16000);
    assert.ok(wav.length <= 44 + 81600*2); // 5 sec + at most one 100 ms capture frame
  }
  h.dispose();
});
test('boundary deduplication preserves normal punctuation and unrelated repeated words', () => {
  const h = loadClient();
  assert.equal(h.api.joinRecognition('打开客厅', '客厅的灯带'), '打开客厅的灯带');
  assert.equal(h.api.joinRecognition('你好', '再说一次你好'), '你好再说一次你好');
  assert.equal(h.api.joinRecognition('温度 3.14', '继续'), '温度 3.14继续'); h.dispose();
});
test('capture heartbeat reports recovery and reacquires a stalled microphone without navigation', async () => {
  const h = await capture(); h.feed(1, 0); assert.equal(h.voice.captureState, 'active');
  h.advanceTime(2600); h.api.checkCapture(); assert.equal(h.voice.captureState, 'recovering');
  h.advanceTime(2500); h.api.checkCapture(); await flush();
  assert.notEqual(h.api.rec.current, h.run); assert.equal(h.run.stream.track.stopped, 1);
  h.api.processPcm(h.api.rec.current, new Float32Array(1600)); assert.equal(h.voice.captureState, 'active'); h.dispose();
});
test('capture recovery is bounded when an audio device never produces frames', async () => {
  const h = await capture();
  for (let i = 0; i < 4; i++) { h.advanceTime(5100); h.api.checkCapture(); await flush(); }
  assert.equal(h.api.rec.current, null); assert.equal(h.voice.captureState, 'error'); assert.equal(h.voice.error, 'error.micStalled'); h.dispose();
});
test('AudioWorklet is selected when available and its PCM messages reach VAD', async () => {
  const mocks = recordingMocks(); let sourceCode;
  class AudioContext extends mocks.AudioContext { audioWorklet = { addModule: async () => { sourceCode = true; } }; }
  class AudioWorkletNode { port = {}; connect() {} disconnect() {} }
  const h = await capture(undefined, { globals: { AudioContext, AudioWorkletNode } });
  assert.equal(sourceCode, true); assert.ok(h.run.processor.port);
  for (let i = 0; i < 3; i++) h.run.processor.port.onmessage({ data: new Float32Array(1600).fill(.04) });
  assert.equal(h.voice.inputRows.length, 1); assert.equal(h.rafs.size, 0); h.dispose();
});
test('real worklet source downsamples 48kHz to bounded 16kHz PCM independently of animation frames', async () => {
  const mocks = recordingMocks(); let blob, Processor; const frames = [];
  class AudioContext extends mocks.AudioContext { audioWorklet = { addModule: async () => {
    const source = await blob.text();
    vm.runInNewContext(source, { Float32Array, sampleRate: 48000,
      AudioWorkletProcessor: class { port = { postMessage: frame => frames.push(frame) }; },
      registerProcessor: (name, Class) => { assert.equal(name, 'dsh-voice-pcm'); Processor = Class; } });
  } }; }
  class AudioWorkletNode { port = {}; connect() {} disconnect() {} }
  const h = await capture(undefined, { globals: { AudioContext, AudioWorkletNode, URL: { createObjectURL: value => { blob = value; return 'blob:worklet'; }, revokeObjectURL() {} } } });
  const processor = new Processor();
  for (let i = 0; i < 75; i++) assert.equal(processor.process([[new Float32Array(128).fill(.125)]]), true);
  assert.equal(frames.length, 2); assert.equal(frames[0].length, 1600); assert.equal(frames[0][0], .125); h.dispose();
});
test('an uncertain receipt is not automatically retried by continued listening', async () => {
  let calls = 0; const h = await capture(undefined, { send: () => { calls++; return new Promise(() => {}); } });
  h.feed(4); h.feed(8, 0); await drain(h); await h.fire(20000); await drain(h);
  assert.equal(h.voice.inputRows[0].status, 'failed'); assert.equal(calls, 1); h.feed(40, 0); await drain(h); assert.equal(calls, 1); h.dispose();
});


test('native chat echo is registered before prompt and uses the same request id', async () => {
  const h = loadClient(), events = [];
  h.api.svc.sessions = { retain(id) { return { ready: Promise.resolve({ sessionId: id, session: {
    beginSubmission(input) { events.push(['echo', input]); return { requestId: 'voice-request', abandon() { events.push(['abandon']); } }; },
    async prompt(content, mode, signal, requestId) { events.push(['prompt', { content, mode, requestId }]); return { ok: true }; },
  } }), release() {} }; } };
  await h.api.startVoice({ sessionId: 'a' }); await h.api.dispatchMessage('说完直接发送', 'asr');
  assert.equal(events[0][0], 'echo'); assert.equal(events[1][0], 'prompt'); assert.equal(events[1][1].requestId, 'voice-request');
  assert.equal(events[0][1].text, '说完直接发送'); h.dispose();
});

test('a rejected native prompt abandons its local echo without retry', async () => {
  const h = loadClient(); let abandoned = 0, calls = 0;
  h.api.svc.sessions = { retain(id) { return { ready: Promise.resolve({ sessionId: id, session: {
    beginSubmission() { return { requestId: 'failed-request', abandon() { abandoned++; } }; },
    async prompt() { calls++; return { ok: false }; },
  } }), release() {} }; } };
  await h.api.startVoice({ sessionId: 'a' }); assert.equal(await h.api.dispatchMessage('不要重复发送', 'asr'), false);
  assert.equal(abandoned, 1); assert.equal(calls, 1); assert.equal(h.voice.inputRows[0].status, 'failed'); h.dispose();
});
