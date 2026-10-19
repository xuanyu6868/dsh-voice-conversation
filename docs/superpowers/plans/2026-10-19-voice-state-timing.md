# Voice State Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix voice auto-send cancellation semantics, stale async callbacks, scoped error recovery, and engine labeling without changing the working ASR/TTS engines or adding latency.

**Architecture:** Keep the existing single-file browser client and add small module-level state helpers inside `client.js`. Use a session generation, turn id, and claimed send id to reject stale work at the last responsible moment. Add a Node VM-based test harness that loads the real `client.js` with browser and React stubs; test-only helpers are exposed only when `globalThis.__VC_TEST__ === true`.

**Tech Stack:** Browser JavaScript, React external-store hooks, Node.js built-in `node:test`, `node:assert/strict`, and `node:vm`.

**Spec:** `docs/superpowers/specs/2026-10-18-voice-state-timing-design.md`

## Global Constraints

- Do not modify `host.mjs`, SenseVoice, Edge TTS, MiniMax, or VAD constants.
- Do not add network requests, recognition waits, synthesis waits, or continuous recording during playback.
- Preserve `SEND_DELAY_MS = 1500`, `VAD_STOP_MS = 1300`, and `VAD_MAX_MS = 30000`.
- Preserve the existing one-sentence Edge prefetch; cancellation must abort it and stale prefetch results must never play.
- Do not initialize a Git repository; checkpoints are command outputs because this directory is not under Git.
- Production must not expose new test controls; test helpers exist only under `globalThis.__VC_TEST__ === true`.

## File Structure

- Modify `client.js`: locale text, voice state fields, pending-send helpers, turn guards, scoped errors, retry actions, engine labels, and editing-state UI.
- Create `tests/voice-state.test.mjs`: VM loader plus focused timing and state tests.
- Modify `locale/zh.json` and `locale/en.json`: plugin metadata now mentions cloud Edge and local system voices instead of the deleted GPT-SoVITS option.
- Modify `HANDOFF.md`: final verified implementation and test results.

---

### Task 1: Node Test Harness and Pending-Send Red Tests

**Files:**
- Create: `tests/voice-state.test.mjs`

**Interfaces:**
- Consumes: existing `client.js` module-loader factory.
- Produces for Task 2:
  - `loadClient(hooks?)`
  - test API expectations:
    - `beginPendingSend(draft: string): number`
    - `cancelPendingSend(reason: 'user-cancel' | 'draft-changed' | 'manual-submit'): boolean`
    - `submitPendingSend(sendId: number): boolean`
    - `setComposerSnapshot(draft: string, phase: string): void`
    - `setOwner(owner: object | null): void`

- [x] **Step 1: Create the VM test loader and red pending-send tests**

```js
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
  const React = {
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
```

- [x] **Step 2: Run the red tests**

Run: `node --test tests/voice-state.test.mjs`  
Expected: FAIL because `sandbox.__vc.test` and the four pending-send helpers do not exist yet.

- [x] **Step 3: Checkpoint**

Run: `node --check client.js`  
Expected: PASS. Keep the failing test output as the red-test record.

---

### Task 2: Pending-Send State Machine and Editing UI

**Files:**
- Modify: `client.js`
- Test: `tests/voice-state.test.mjs`

**Interfaces:**
- Consumes: Task 1 test API expectations.
- Produces for Task 3:
  - `voice.sessionGen: number`
  - `voice.turnId: number`
  - `voice.sendId: number`
  - `voice.sendDraft: string`
  - `voice.sendSessionGen: number`
  - `voice.sendTurnId: number`
  - `voice.sendConsumed: boolean`
  - `voice.transcriptDraft: string`
  - `resumeListening(): void`
  - internal `discardPendingSend(reason: string): void` for session start/end invalidation

- [x] **Step 1: Add locale and state fields**

Add these keys to both inline dictionaries:

```js
'state.editing': '已暂停自动发送',
'page.hint.editing': '文字已保留；可编辑后手动发送，或继续聆听',
'action.resumeListening': '继续聆听',
'action.retrySpeak': '重试朗读',
```

English equivalents are `Auto-send paused`, `Text is kept; edit and send it manually, or resume listening`, `Resume listening`, and `Retry speaking`.

Extend `voice` with:

```js
sessionGen: 0,
turnId: 0,
sendId: 0,
sendDraft: '',
sendSessionGen: 0,
sendTurnId: 0,
sendConsumed: true,
composerDraft: '',
composerPhase: 'plain',
transcriptDraft: '',
lastReply: null,
```

- [x] **Step 2: Implement pending-send helpers**

