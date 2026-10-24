import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient, ready, deferred, flush, recordingMocks } from './client-harness.mjs';

const assistant = (id, text) => ({ kind: 'assistant', messageId: id, time: 1, blocks: [{ kind: 'text', text }] });
const chat = (nodes, partial = null) => ({ legacy: { nodes, partial } });

test('ASR sends directly to its bound session without reading or changing the normal composer', async () => {
  const h = loadClient(), sent = [];
  await h.api.startVoice({ sessionId: 's1', inputActions: new Proxy({}, { get: () => assert.fail('composer touched') }), getDraft: () => assert.fail('draft read'), send: text => sent.push(text) });
  h.api.updateKeyboardDraft('你好');
  assert.equal(h.api.landTranscript('你好', h.voice.sessionGen, h.voice.turnId), true);
  await flush(); assert.deepEqual(sent, ['你好']); assert.equal(h.voice.keyboardDraft, '你好');
  assert.equal(h.voice.inputRows[0].text, '你好'); assert.equal(h.voice.inputRows[0].status, 'accepted'); h.dispose();
});

test('a claimed voice row submits once even when delivery is pumped repeatedly', async () => {
  const h = loadClient(), gate = deferred(), sent = []; ready(h, 's1', text => { sent.push(text); return gate.promise; });
  h.api.landTranscript('开灯', 1, 1); h.api.deliverInputs(); h.api.deliverInputs();
  assert.deepEqual(sent, ['开灯']); gate.resolve(); await flush(); await h.api.deliverInputs();
  assert.deepEqual(sent, ['开灯']); h.dispose();
});

test('direct speech submission schedules no 1.5 second countdown', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => sent.push(text)); h.api.landTranscript('打开灯带', 1, 1);
  assert.deepEqual(sent, ['打开灯带']); assert.equal([...h.timers.values()].some(timer => timer.ms === 1500), false); h.dispose();
});

test('keyboard typing remains manual, including while speech is active', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => sent.push(text)); h.api.setKeyboardOpen(true);
  h.api.updateKeyboardDraft('现在几点'); await h.fire(1500); assert.deepEqual(sent, []); h.dispose();
});

test('minimizing does not cancel a voice submission', async () => {
  const h = loadClient(), gate = deferred(), sent = []; ready(h, 's1', text => { sent.push(text); return gate.promise; });
  h.api.landTranscript('请稍等', 1, 1); h.api.setPageVisible(false); gate.resolve(); await flush();
  assert.deepEqual(sent, ['请稍等']); assert.equal(h.voice.inputRows[0].status, 'accepted'); h.dispose();
});

test('a transcript arriving while minimized sends once without waiting for expand', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => sent.push(text)); h.api.setPageVisible(false);
  h.api.landTranscript('新转写', 1, 1); await flush(); h.api.setPageVisible(true); await flush();
  assert.deepEqual(sent, ['新转写']); h.dispose();
});

test('opening keyboard keeps permission and recognition ownership intact', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => sent.push(text)); const gen = h.voice.sessionGen, turn = h.voice.turnId;
  h.voice.set({ requesting: true }); h.api.setKeyboardOpen(true); assert.equal(h.voice.requesting, true);
  assert.equal(h.api.landTranscript('同时说话', gen, turn), true); await flush(); assert.deepEqual(sent, ['同时说话']); h.dispose();
});

test('keyboard draft is independent from the live voice row', async () => {
  const h = loadClient(); ready(h); h.api.updateKeyboardDraft('键盘草稿'); h.api.landTranscript('语音输入', 1, 1);
  await flush(); assert.equal(h.voice.keyboardDraft, '键盘草稿'); assert.equal(h.voice.inputRows[0].text, '语音输入'); h.dispose();
});

test('a voice row ready during a keyboard receipt is delivered after the receipt', async () => {
  const h = loadClient(), gate = deferred(), sent = []; ready(h, 's1', text => { sent.push(text); return sent.length === 1 ? gate.promise : Promise.resolve(); });
  const sending = h.api.dispatchMessage('键盘'); h.api.landTranscript('下一句', 1, h.voice.turnId);
  assert.deepEqual(sent, ['键盘']); gate.resolve(); await sending; await flush(); assert.deepEqual(sent, ['键盘', '下一句']); h.dispose();
});

