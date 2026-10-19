import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadClient(hooks = {}) {
  let factory;
  const storage = new Map();
  const sandbox = {
    console,
    performance,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    __VC_TEST__: true,
    __VC_TEST_HOOKS__: hooks,
    navigator: {},
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  sandbox.window = {
    __ModuleLoader__: {
      load(definition) { factory = definition.factory; },
    },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    addEventListener() {},
    removeEventListener() {},
  };
  vm.createContext(sandbox);
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  class Component {
    constructor(props) {
      this.props = props;
      this.state = {};
    }
    setState(patch) { this.state = { ...this.state, ...patch }; }
  }
  const React = {
    Component,
    Fragment: Symbol('Fragment'),
    createElement: (...args) => ({ args }),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };
  const plugin = factory((name) => name === 'react' ? React : undefined);
  return { api: sandbox.__vc.test, voice: sandbox.__vc.voice, plugin, sandbox };
}

test('a valid claimed send submits once and a repeated timer cannot submit', () => {
  const { api, voice } = loadClient();
  const submitted = [];
  voice.set({ phase: 'thinking', sessionId: 's1', sessionGen: 1, turnId: 1 });
  api.setOwner({ inputActions: { submit: () => submitted.push('submit') } });
  api.setComposerSnapshot('你好', 'plain');
  const sendId = api.beginPendingSend('你好');
  assert.equal(api.submitPendingSend(sendId), true);
  assert.equal(api.submitPendingSend(sendId), false);
  assert.deepEqual(submitted, ['submit']);
});

test('manual submit invalidates the old countdown without listening again', () => {
  const { api, voice } = loadClient();
  const submitted = [];
  voice.set({ phase: 'thinking', sessionId: 's1', sessionGen: 1, turnId: 1 });
  api.setOwner({ inputActions: { submit: () => submitted.push('submit') } });
  api.setComposerSnapshot('你好', 'plain');
  const sendId = api.beginPendingSend('你好');
  assert.equal(api.cancelPendingSend('manual-submit'), true);
  assert.equal(voice.phase, 'thinking');
  assert.equal(api.submitPendingSend(sendId), false);
  assert.deepEqual(submitted, []);
});

test('editing after arming cancels the old countdown and preserves the draft', () => {
  const { api, voice } = loadClient();
  voice.set({ phase: 'thinking', sessionId: 's1', sessionGen: 1, turnId: 1 });
  api.setOwner({ inputActions: { submit: () => assert.fail('must not submit') } });
  api.setComposerSnapshot('原始识别', 'plain');
  const sendId = api.beginPendingSend('原始识别');
  api.setComposerSnapshot('原始识别，改成手动', 'plain');
  assert.equal(api.cancelPendingSend('draft-changed'), true);
  assert.equal(voice.phase, 'editing');
  assert.equal(api.submitPendingSend(sendId), false);
});

test('clicking cancel pauses auto-send in editing state', () => {
  const { api, voice } = loadClient();
  voice.set({ phase: 'thinking', sessionId: 's1', sessionGen: 1, turnId: 1 });
  api.setOwner({ inputActions: { submit: () => assert.fail('must not submit') } });
  api.setComposerSnapshot('请稍等', 'plain');
  const sendId = api.beginPendingSend('请稍等');
  assert.equal(api.cancelPendingSend('user-cancel'), true);
  assert.equal(voice.phase, 'editing');
  assert.equal(voice.sendPending, false);
  assert.equal(api.submitPendingSend(sendId), false);
});

test('a transcript from an ended session cannot write into the new owner draft', () => {
  const { api, voice } = loadClient();
  const drafts = [];
  voice.set({ phase: 'transcribing', sessionId: 'new', sessionGen: 2, turnId: 4 });
  api.setOwner({
    inputActions: {
      setDraft: (text) => drafts.push(text),
      insertText: () => true,
      captureInsertion: () => null,
    },
    getDraft: () => '',
  });
  assert.equal(api.landTranscript('旧会话文本', 1, 4), false);
  assert.deepEqual(drafts, []);
});

test('a transcript from an old turn in the same session cannot write', () => {
  const { api, voice } = loadClient();
  const drafts = [];
  voice.set({ phase: 'transcribing', sessionId: 'same', sessionGen: 2, turnId: 5 });
  api.setOwner({
    inputActions: {
      setDraft: (text) => drafts.push(text),
      insertText: () => true,
      captureInsertion: () => null,
    },
    getDraft: () => '',
  });
  assert.equal(api.landTranscript('旧轮次文本', 2, 4), false);
  assert.deepEqual(drafts, []);
});

test('a current transcript on an empty draft arms auto-send immediately', () => {
  const { api, voice } = loadClient();
  const drafts = [];
  voice.set({ phase: 'transcribing', sessionId: 'same', sessionGen: 2, turnId: 5 });
  api.setOwner({
    inputActions: {
      setDraft: (text) => drafts.push(text),
      insertText: () => true,
      captureInsertion: () => null,
    },
    getDraft: () => '',
  });
  assert.equal(api.landTranscript('当前文本', 2, 5), true);
  assert.deepEqual(drafts, ['当前文本']);
  assert.equal(voice.phase, 'thinking');
  assert.equal(voice.sendPending, true);
  assert.equal(voice.sendDraft, '当前文本');
});

/** Owner stub mimicking the real store→render→cache pipeline: writes land in
 * `store` synchronously, but `getDraft` reads `cache`, which only catches up
 * when the test flushes a render (exactly the client's draftCache timing). */
function insertPathOwner(store, submitted) {
  return {
    inputActions: {
      setDraft: (text) => { store.value = text; },
      insertText: (text) => { store.value += text; return true; },
      captureInsertion: () => null,
      submit: () => submitted.push('submit'),
    },
    getDraft: () => store.cache,
  };
}

test('insert arms only after the cache refreshes with provably-our write, then submits once', () => {
  const { api, voice } = loadClient();
  const submitted = [];
  const store = { value: '已有草稿', cache: '已有草稿' };
  voice.set({ phase: 'transcribing', sessionId: 's1', sessionGen: 3, turnId: 7 });
  api.setOwner(insertPathOwner(store, submitted));
  assert.equal(api.landTranscript('加语音', 3, 7), true);
  // The cache has not refreshed yet: nothing may be armed from the stale view.
  assert.equal(voice.sendPending, false);
  assert.ok(voice.armPending);
  // Render flushes: the cache catches up and the snapshot is provably our write.
  store.cache = store.value;
  api.handleComposerSnapshot(store.value, 'plain');
  assert.equal(voice.armPending, null);
  assert.equal(voice.sendPending, true);
  assert.equal(voice.sendDraft, '已有草稿加语音');
  assert.equal(api.submitPendingSend(voice.sendId), true);
  assert.equal(api.submitPendingSend(voice.sendId), false);
  assert.deepEqual(submitted, ['submit']);
});

test('a user edit before the write renders rejects the pending arm', () => {
  const { api, voice } = loadClient();
  const submitted = [];
  const store = { value: '已有草稿', cache: '已有草稿' };
  voice.set({ phase: 'transcribing', sessionId: 's1', sessionGen: 3, turnId: 7 });
  api.setOwner(insertPathOwner(store, submitted));
  assert.equal(api.landTranscript('加语音', 3, 7), true);
  // The user types before our write's render flushes: the observed draft is
  // not a pure insertion of our transcript, so auto-send must not arm.
  store.value = '已有草稿用户抢着打字';
  store.cache = store.value;
  api.handleComposerSnapshot(store.value, 'plain');
  assert.equal(voice.armPending, null);
  assert.equal(voice.sendPending, false);
  assert.equal(voice.phase, 'editing');
  assert.equal(api.submitPendingSend(voice.sendId), false);
  assert.deepEqual(submitted, []);
});

test('a user clear before the write renders rejects the pending arm', () => {
  const { api, voice } = loadClient();
  const submitted = [];
  const store = { value: '已有草稿', cache: '已有草稿' };
  voice.set({ phase: 'transcribing', sessionId: 's1', sessionGen: 3, turnId: 7 });
  api.setOwner(insertPathOwner(store, submitted));
  assert.equal(api.landTranscript('加语音', 3, 7), true);
  store.value = '';
  store.cache = '';
  api.handleComposerSnapshot('', 'plain');
  assert.equal(voice.armPending, null);
  assert.equal(voice.sendPending, false);
  assert.equal(voice.phase, 'editing');
  assert.deepEqual(submitted, []);
});

test('manual submit while the arm is pending invalidates it without submitting', () => {
  const { api, voice } = loadClient();
  const submitted = [];
  const store = { value: '已有草稿', cache: '已有草稿' };
  voice.set({ phase: 'transcribing', sessionId: 's1', sessionGen: 3, turnId: 7 });
  api.setOwner(insertPathOwner(store, submitted));
  assert.equal(api.landTranscript('加语音', 3, 7), true);
  store.cache = store.value;
  api.handleComposerSnapshot(store.value, 'submitting');
  assert.equal(voice.armPending, null);
  assert.equal(voice.sendPending, false);
  assert.equal(api.submitPendingSend(voice.sendId), false);
  assert.deepEqual(submitted, []);
});

test('ending and restarting the session invalidates a pending arm', async () => {
  const { api, voice } = loadClient();
  const submitted = [];
  const store = { value: '已有草稿', cache: '已有草稿' };
  voice.set({ phase: 'transcribing', sessionId: 's1', sessionGen: 3, turnId: 7 });
  api.setOwner(insertPathOwner(store, submitted));
  assert.equal(api.landTranscript('加语音', 3, 7), true);
  assert.ok(voice.armPending);
  api.endVoice();
  await api.startVoice({
    sessionId: 's2',
    inputActions: { setDraft() {}, insertText: () => true, captureInsertion: () => null, submit: () => submitted.push('submit') },
    getDraft: () => '',
    useChat: null, useInput: null, useSessions: null,
  });
  // The sandbox has no ASR service, so startVoice flags error.noAsr; force the
  // phase back to a value where an arm could otherwise fire.
  voice.set({ phase: 'thinking' });
  api.handleComposerSnapshot('已有草稿加语音', 'plain');
  assert.equal(voice.armPending, null);
  assert.equal(voice.sendPending, false);
  assert.deepEqual(submitted, []);
});

test('clearing synthesis success does not clear an ASR error', () => {
  const { api, voice } = loadClient();
  api.setScopedError('asr', 'error.asrFailed');
  api.setScopedError('synth', 'error.synthFailed');
  api.clearScopedError('synth');
  assert.equal(voice.errors.asr, 'error.asrFailed');
  assert.equal(voice.errors.synth, '');
  assert.equal(voice.error, 'error.asrFailed');
});

test('retry speaking replays the saved reply without submitting', () => {
  const spoken = [];
  const { api, voice } = loadClient({
    speak: (text) => spoken.push(text),
  });
  const submitted = [];
  api.setOwner({ inputActions: { submit: () => submitted.push('submit') } });
  voice.set({ phase: 'listening', sessionId: 's1', lastReply: { id: 'm1', text: '已有回复' } });
  assert.equal(api.retrySpeaking(), true);
  assert.deepEqual(spoken, ['已有回复']);
  assert.deepEqual(submitted, []);
});

test('stopping Edge playback frees the playback pump for the next reply', async () => {
  const { api, voice, sandbox } = loadClient();
  const played = [];
  sandbox.fetch = async () => ({
    ok: true,
    body: true,
    blob: async () => ({ type: 'audio/mpeg' }),
  });
  sandbox.URL = {
    createObjectURL: () => 'blob:edge-audio',
    revokeObjectURL() {},
  };
  sandbox.Audio = class {
    constructor(url) { this.url = url; }
    async play() { played.push(this.url); }
    pause() { this.paused = true; }
  };
  sandbox.window.localStorage.setItem(
    'dsh-voice-conversation.prefs',
    JSON.stringify({ voiceURI: 'edge:zh-CN-XiaoxiaoNeural' }),
  );
  voice.set({ phase: 'listening', sessionId: 's1' });
  sandbox.__vc.speak('第一句。');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(played, ['blob:edge-audio']);
  assert.equal(api.isSpeaking(), true);
  api.stopSpeaking();
  assert.equal(api.isSpeaking(), false);
});

test('engine labels distinguish cloud Edge from local system speech', () => {
  const { api } = loadClient();
  const edge = api.engineInfo('edge:zh-CN-XiaoxiaoNeural');
  assert.equal(edge.id, 'edge');
  assert.equal(edge.labelZh, '云端 Edge TTS');
  assert.equal(edge.local, false);
  const system = api.engineInfo(undefined);
  assert.equal(system.id, 'system');
  assert.equal(system.labelZh, '本地系统语音');
  assert.equal(system.local, true);
});