```js
function beginPendingSend(draft) {
  voice.sendId += 1;
  voice.sendDraft = draft;
  voice.sendSessionGen = voice.sessionGen;
  voice.sendTurnId = voice.turnId;
  voice.sendConsumed = false;
  voice.set({ sendPending: true });
  flowLog('send.armed', 'id=' + voice.sendId);
  return voice.sendId;
}

function cancelPendingSend(reason) {
  if (!voice.sendPending && voice.sendConsumed) return false;
  voice.sendConsumed = true;
  voice.turnId += 1;
  voice.set({ sendPending: false });
  if (reason === 'manual-submit') {
    voice.set({ phase: 'thinking' });
  } else {
    voice.set({ phase: 'editing' });
  }
  flowLog('send.cancel', reason + ' id=' + voice.sendId);
  return true;
}

function discardPendingSend(reason) {
  if (!voice.sendPending && voice.sendConsumed) return;
  voice.sendConsumed = true;
  voice.turnId += 1;
  voice.set({ sendPending: false });
  flowLog('send.discard', reason + ' id=' + voice.sendId);
}

function submitPendingSend(sendId) {
  if (!voice.sendPending || voice.sendConsumed || voice.sendId !== sendId) return false;
  voice.sendConsumed = true;
  voice.set({ sendPending: false });
  const owner = voice.owner;
  const valid = owner
    && voice.sendSessionGen === voice.sessionGen
    && voice.sendTurnId === voice.turnId
    && voice.composerPhase === 'plain'
    && voice.composerDraft === voice.sendDraft;
  if (!valid) {
    flowLog('send.skipped', 'id=' + sendId);
    if (voice.phase !== 'off') voice.set({ phase: 'editing' });
    return false;
  }
  voice.turnId += 1;
  voice.set({ phase: 'thinking', transcriptDraft: '' });
  flowLog('send.submit', 'id=' + sendId);
  owner.inputActions.submit();
  return true;
}
```

- [x] **Step 3: Rewire `VoiceEffectsInner`**

Replace the auto-send effect with this behavior:

```js
voice.composerDraft = draft;
voice.composerPhase = composerPhase;

useEffect(() => {
  if (!active) return;
  if (composerPhase !== 'plain') {
    if (voice.sendPending) cancelPendingSend('manual-submit');
    else if (voice.phase === 'editing') voice.set({ phase: 'thinking' });
    return;
  }
  if (voice.sendPending && draft !== voice.sendDraft) {
    cancelPendingSend('draft-changed');
    return;
  }
  if (!voice.sendPending
    && voice.phase === 'thinking'
    && voice.transcriptDraft
    && draft === voice.transcriptDraft) {
    beginPendingSend(draft);
  }
}, [draft, composerPhase, active]);

useEffect(() => {
  if (!voice.sendPending || !active) return undefined;
  const sendId = voice.sendId;
  const timer = setTimeout(() => submitPendingSend(sendId), SEND_DELAY_MS);
  return () => clearTimeout(timer);
}, [voice.sendPending, voice.sendId, active]);
```

Rename the composer selector variable from `phase` to `composerPhase` to avoid confusion with `voice.phase`.

- [x] **Step 4: Add resume-listening UI**

Implement:

```js
function resumeListening() {
  if (voice.phase === 'off' || !voice.owner) return;
  voice.set({ phase: 'listening', transcriptDraft: '' });
  maybeListen();
}
```

Show a `继续聆听` button in the minibar and full voice page when `voice.phase === 'editing'`. Reuse `MicIcon`, keep the existing end button unchanged, and update `stateText()` / `hintText()` for `editing`.

- [x] **Step 5: Expose the test-only API**

Replace the debug handle with:

```js
const testApi = globalThis.__VC_TEST__ === true ? {
  voice,
  beginPendingSend,
  cancelPendingSend,
  submitPendingSend,
  resumeListening,
  setComposerSnapshot(draft, phase) {
    voice.composerDraft = draft;
    voice.composerPhase = phase;
  },
  setOwner(owner) { voice.owner = owner; },
} : null;
globalThis.__vc = { voice, speak, ...(testApi ? { test: testApi } : {}) };
```

- [x] **Step 6: Run tests and syntax check**

Run: `node --test tests/voice-state.test.mjs`  
Expected: PASS for the four pending-send tests.

Run: `node --check client.js`  
Expected: PASS.

---

### Task 3: Session and Turn Guards

**Files:**
- Modify: `client.js`
- Test: `tests/voice-state.test.mjs`

**Interfaces:**
- Consumes: `voice.sessionGen`, `voice.turnId`, `voice.transcriptDraft` from Task 2.
- Produces:
  - `isCurrentTurn(sessionGen: number, turnId: number): boolean`
  - `landTranscript(text: string, sessionGen: number, turnId: number): boolean`
  - test API additions `isCurrentTurn` and `landTranscript`