test('symbol-only, zero-width and empty recognition results do not trigger a model turn', () => {
  const h = loadClient(); ready(h);
  for (const value of ['', '。', '…？！', '\u200B。\uFEFF', '🎵', '<|zh|><|NEUTRAL|>。']) {
    h.voice.set({ phase: 'transcribing' }); assert.equal(h.api.landTranscript(value, 1, 1), false);
    assert.equal(h.voice.inputRows.length, 0);
  }
  for (const value of ['好', '对', '不', '1', 'OK']) assert.equal(h.api.meaningfulTranscript(value), value);
  h.dispose();
});
test('late results from an ended session or older turn cannot write', () => {
  const h = loadClient(); ready(h); h.voice.set({ sessionGen: 2, turnId: 5 });
  assert.equal(h.api.landTranscript('旧会话', 1, 5), false);
  assert.equal(h.api.landTranscript('旧轮次', 2, 4), false);
  assert.equal(h.voice.inputRows.length, 0); h.dispose();
});
test('VAD requires consecutive speech rather than adding isolated clicks', () => {
  const h = loadClient(), v = { t0: 0, lastT: 0, aboveMs: 0, silenceStart: null, started: false };
  for (let t = 100; t <= 6000; t += 200) { h.api.advanceVad(v, .03, t); h.api.advanceVad(v, 0, t + 100); }
  assert.equal(v.started, false);
  for (let t = 6200; t <= 6500; t += 100) h.api.advanceVad(v, .03, t);
  assert.equal(v.started, true); h.dispose();
});
test('a delayed animation frame alone cannot count as a full spoken phrase', () => {
  const h = loadClient(), v = { t0: 0, lastT: 0, aboveMs: 0, silenceStart: null, started: false };
  h.api.advanceVad(v, .04, 4000); assert.equal(v.started, false); assert.equal(v.aboveMs, 100); h.dispose();
});
test('switching sessions preserves each voice-page draft independently', async () => {
  const h = loadClient(); await h.api.startVoice({ sessionId: 'a', send: async () => {} });
  h.api.setKeyboardOpen(true); h.api.updateKeyboardDraft('A 的草稿');
  await h.api.startVoice({ sessionId: 'b', send: async () => {} }); h.api.updateKeyboardDraft('B 的草稿');
  assert.equal(h.voice.sessionId, 'b');
  await h.api.startVoice({ sessionId: 'a', send: async () => {} });
  assert.equal(h.voice.keyboardDraft, 'A 的草稿'); assert.equal(h.voice.keyboardOpen, true); h.dispose();
});
test('each send uses an explicit native session id and leaves context/model/tool selection to Harness', async () => {
  const h = loadClient(), requests = [];
  h.api.svc.remoteSession = { prompt: async request => { requests.push(request); return { ok: true, value: { accepted: true } }; } };
  await h.api.startVoice({ sessionId: 'a' }); h.api.updateKeyboardDraft('延续 A 的上下文');
  assert.equal(await h.api.dispatchMessage(h.voice.keyboardDraft), true);
  await h.api.startVoice({ sessionId: 'b' }); h.api.updateKeyboardDraft('延续 B 的上下文'); await h.api.dispatchMessage(h.voice.keyboardDraft);
  assert.deepEqual(requests.map(request => request.sessionId), ['a', 'b']);
  assert.equal(requests[0].content[0].text, '延续 A 的上下文');
  assert.ok(requests[0].requestId); assert.equal(requests[0].mode, 'queue');
  assert.equal(requests[0].model, undefined); assert.equal(requests[0].systemPrompt, undefined); h.dispose();
});
test('session retention survives view switches and releases on end/switch', async () => {
  const h = loadClient(), released = [], prompts = [];
  h.api.svc.sessions = { retain(id) { return { ready: Promise.resolve({ sessionId: id, session: { prompt: async content => { prompts.push([id, content[0].text]); return { ok: true }; } } }), release: () => released.push(id) }; } };
  await h.api.startVoice({ sessionId: 'a' }); h.api.setPageVisible(false);
  assert.deepEqual(released, []); h.api.setPageVisible(true);
  await h.api.dispatchMessage('A'); await h.api.startVoice({ sessionId: 'b' });
  assert.deepEqual(released, ['a']); h.api.endVoice(); assert.deepEqual(released, ['a', 'b']); assert.equal(prompts[0][0], 'a'); h.dispose();
});
test('double manual sends are synchronously claimed exactly once', async () => {
  const h = loadClient(), gate = deferred(), sent = []; ready(h, 's1', text => { sent.push(text); return gate.promise; });
  const a = h.api.dispatchMessage('你好'); const b = await h.api.dispatchMessage('你好');
  assert.equal(b, false); assert.deepEqual(sent, ['你好']); gate.resolve(); assert.equal(await a, true); h.dispose();
});
test('an acknowledgement from A cannot clear B’s draft and retires A’s accepted saved draft', async () => {
  const h = loadClient(), gate = deferred(); await h.api.startVoice({ sessionId: 'a', send: () => gate.promise });
  h.api.updateKeyboardDraft('A 已发送'); const pending = h.api.dispatchMessage(h.voice.keyboardDraft);
  await h.api.startVoice({ sessionId: 'b', send: async () => {} }); h.api.updateKeyboardDraft('B 未发送');
  gate.resolve(); await pending;
  assert.equal(h.voice.keyboardDraft, 'B 未发送');
  await h.api.startVoice({ sessionId: 'a', send: async () => {} }); assert.equal(h.voice.keyboardDraft, ''); h.dispose();
});
test('a new edit with the same text is not erased by an older acknowledgement', async () => {
  const h = loadClient(), gate = deferred(); ready(h, 's1', () => gate.promise);
  h.api.updateKeyboardDraft('相同文本'); const pending = h.api.dispatchMessage(h.voice.keyboardDraft);
  h.api.updateKeyboardDraft('相同文本'); gate.resolve(); await pending;
  assert.equal(h.voice.keyboardDraft, '相同文本'); h.dispose();
});
test('failed and timed-out sends retain text and never automatically retry', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => { sent.push(text); throw new Error('offline'); });
  h.api.updateKeyboardDraft('不能丢失'); assert.equal(await h.api.dispatchMessage(h.voice.keyboardDraft), false);
  assert.equal(h.voice.keyboardDraft, '不能丢失'); assert.equal(h.voice.error, 'error.sendFailed'); assert.equal(sent.length, 1);
  const gate = deferred(); h.api.setOwner({ sessionId: 's1', send: () => gate.promise });
  const pending = h.api.dispatchMessage(h.voice.keyboardDraft); await h.fire(20000); await pending;
  assert.equal(h.voice.error, 'error.sendUnknown'); assert.equal(h.voice.keyboardDraft, '不能丢失'); gate.resolve(); h.dispose();
});
test('old-session chat effects cannot display or play text in the new session', () => {
  const spoken = [], h = loadClient({ hooks: { speak: text => spoken.push(text) } }); ready(h);
  const old = h.voice.owner; h.api.acceptChatSnapshot(chat([assistant('old', 'A 的历史')]), old, 1);
  h.api.setOwner({ sessionId: 'b', lastNodes: null, lastPartial: null, seenReplies: null }); h.voice.set({ sessionId: 'b', sessionGen: 2, messages: [] });
  h.api.acceptChatSnapshot(chat([assistant('new', 'A 的迟到回复')]), old, 1);
  assert.equal(h.voice.messages.length, 0); assert.deepEqual(spoken, []); h.dispose();
});
test('opening a session displays history without replaying it; new replies play once in order', () => {
  const spoken = [], h = loadClient({ hooks: { speak: text => spoken.push(text) } }); ready(h);
  const old = assistant('m0', '已有上下文'), first = assistant('m1', '第一步'), second = assistant('m2', '第二步');
  h.api.acceptChatSnapshot(chat([old])); assert.equal(h.voice.messages[0].text, '已有上下文'); assert.deepEqual(spoken, []);
  const snapshot = chat([old, first, second]); h.api.acceptChatSnapshot(snapshot); h.api.acceptChatSnapshot(snapshot);
  assert.deepEqual(spoken, ['第一步', '第二步']); h.dispose();
});
test('an already-visible partial renders without historical read-aloud on open', () => {
  const spoken = [], h = loadClient({ hooks: { speak: text => spoken.push(text) } }); ready(h);
  h.api.acceptChatSnapshot(chat([], { turn: 1, step: 1, blocks: [{ kind: 'text', text: '**逐步**出现' }] }));
  assert.equal(h.voice.messages[0].streaming, true); assert.deepEqual(spoken, []); h.dispose();
});
test('new speech interrupts native model work with steer, never a late separate cancel', async () => {
  const h = loadClient(), requests = []; h.api.svc.remoteSession = { prompt: async value => { requests.push(value); return { ok: true }; } };
  await h.api.startVoice({ sessionId: 'a' }); h.api.acceptRunning(true); await h.api.dispatchMessage('改一下', 'asr');
  assert.equal(requests[0].mode, 'steer'); assert.equal(requests[0].sessionId, 'a'); h.dispose();
});

