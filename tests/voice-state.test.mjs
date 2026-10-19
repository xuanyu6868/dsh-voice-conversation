import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient, ready, deferred, flush, recordingMocks } from './client-harness.mjs';

const assistant = (id, text) => ({ kind: 'assistant', messageId: id, time: 1, blocks: [{ kind: 'text', text }] });
const chat = (nodes, partial = null) => ({ legacy: { nodes, partial } });

test('ASR transcript is private to voice UI and never reads or writes the normal composer', async () => {
  const h = loadClient(), sent = [];
  await h.api.startVoice({ sessionId: 's1', inputActions: new Proxy({}, { get: () => assert.fail('normal composer touched') }), getDraft: () => assert.fail('draft read'), send: text => sent.push(text) });
  h.voice.set({ phase: 'transcribing', muted: true });
  assert.equal(h.api.landTranscript('你好', h.voice.sessionGen, h.voice.turnId), true);
  assert.equal(h.voice.transcriptDraft, '你好');
  assert.equal(h.voice.sendPending, true);
  assert.equal(await h.api.submitPendingSend(h.voice.sendId), true);
  assert.deepEqual(sent, ['你好']); h.dispose();
});
test('a claimed voice send submits once even if its old timer fires again', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => sent.push(text));
  h.api.landTranscript('开灯', 1, 1); const id = h.voice.sendId;
  assert.equal(await h.api.submitPendingSend(id), true);
  assert.equal(await h.api.submitPendingSend(id), false);
  assert.deepEqual(sent, ['开灯']); h.dispose();
});
test('the actual 1.5s timer submits only a voice-origin transcript', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => sent.push(text));
  h.api.landTranscript('打开灯带', 1, 1);
  await h.fire(1500); assert.deepEqual(sent, ['打开灯带']); h.dispose();
});
test('keyboard edits never arm auto-send or touch a held voice transcript', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => sent.push(text));
  h.api.updateKeyboardDraft('现在几点'); await h.fire(1500);
  assert.equal(h.voice.sendPending, false); assert.deepEqual(sent, []); h.dispose();
});
test('minimizing cancels the countdown and retains the transcript', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => sent.push(text));
  h.api.landTranscript('请稍等', 1, 1); const id = h.voice.sendId;
  h.api.setPageVisible(false); await h.fire(1500);
  assert.equal(await h.api.submitPendingSend(id), false);
  assert.equal(h.voice.transcriptDraft, '请稍等'); assert.deepEqual(sent, []); h.dispose();
});
test('a transcript arriving while minimized does not send, including after expand', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => sent.push(text));
  h.api.setPageVisible(false); h.api.landTranscript('新转写', 1, 1);
  h.api.setPageVisible(true); await h.fire(1500);
  assert.equal(h.voice.sendPending, false); assert.deepEqual(sent, []);
  assert.equal(await h.api.dispatchMessage(h.voice.transcriptDraft, 'asr'), true); h.dispose();
});
test('opening keyboard cancels auto-send and invalidates an in-flight recognition turn', () => {
  const h = loadClient(); ready(h); const gen = h.voice.sessionGen, turn = h.voice.turnId;
  h.voice.set({ requesting: true }); h.api.setKeyboardOpen(true);
  assert.equal(h.voice.requesting, false);
  assert.equal(h.api.landTranscript('旧识别', gen, turn), false); h.dispose();
});
test('editing a transcript moves it into manual keyboard input without auto-send', () => {
  const h = loadClient(); ready(h); h.api.landTranscript('我要修改', 1, 1); h.api.editTranscript();
  assert.equal(h.voice.keyboardOpen, true); assert.equal(h.voice.keyboardDraft, '我要修改');
  assert.equal(h.voice.transcriptDraft, ''); assert.equal(h.voice.sendPending, false); h.dispose();
});
test('cancelled transcript is preserved if listening resumes with another phrase', () => {
  const h = loadClient(); ready(h); h.api.landTranscript('保留这句', 1, 1); h.api.cancelPendingSend();
  h.voice.set({ phase: 'transcribing', turnId: 2 }); h.api.landTranscript('加一句', 1, 2);
  assert.equal(h.voice.transcriptDraft, '保留这句 加一句'); assert.equal(h.voice.sendPending, false); h.dispose();
});
test('symbol-only, zero-width and empty recognition results do not trigger a model turn', () => {
  const h = loadClient(); ready(h);
  for (const value of ['', '。', '…？！', '\u200B。\uFEFF', '🎵', '<|zh|><|NEUTRAL|>。']) {
    h.voice.set({ phase: 'transcribing' }); assert.equal(h.api.landTranscript(value, 1, 1), false);
    assert.equal(h.voice.sendPending, false); assert.equal(h.voice.transcriptDraft, '');
  }
  for (const value of ['好', '对', '不', '1', 'OK']) assert.equal(h.api.meaningfulTranscript(value), value);
  h.dispose();
});
test('late results from an ended session or older turn cannot write', () => {
  const h = loadClient(); ready(h); h.voice.set({ sessionGen: 2, turnId: 5 });
  assert.equal(h.api.landTranscript('旧会话', 1, 5), false);
  assert.equal(h.api.landTranscript('旧轮次', 2, 4), false);
  assert.equal(h.voice.transcriptDraft, ''); h.dispose();
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
test('streaming text renders but is not spoken as a finalized reply', () => {
  const spoken = [], h = loadClient({ hooks: { speak: text => spoken.push(text) } }); ready(h);
  h.api.acceptChatSnapshot(chat([], { turn: 1, step: 1, blocks: [{ kind: 'text', text: '**逐步**出现' }] }));
  assert.equal(h.voice.messages[0].streaming, true); assert.deepEqual(spoken, []); h.dispose();
});
test('model/tool work prevents overlapping sends and keeps waiting until that native run ends', async () => {
  const h = loadClient(); ready(h); h.api.acceptRunning(true);
  assert.equal(await h.api.dispatchMessage('不要插入重复请求'), false);
  h.api.acceptRunning(false); assert.equal(h.voice.awaitingReply, false); h.dispose();
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
test('old recorder stop and data events cannot stop or contaminate the new recording', async () => {
  const mocks = recordingMocks(), h = loadClient({ globals: mocks }); h.api.svc.speech = { transcribe: async () => ({ text: 'unused' }) };
  await h.api.startVoice({ sessionId: 'a', send: async () => {} }); await flush();
  const old = h.api.rec.current;
  const finishing = h.api.finishListening('nospeech', h.voice.sessionGen, h.voice.turnId, old);
  await h.api.startVoice({ sessionId: 'b', send: async () => {} }); await flush();
  const current = h.api.rec.current;
  assert.ok(current && current !== old);
  old.recorder.ondataavailable({ data: new Blob(['old audio']) }); old.recorder.onstop(); await finishing;
  assert.equal(h.api.rec.current, current); assert.equal(current.stream.track.stopped, 0); assert.equal(current.chunks.length, 0); h.dispose();
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
test('playback and native model work pause recording and invalidate old recognition turns', async () => {
  const mocks = recordingMocks(), h = loadClient({ globals: mocks }); h.api.svc.speech = {};
  await h.api.startVoice({ sessionId: 'a', send: async () => {} }); await flush();
  const first = h.api.rec.current, oldTurn = h.voice.turnId;
  h.sandbox.__vc.speak('正在朗读。'); await flush();
  assert.equal(h.api.rec.current, null); assert.ok(first.stream.track.stopped > 0);
  assert.equal(h.api.landTranscript('回声', h.voice.sessionGen, oldTurn), false);
  h.api.stopSpeaking(); h.voice.set({ phase: 'listening' }); await h.api.startListening();
  const second = h.api.rec.current; h.api.acceptRunning(true);
  assert.equal(h.api.rec.current, null); assert.ok(second.stream.track.stopped > 0); assert.equal(h.voice.phase, 'thinking'); h.dispose();
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

test('discarding a transcript cancels its timer without changing the keyboard draft', async () => {
  const h = loadClient(), sent = []; ready(h, 's1', text => sent.push(text));
  h.api.updateKeyboardDraft('保留键盘草稿'); h.api.landTranscript('丢弃识别', 1, 1);
  h.api.discardTranscript(); await h.fire(1500);
  assert.equal(h.voice.transcriptDraft, ''); assert.equal(h.voice.keyboardDraft, '保留键盘草稿'); assert.deepEqual(sent, []); h.dispose();
});

test('a long unpunctuated reply is bounded into synthesis chunks without losing text', () => {
  const h = loadClient(), text = '长句子'.repeat(300);
  const chunks = h.api.splitSentences(text);
  assert.equal(chunks.join(''), text); assert.ok(chunks.every(chunk => chunk.length <= 120)); h.dispose();
});