- [x] **Step 1: Add red stale-turn tests**

```js
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

test('a current transcript writes once and records the exact draft for auto-send', () => {
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
  assert.equal(voice.transcriptDraft, '当前文本');
  assert.equal(voice.phase, 'thinking');
});
```

- [x] **Step 2: Run red tests**

Run: `node --test tests/voice-state.test.mjs`  
Expected: FAIL because `landTranscript` is not exposed and stale turns are not guarded.

- [x] **Step 3: Implement turn helpers and draft landing**

```js
function isCurrentTurn(sessionGen, turnId) {
  return !!voice.sessionId
    && voice.sessionGen === sessionGen
    && voice.turnId === turnId;
}

function landTranscript(text, sessionGen, turnId) {
  if (!text || !voice.owner || !isCurrentTurn(sessionGen, turnId)) return false;
  const { inputActions, getDraft } = voice.owner;
  const draft = getDraft();
  const panel = svc.layout && svc.layout.panelInfo
    ? svc.layout.panelInfo.getSnapshot().activePanelId : null;
  const composerMounted = panel !== PANEL_ID;
  const nextDraft = !draft.trim() ? text : (composerMounted ? '' : draft + ' ' + text);
  let landed = false;
  if (!draft.trim()) {
    inputActions.setDraft(text);
    landed = true;
  } else if (composerMounted) {
    landed = inputActions.insertText(text, inputActions.captureInsertion());
  } else {
    inputActions.setDraft(nextDraft);
    landed = true;
  }
  if (!landed || !isCurrentTurn(sessionGen, turnId)) return false;
  const finalDraft = composerMounted && draft.trim() ? getDraft() : nextDraft;
  flowLog('draft.write', 'chars=' + text.length);
  pushSubtitle('you', text);
  voice.set({ phase: 'thinking', transcriptDraft: finalDraft });
  return true;
}
```

- [x] **Step 4: Guard microphone and transcription callbacks**

Increment `sessionGen` in `startVoice()` and `endVoice()`, and call `discardPendingSend('session-start')` or `discardPendingSend('session-end')` there. Increment `turnId` when a real recorder starts and whenever a pending send is canceled, discarded, or consumed.

In `startListening()`, capture `sessionGen` and the new `turnId`; after `getUserMedia()`, stop tracks and return unless `isCurrentTurn(sessionGen, turnId)` and `voice.phase === 'listening'`.

In `finishListening()`, capture the same ids and check them:

- before decoding the recorded blob,
- before `speechNs().transcribe(...)`,
- after transcription returns,
- before calling `landTranscript(text, sessionGen, turnId)`.

Add `landTranscript`, `isCurrentTurn`, and `resumeListening` to the test-only API.

- [x] **Step 5: Run tests and syntax check**

Run: `node --test tests/voice-state.test.mjs`  
Expected: PASS for pending-send and stale-turn tests.

Run: `node --check client.js`  
Expected: PASS.

---

### Task 4: Scoped Errors and Recovery Actions

**Files:**
- Modify: `client.js`
- Test: `tests/voice-state.test.mjs`

**Interfaces:**
- Consumes: `resumeListening()` and `voice.lastReply` from Tasks 2 and 3.
- Produces:
  - `setScopedError(scope: 'mic' | 'asr' | 'draft' | 'synth', key: string): void`
  - `clearScopedError(scope: 'mic' | 'asr' | 'draft' | 'synth'): void`
  - `retryMic(): void`
  - `retrySpeaking(): boolean`

- [x] **Step 1: Add red scoped-error tests**

```js
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
```

- [x] **Step 2: Run red tests**

Run: `node --test tests/voice-state.test.mjs`  
Expected: FAIL because scoped error helpers and `retrySpeaking()` do not exist.

- [x] **Step 3: Implement scoped errors**

Add to `voice`:

```js
errors: { mic: '', asr: '', draft: '', synth: '' },
errorScope: '',
errorVersion: 0,
```

Implement:

```js
function firstScopedError(errors) {
  for (const scope of ['mic', 'asr', 'draft', 'synth']) {
    if (errors[scope]) return scope;
  }
  return '';
}

function setScopedError(scope, key) {
  voice.errors = { ...voice.errors, [scope]: key };
  voice.errorScope = scope;
  voice.set({ error: key, errorVersion: voice.errorVersion + 1 });
}

function clearScopedError(scope) {
  if (!voice.errors[scope]) return;
  voice.errors = { ...voice.errors, [scope]: '' };
  const nextScope = firstScopedError(voice.errors);
  voice.errorScope = nextScope;
  voice.set({ error: nextScope ? voice.errors[nextScope] : '', errorVersion: voice.errorVersion + 1 });
}
```

Replace global error writes:

- microphone permission/device failure -> `setScopedError('mic', 'error.micDenied')`
- missing ASR -> `setScopedError('asr', 'error.noAsr')`
- transcription failure -> `setScopedError('asr', 'error.asrFailed')`
- draft write failure -> `setScopedError('draft', 'error.draftBusy')`
- synthesis/playback failure -> `setScopedError('synth', 'error.synthFailed')`
- successful microphone start -> `clearScopedError('mic')`
- successful transcription -> `clearScopedError('asr')`
- successful draft write -> `clearScopedError('draft')`
- playback start -> `clearScopedError('synth')`

`startVoice()` and `endVoice()` reset all scoped errors. `toggleMute()` clears only `mic`.

- [x] **Step 4: Implement recovery actions and UI**

```js
function retryMic() {
  clearScopedError('mic');
  voice.set({ phase: 'listening' });
  maybeListen();
}

function retrySpeaking() {
  const reply = voice.lastReply;
  if (!reply || !reply.text) return false;
  clearScopedError('synth');
  const speakFn = globalThis.__VC_TEST_HOOKS__ && globalThis.__VC_TEST_HOOKS__.speak;
  (typeof speakFn === 'function' ? speakFn : speak)(reply.text, null, null, { source: 'reply', id: reply.id });
  return true;
}
```

Extend `speak()` with an optional fourth `options` parameter and store reply text only for `{ source: 'reply' }`. Auto-read calls use that option; preview and per-message actions do not change `lastReply`.

Show `重试朗读` when `voice.errors.synth` is non-empty. Show the existing retry button for `phase === 'error'`, but route it to `retryMic()` rather than rebuilding the session.

- [x] **Step 5: Run tests and syntax check**

- [x] **Step 6: Add and fix the Edge playback-pump regression test**

Added the regression test `stopping Edge playback frees the playback pump for the next reply`; it failed with `true !== false`, then passed after `stopSpeaking()` released `gsvPlaying` and stale playback generations stopped completing late.

Run: `node --test tests/voice-state.test.mjs`  
Expected: PASS for all state, stale-turn, and scoped-error tests.

Run: `node --check client.js`  
Expected: PASS.

---

### Task 5: Engine Labels, Metadata, and Verification

**Files:**
- Modify: `client.js`
- Modify: `locale/zh.json`
- Modify: `locale/en.json`
- Modify: `HANDOFF.md`

**Interfaces:**
- Consumes: existing `loadPrefs().voiceURI`.
- Produces:
  - `engineInfo(voiceURI: string | undefined): { id: 'edge' | 'gsv' | 'system' | 'minimax', labelZh: string, local: boolean }`

- [x] **Step 1: Implement one engine-label source**

```js
function engineInfo(voiceURI) {
  if (voiceURI === GSV_VOICE) return { id: 'gsv', labelZh: '本地 GPT-SoVITS', local: true };
  if ((voiceURI || '').startsWith('edge:')) return { id: 'edge', labelZh: '云端 Edge TTS', local: false };
  if (voiceURI === 'minimax') return { id: 'minimax', labelZh: '云端 MiniMax', local: false };
  return { id: 'system', labelZh: '本地系统语音', local: true };
}
```

Use `engineInfo(loadPrefs().voiceURI).id` in the `voice.start` flow log and `engineInfo(...).labelZh` in the settings advanced section. Do not add polling.

- [x] **Step 2: Update plugin metadata**

Change both locale metadata descriptions to say that replies can be read by cloud Edge TTS or local system voices. Remove wording that presents deleted GPT-SoVITS as a current option.

- [x] **Step 3: Run complete automated checks**

Run:

```bash
node --test tests/voice-state.test.mjs
node --check client.js
node --check impl.mjs
```

Expected: all PASS.

- [ ] **Step 4: Capture performance evidence**

Before modifying `HANDOFF.md`, inspect `~/.dsh/edge-tts/voice-flow.log` for post-change entries. Record only events produced after the plugin reload. Compare available `asr.result`, `synth.stream-start`, `play.start`, `send.armed`, `send.submit`, `send.cancel`, and `send.skipped` lines with the pre-change baseline already present in the log. Do not claim UI visual verification unless a real view inspection was possible.

- [x] **Step 5: Update `HANDOFF.md`**

Add a final implementation table with these columns:

```markdown
| 改动 | 文件 | 行为变化 | 验证 | 性能影响 |
```

Mark dark mode and narrow layout as `未验收` unless they were actually inspected. Mark MiniMax as `未实测`. Include exact test commands and log evidence.

- [x] **Step 6: Final checkpoint**

Run:

```bash
node --test tests/voice-state.test.mjs
node --check client.js
node --check impl.mjs
```

Expected: all PASS after documentation updates.