test('volume notifications do not invalidate the general voice observable', () => {
  const h = loadClient(); let updates = 0; h.voice.subscribe(() => updates++);
  const version = h.voice.version;
  for (let i = 0; i < 100; i++) { h.advanceTime(100); h.api.publishLevel(i % 2); }
  assert.equal(updates, 0); assert.equal(h.voice.version, version); h.dispose();
});
test('errors recover by scope and synthesis retry does not resubmit the question', () => {
  const spoken = [], h = loadClient({ hooks: { speak: text => spoken.push(text) } }); ready(h);
  h.api.setScopedError('asr', 'error.asrFailed'); h.api.setScopedError('synth', 'error.synthFailed'); h.api.clearScopedError('synth');
  assert.equal(h.voice.errors.asr, 'error.asrFailed'); h.voice.lastReply = { id: 'm', text: '已有回复' };
  assert.equal(h.api.retrySpeaking(), true); assert.deepEqual(spoken, ['已有回复']); h.dispose();
});
test('old PCM callbacks cannot stop or contaminate a new session capture', async () => {
  const mocks = recordingMocks(), h = loadClient({ globals: mocks }); h.api.svc.speech = { transcribe: async () => ({ text: 'unused' }) };
  await h.api.startVoice({ sessionId: 'a', send: async () => {} }); await flush(); const old = h.api.rec.current;
  await h.api.startVoice({ sessionId: 'b', send: async () => {} }); await flush(); const current = h.api.rec.current;
  assert.ok(current && current !== old); h.api.processPcm(old, new Float32Array(1600).fill(.1));
  assert.equal(h.voice.inputRows.length, 0); assert.equal(current.stream.track.stopped, 0); assert.ok(old.stream.track.stopped > 0); h.dispose();
});

test('late microphone permission results cannot clear a new session’s permission request', async () => {
  const a = deferred(), b = deferred(); let count = 0;
  const mocks = recordingMocks(() => ++count === 1 ? a.promise : b.promise), h = loadClient({ globals: mocks }); h.api.svc.speech = {};
  await h.api.startVoice({ sessionId: 'a', send: async () => {} }); await h.api.startVoice({ sessionId: 'b', send: async () => {} });
  const oldTrack = { stopped: false, stop() { this.stopped = true; } };
  a.resolve({ getTracks: () => [oldTrack] }); await flush();
  assert.equal(oldTrack.stopped, true); assert.equal(h.voice.requesting, true);
  const track = { stop() {} }; b.resolve({ getTracks: () => [track] }); await flush();
  assert.equal(h.voice.sessionId, 'b'); assert.equal(h.voice.requesting, false); h.dispose();
});
test('audio encoder yields and preserves WAV headers and PCM samples', async () => {
  const h = loadClient();
  // Short sample fits one bounded chunk, so this assertion does not need a clock advance.
  const bytes = await h.api.encodeWave(new Float32Array([0, 1, -1])); const view = new DataView(bytes.buffer);
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'RIFF'); assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getInt16(46, true), 32767); assert.equal(view.getInt16(48, true), -32768); h.dispose();
});
test('Enter respects Chinese IME composition and Shift+Enter', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => sent.push(text)); h.api.updateKeyboardDraft('你好');
  for (const flags of [{ isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { shiftKey: true }]) h.api.keyboardKeyDown({ key: 'Enter', preventDefault: () => assert.fail('IME/newline intercepted'), ...flags });
  assert.deepEqual(sent, []); h.api.keyboardKeyDown({ key: 'Enter', preventDefault() {} }); await flush(); assert.deepEqual(sent, ['你好']); h.dispose();
});
test('production exposes no writable global debug API', () => { const h = loadClient({ production: true }); assert.equal(h.sandbox.__vc, undefined); h.dispose(); });

test('late synthesis from A cannot start playing or release B’s playback pump', async () => {
  const h = loadClient(), old = deferred(), played = [], revoked = []; ready(h);
  let count = 0, blob = 0;
  h.sandbox.fetch = async () => ++count === 1 ? old.promise : { ok: true, body: true, blob: async () => new Blob(['new']) };
  h.sandbox.Audio = class { constructor(url) { this.url = url; } async play() { played.push(this.url); } pause() {} };
  h.sandbox.URL = { createObjectURL: () => 'blob:' + ++blob, revokeObjectURL: url => revoked.push(url) };
  h.sandbox.__vc.speak('A 的旧回复。'); await flush(); h.api.stopSpeaking();
  h.sandbox.__vc.speak('B 的新回复。'); await flush(); await flush();
  assert.equal(played.length, 1); assert.equal(h.api.isSpeaking(), true);
  old.resolve({ ok: true, body: true, blob: async () => new Blob(['old']) }); await flush(); await flush();
  assert.equal(played.length, 1); assert.equal(h.api.isSpeaking(), true);
  h.api.stopSpeaking(); assert.equal(h.api.isSpeaking(), false); assert.ok(revoked.includes('blob:1')); h.dispose();
});
test('playback, model work, keyboard, hidden document and minimizing keep the same capture alive', async () => {
  const mocks = recordingMocks(), h = loadClient({ globals: mocks }); h.api.svc.speech = {};
  await h.api.startVoice({ sessionId: 'a', send: async () => {} }); await flush(); const first = h.api.rec.current;
  h.sandbox.__vc.speak('正在朗读。'); await flush(); h.api.acceptRunning(true); h.api.setKeyboardOpen(true);
  h.sandbox.document.hidden = true; h.api.setPageVisible(false); h.voice.set({ settingsOpen: true, captionsOn: false });
  assert.equal(h.api.rec.current, first); assert.equal(first.stream.track.stopped, 0); h.dispose(); assert.equal(first.stream.track.stopped, 1);
});

test('scoped conversation fallback keeps the destination explicit', async () => {
  const h = loadClient(), sends = [];
  h.api.svc.sessions = { scope: id => ({ conversation: { send: async text => sends.push([id, text]) } }) };
  await h.api.startVoice({ sessionId: 'exact-session' }); await h.api.dispatchMessage('继续讨论');
  assert.deepEqual(sends, [['exact-session', '继续讨论']]); h.dispose();
});
test('missing session send APIs fail closed instead of falling back to a shared composer', async () => {
  const h = loadClient(); await h.api.startVoice({ sessionId: 'a', inputActions: { submit: () => assert.fail('unsafe fallback') } });
  h.api.updateKeyboardDraft('保持原样'); assert.equal(await h.api.dispatchMessage(h.voice.keyboardDraft), false);
  assert.equal(h.voice.keyboardDraft, '保持原样'); h.dispose();
});

test('legacy clone preference migrates to Edge without warming a removed local engine', async () => {
  const h = loadClient();
  h.storage.set('dsh-voice-conversation.prefs', JSON.stringify({ voiceURI: 'gsv-local' }));
  await h.api.startVoice({ sessionId: 'a', send: async () => {} });
  assert.equal(h.requests.filter(request => JSON.parse(request.init?.body || '{}').action === 'warmup').length, 0);
  h.dispose();
});

test('normal punctuation remains intact while leading noise and repeated marks are cleaned', () => {
  const h = loadClient();
  for (const [before, after] of [['。你好，在吗？','你好，在吗？'], ['！？，开灯。。','开灯。'], ['温度 -3.5 度，电量 3.14。','温度 -3.5 度，电量 3.14。'], ['.5','.5'], ['“好”','“好”']]) assert.equal(h.api.meaningfulTranscript(before), after);
  h.dispose();
});

test('a long unpunctuated reply is bounded into synthesis chunks without losing text', () => {
  const h = loadClient(), text = '长句子'.repeat(300);
  const chunks = h.api.splitSentences(text);
  assert.equal(chunks.join(''), text); assert.ok(chunks.every(chunk => chunk.length <= 120)); h.dispose();
});
