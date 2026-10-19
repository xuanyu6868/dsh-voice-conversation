/**
 * Voice conversation companion for the official voice-input bundle, browser
 * half. A persistent voice session bound to one chat session: hands-free loop
 * (record → silence auto-stop → transcribe → auto-send → replies read aloud in
 * order → listen again), a full voice page (main panel 'voice'), a
 * minimized bar (conversation.input.dock), and a start entry in
 * conversation.input.right. The VoiceSession module below owns the mic,
 * recorder, playback queue, timers and session binding; every view renders
 * from it, so switching views never tears down the session.
 * @module @local/voice-conversation/client
 */
window.__ModuleLoader__.load({
  id: '@local/voice-conversation',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React;

    /* ------------------------------------------------------------------ */
    /* Locale                                                              */
    /* ------------------------------------------------------------------ */

    const NS = 'voice-conversation';
    const zh = {
      'start.begin': '开始语音对话',
      'start.return': '返回语音',
      'start.rebind': '另一会话的语音将结束，在这里开始新语音',
      'view.tab': '语音',
      'page.title': '语音对话',
      'page.minimize': '返回聊天',
      'page.settings': '语音设置',
      'page.hint.listening': '直接说话，停顿后自动发送',
      'page.hint.muted': '已静音，取消静音后继续',
      'page.hint.editing': '文字已保留；可编辑后手动发送，或继续聆听',
      'page.hint.default': '语音内容保留在当前会话中',
      'state.connecting': '正在连接…',
      'state.listening': '正在聆听',
      'state.transcribing': '正在识别…',
      'state.thinking': '正在思考…',
      'state.speaking': '正在回答',
      'state.muted': '麦克风已静音',
      'state.error': '连接失败',
      'state.editing': '已暂停自动发送',
      'state.off': '语音未开启',
      'state.requesting': '请求麦克风权限…',
      'action.mute': '静音',
      'action.unmute': '取消静音',
      'action.end': '结束语音',
      'action.captions': '字幕',
      'action.stopSpeaking': '停止回答',
      'action.retry': '重试',
      'action.resumeListening': '继续聆听',
      'action.retrySpeak': '重试朗读',
      'action.expand': '展开语音页',
      'action.cancelSend': '取消自动发送',
      'action.backToVoice': '返回语音会话',
      'action.speak': '朗读',
      'mini.foreign': '语音会话进行中（另一会话）',
      'settings.title': '语音设置',
      'settings.voice': '音色',
      'settings.rate': '语速',
      'settings.device': '输入设备',
      'settings.deviceDefault': '系统默认麦克风',
      'settings.preview': '试听',
      'settings.sample': '你好，这是语音对话的试听。',
      'settings.advanced': '高级',
      'settings.engine': '合成引擎',
      'settings.engineState': '克隆服务状态',
      'settings.asr': '识别服务',
      'settings.asrReady': '可用（本地 SenseVoice）',
      'settings.asrMissing': '不可用',
      'settings.vadNote': '停顿 1.3 秒自动发送；单次最长录音 30 秒',
      'settings.gsvOff': '未启动',
      'settings.gsvStarting': '启动中…',
      'settings.gsvReady': '就绪',
      'settings.gsvOption': '本地克隆（GPT-SoVITS）',
      'settings.sysAuto': '系统：自动（中文优先）',
      'captions.you': '你',
      'captions.assistant': '助手',
      'captions.empty': '字幕会显示在这里',
      'captions.backToLatest': '回到最新',
      'error.micDenied': '麦克风不可用或权限被拒绝',
      'error.noAsr': '识别服务不可用',
      'error.asrFailed': '识别失败，已继续聆听',
      'error.gsvFailed': '克隆服务启动失败',
      'error.draftBusy': '输入框有未发送内容，转写未写入',
      'error.synthFailed': '语音合成失败',
      'send.pending': '即将自动发送',
    };
    const en = {
      'start.begin': 'Start voice chat',
      'start.return': 'Return to voice',
      'start.rebind': "End the other chat's voice and start here",
      'view.tab': 'Voice',
      'page.title': 'Voice chat',
      'page.minimize': 'Back to chat',
      'page.settings': 'Voice settings',
      'page.hint.listening': 'Just speak; a pause sends it',
      'page.hint.muted': 'Muted; unmute to continue',
      'page.hint.editing': 'Text is kept; edit and send it manually, or resume listening',
      'page.hint.default': 'Voice stays in this conversation',
      'state.connecting': 'Connecting…',
      'state.listening': 'Listening',
      'state.transcribing': 'Transcribing…',
      'state.thinking': 'Thinking…',
      'state.speaking': 'Answering',
      'state.muted': 'Microphone muted',
      'state.error': 'Connection failed',
      'state.editing': 'Auto-send paused',
      'state.off': 'Voice off',
      'state.requesting': 'Requesting microphone…',
      'action.mute': 'Mute',
      'action.unmute': 'Unmute',
      'action.end': 'End voice',
      'action.captions': 'Captions',
      'action.stopSpeaking': 'Stop answering',
      'action.retry': 'Retry',
      'action.resumeListening': 'Resume listening',
      'action.retrySpeak': 'Retry speaking',
      'action.expand': 'Expand voice page',
      'action.cancelSend': 'Cancel auto-send',
      'action.backToVoice': 'Back to the voice session',
      'action.speak': 'Read aloud',
      'mini.foreign': 'Voice session active (another chat)',
      'settings.title': 'Voice settings',
      'settings.voice': 'Voice',
      'settings.rate': 'Speed',
      'settings.device': 'Input device',
      'settings.deviceDefault': 'System default microphone',
      'settings.preview': 'Preview',
      'settings.sample': 'Hello, this is a voice conversation preview.',
      'settings.advanced': 'Advanced',
      'settings.engine': 'Speech engine',
      'settings.engineState': 'Clone service',
      'settings.asr': 'Recognition',
      'settings.asrReady': 'Available (local SenseVoice)',
      'settings.asrMissing': 'Unavailable',
      'settings.vadNote': 'A 1.3s pause auto-sends; recordings cap at 30s',
      'settings.gsvOff': 'Not running',
      'settings.gsvStarting': 'Starting…',
      'settings.gsvReady': 'Ready',
      'settings.gsvOption': 'Local clone (GPT-SoVITS)',
      'settings.sysAuto': 'System: auto (Chinese first)',
      'captions.you': 'You',
      'captions.assistant': 'Assistant',
      'captions.empty': 'Captions appear here',
      'captions.backToLatest': 'Back to latest',
      'error.micDenied': 'Microphone unavailable or permission denied',
      'error.noAsr': 'Recognition service unavailable',
      'error.asrFailed': 'Transcription failed; still listening',
      'error.gsvFailed': 'Clone service failed to start',
      'error.draftBusy': 'Draft has unsent text; transcript not written',
      'error.synthFailed': 'Speech synthesis failed',
      'send.pending': 'Sending soon',
    };

    /* ------------------------------------------------------------------ */
    /* Constants and preferences                                           */
    /* ------------------------------------------------------------------ */

    const TTS_OK = typeof window !== 'undefined' && 'speechSynthesis' in window
      && typeof window.SpeechSynthesisUtterance === 'function';
    const REC_OK = typeof navigator !== 'undefined'
      && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      && typeof MediaRecorder !== 'undefined'
      && typeof AudioContext !== 'undefined';

    const GSV_VOICE = 'gsv-local';
    const ROUTE_TTS = '/voice-tts/tts';
    const ROUTE_CONTROL = '/voice-tts/control';

    const SEND_DELAY_MS = 1500;
    const MAX_SPEAK_CHARS = 4000;
    const PREFS_KEY = 'dsh-voice-conversation.prefs';
    const RATES = ['0.75', '1', '1.25', '1.5', '2'];

    /** Cloud voices served by the local Edge TTS bridge (engine 'edge'). */
    const EDGE_VOICES = [
      ['edge:zh-CN-XiaoxiaoNeural', '云端·小晓（女）'],
      ['edge:zh-CN-YunxiNeural', '云端·云希（男）'],
      ['edge:zh-CN-YunyangNeural', '云端·云扬（男）'],
      ['edge:zh-CN-XiaoyiNeural', '云端·小艺（女）'],
      ['edge:zh-CN-YunjianNeural', '云端·云健（男）'],
    ];

    const VAD_START_RMS = 0.015;
    const VAD_START_MS = 250;
    const VAD_STOP_RMS = 0.008;
    const VAD_STOP_MS = 1300;
    const VAD_MAX_MS = 30000;
    const VAD_NOSPEECH_MS = 12000;

    function loadPrefs() {
      if (typeof window === 'undefined') return {};
      try { return JSON.parse(window.localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
    }

    function savePrefs(patch) {
      const next = { ...loadPrefs(), ...patch };
      try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    }

    /* ---------- flow logging: every checkpoint lands in voice-flow.log ---------- */

    const flowBuffer = [];
    let flowTimer = null;
    function flowLog(tag, detail) {
      flowBuffer.push(`${new Date().toISOString()} ${tag}${detail ? ' ' + detail : ''}`);
      if (/error|fail/.test(tag)) flushFlow();
      else if (flowTimer === null && typeof window !== 'undefined') {
        flowTimer = setTimeout(flushFlow, 1000);
      }
    }
    function flushFlow() {
      if (flowTimer !== null) { clearTimeout(flowTimer); flowTimer = null; }
      if (!flowBuffer.length) return;
      const lines = flowBuffer.splice(0, flowBuffer.length);
      try {
        fetch(ROUTE_CONTROL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'flow', lines }),
        }).catch(() => {});
      } catch { /* logging must never break the flow */ }
    }

    /** Latest rendered draft per session. Selector hooks (useInput) are legal
     * only during render, so async readers (transcription completion) read
     * this cache instead of calling the hook — calling it off-render throws
     * React #321 and used to surface as a bogus "transcription failed". */
    const draftCache = new Map();

    function speakable(text) {
      return text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/\|/g, ' ')
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '')
        .replace(/[*_~]/g, '')
        .replace(/\n{2,}/g, '。')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_SPEAK_CHARS);
    }

    function splitSentences(text) {
      const parts = text.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [text];
      const chunks = [];
      let buf = '';
      for (const part of parts) {
        if (buf.length + part.length > 120 && buf) { chunks.push(buf); buf = ''; }
        buf += part;
      }
      if (buf.trim()) chunks.push(buf);
      return chunks.map(c => c.trim()).filter(Boolean);
    }

    function pickVoice(voiceURI) {
      if (!TTS_OK) return null;
      const voices = window.speechSynthesis.getVoices();
      if (voiceURI) {
        const saved = voices.find(v => v.voiceURI === voiceURI);
        if (saved) return saved;
      }
      return voices.find(v => v.lang === 'zh-CN')
        || voices.find(v => /^zh([-_]|$)/i.test(v.lang))
        || null;
    }

    function engineInfo(voiceURI) {
      if (voiceURI === GSV_VOICE) return { id: 'gsv', labelZh: '本地 GPT-SoVITS', local: true };
      if ((voiceURI || '').startsWith('edge:')) return { id: 'edge', labelZh: '云端 Edge TTS', local: false };
      if (voiceURI === 'minimax') return { id: 'minimax', labelZh: '云端 MiniMax', local: false };
      return { id: 'system', labelZh: '本地系统语音', local: true };
    }

    /* ------------------------------------------------------------------ */
    /* VoiceSession: the one owner of mic, recorder, playback and binding  */
    /* ------------------------------------------------------------------ */

    const voice = {
      /** off | connecting | listening | transcribing | thinking | speaking | editing | error */
      phase: 'off',
      sessionId: null,
      owner: null, // { inputActions, getDraft } of the bound session
      muted: false,
      requesting: false,
      error: '', // locale key
      errors: { mic: '', asr: '', draft: '', synth: '' },
      errorScope: '',
      errorVersion: 0,
      captionsOn: !!loadPrefs().captions,
      settingsOpen: false,
      subtitles: [],
      level: 0,
      speakingText: '',
      spokenId: null,
      sendPending: false,
      sessionGen: 0,
      turnId: 0,
      sendId: 0,
      sendDraft: '',
      sendSessionGen: 0,
      sendTurnId: 0,
      sendConsumed: true,
      sendOwner: null,
      armPending: null, // { sessionGen, turnId, owner, before, inserted }
      composerDraft: '',
      composerPhase: 'plain',
      lastReply: null,
      startedAt: 0,
      listeners: new Set(),
      notify() { for (const fn of [...this.listeners]) fn(); },
      subscribe(fn) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; },
      set(patch) { Object.assign(this, patch); this.notify(); },
    };

    function beginPendingSend(draft) {
      voice.sendId += 1;
      voice.sendDraft = draft;
      voice.sendSessionGen = voice.sessionGen;
      voice.sendTurnId = voice.turnId;
      voice.sendOwner = voice.owner;
      voice.sendConsumed = false;
      voice.set({ sendPending: true });
      flowLog('send.armed', 'id=' + voice.sendId);
      return voice.sendId;
    }

    function cancelPendingSend(reason) {
      if (!voice.sendPending && voice.sendConsumed) return false;
      voice.armPending = null;
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
      voice.armPending = null;
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
        && owner === voice.sendOwner
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
      voice.set({ phase: 'thinking' });
      flowLog('send.submit', 'id=' + sendId);
      owner.inputActions.submit();
      return true;
    }

    /** True iff `current` is exactly `before` with `inserted` spliced in at one
     * offset — the observed draft is provably our own write, not a user edit
     * that merely happened to land in the same window. */
    function isPureInsertion(before, inserted, current) {
      if (!inserted) return current === before;
      if (current.length !== before.length + inserted.length) return false;
      for (let i = current.indexOf(inserted); i !== -1; i = current.indexOf(inserted, i + 1)) {
        if (current.slice(0, i) + current.slice(i + inserted.length) === before) return true;
      }
      return false;
    }

    /** Single entry for every composer snapshot; the effect is a thin adapter.
     * Resolves a pending voice-write arm (armPending), cancels an armed
     * countdown on any later draft change, and invalidates both whenever the
     * composer leaves 'plain' (manual submit) or the binding goes stale. */
    function handleComposerSnapshot(draft, composerPhase) {
      voice.composerDraft = draft;
      voice.composerPhase = composerPhase;
      if (voice.phase === 'off') return;
      if (composerPhase !== 'plain') {
        if (voice.armPending) {
          flowLog('send.arm-invalidated', 'composer-busy');
          voice.armPending = null;
        }
        if (voice.sendPending) cancelPendingSend('manual-submit');
        else if (voice.phase === 'editing') voice.set({ phase: 'thinking' });
        return;
      }
      const pending = voice.armPending;
      if (pending) {
        const bound = pending.sessionGen === voice.sessionGen
          && pending.turnId === voice.turnId
          && pending.owner === voice.owner;
        if (bound && isPureInsertion(pending.before, pending.inserted, draft)) {
          voice.armPending = null;
          beginPendingSend(draft);
        } else {
          voice.armPending = null;
          flowLog(bound ? 'send.arm-rejected' : 'send.arm-invalidated', bound ? 'not-our-write' : 'stale-binding');
          if (voice.phase === 'thinking') voice.set({ phase: 'editing' });
        }
        return;
      }
      if (voice.sendPending && draft !== voice.sendDraft) {
        cancelPendingSend('draft-changed');
      }
    }

    function resumeListening() {
      if (voice.phase === 'off' || !voice.owner) return;
      voice.armPending = null;
      voice.set({ phase: 'listening' });
      maybeListen();
    }

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

    function resetScopedErrors() {
      voice.errors = { mic: '', asr: '', draft: '', synth: '' };
      voice.errorScope = '';
      voice.set({ error: '', errorVersion: voice.errorVersion + 1 });
    }

    /** Injected client services, captured once in apply. */
    const svc = { remoteRoot: null, speech: null, layout: null, uiWorkspace: null };
    function speechNs() {
      return svc.speech || null;
    }

    const PANEL_ID = 'voice';
    function openVoicePage() {
      try {
        if (svc.layout && typeof svc.layout.selectPanel === 'function') svc.layout.selectPanel(PANEL_ID);
        else reportClientError('openVoicePage: layout service unavailable', '');
      } catch (error) {
        reportClientError('openVoicePage: ' + String((error && error.message) || error), error && error.stack);
      }
    }
    function closeVoicePage() {
      try {
        const layout = svc.layout;
        if (layout && typeof layout.selectPanel === 'function'
          && layout.panelInfo && layout.panelInfo.getSnapshot().activePanelId === PANEL_ID) {
          layout.selectPanel(null);
        }
      } catch (error) {
        reportClientError('closeVoicePage: ' + String((error && error.message) || error), error && error.stack);
      }
    }

    function openBoundSession() {
      try {
        if (svc.uiWorkspace && voice.sessionId) svc.uiWorkspace.openSession(voice.sessionId);
      } catch { /* navigation is best-effort */ }
    }

    /* ---------- speech output ---------- */

    const gsvQueue = [];
    let gsvPlaying = false;
    let gsvAudio = null;
    const streamCtl = { reader: null, sources: [], cancelled: false };
    let synthSpeaking = false;

    /** Bumped by stopSpeaking(): in-flight synthesis/playback from an older
     * generation must never start playing after the user stopped or ended. */
    let playbackGen = 0;

    const sysQueue = [];
    let sysActive = false;

    function isSpeaking() {
      return gsvPlaying || gsvQueue.length > 0 || synthSpeaking;
    }

    function pushSubtitle(who, text) {
      const clean = text.trim();
      if (!clean) return;
      const entry = { id: `${Date.now()}-${voice.subtitles.length}`, who, text: clean };
      voice.set({ subtitles: [...voice.subtitles.slice(-99), entry] });
    }

    /** Playback drained → resume listening when the loop is armed. */
    function afterSpeaking() {
      if (voice.phase === 'speaking') voice.set({ phase: 'listening', speakingText: '' });
      maybeListen();
    }

    /** One-sentence look-ahead for the blob engine: while sentence N is
     * synthesizing/playing, sentence N+1 is already being fetched, so playback
     * rolls into it without an inter-sentence gap. Edge only — a stream
     * engine's live body would have to be buffered while waiting. */
    let prefetch = null; // { item, gen, ctrl, startedAt, promise }

    function requestSynth(item, ctrl) {
      const prefs = loadPrefs();
      return fetch(ROUTE_TTS, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl ? ctrl.signal : undefined,
        body: JSON.stringify({
          text: item.text,
          speed: Number(prefs.rate) || 1,
          stream: item.engine !== 'edge',
          engine: item.engine || 'gsv',
          voice: item.voice,
        }),
      });
    }

    function cancelPrefetch() {
      if (!prefetch) return;
      prefetch.ctrl.abort();
      prefetch = null;
    }

    function primePrefetch() {
      const next = gsvQueue[0];
      if (!next || next.engine !== 'edge') return;
      if (prefetch && prefetch.item === next && prefetch.gen === playbackGen) return;
      cancelPrefetch();
      const ctrl = new AbortController();
      const startedAt = performance.now();
      flowLog('synth.prefetch-start', next.text.slice(0, 40));
      prefetch = {
        item: next, gen: playbackGen, ctrl, startedAt,
        promise: requestSynth(next, ctrl).then(async (res) => {
          if (!res.ok || !res.body) throw new Error(await res.text().catch(() => String(res.status)));
          return res.blob();
        }),
      };
      prefetch.promise.catch(() => { /* a rejection surfaces to the consumer */ });
    }

    async function gsvPump() {
      if (gsvPlaying) return;
      const item = gsvQueue.shift();
      if (!item) { afterSpeaking(); return; }
      const gen = playbackGen;
      gsvPlaying = true;
      const finish = () => {
        if (gen !== playbackGen) {
          gsvPlaying = false;
          stopPlaybackLevel();
          return;
        }
        gsvPlaying = false;
        stopPlaybackLevel();
        if (gsvAudio) { const a = gsvAudio; gsvAudio = null; a.pause(); }
        if (item.onend) item.onend();
        if (!isSpeaking() && voice.phase === 'speaking') voice.set({ phase: 'listening', speakingText: '' });
        void gsvPump();
      };
      try {
        flowLog('synth.request', item.text.slice(0, 40) + (item.engine === 'edge' ? ' [edge]' : ' [stream]'));
        const synthT0 = performance.now();
        const own = prefetch && prefetch.item === item && prefetch.gen === gen ? prefetch : null;
        prefetch = null;
        if (!own) cancelPrefetch();
        primePrefetch();
        let blob = null;
        let res = null;
        if (item.engine === 'edge') {
          if (own) flowLog('synth.prefetch-hit', 'lead=' + Math.round(synthT0 - own.startedAt) + 'ms');
          blob = await (own ? own.promise : requestSynth(item, null).then(async (r) => {
            if (!r.ok || !r.body) throw new Error(await r.text().catch(() => String(r.status)));
            return r.blob();
          }));
        } else {
          res = await requestSynth(item, null);
          if (!res.ok || !res.body) throw new Error(await res.text().catch(() => String(res.status)));
        }
        flowLog('synth.stream-start', 'ms=' + Math.round(performance.now() - synthT0));
        if (gen !== playbackGen) { gsvPlaying = false; void gsvPump(); return; }
        streamCtl.cancelled = false;
        streamCtl.sources = [];
        if (item.engine === 'edge') {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          gsvAudio = audio;
          audio.onended = () => { flowLog('play.end'); URL.revokeObjectURL(url); finish(); return; };
          audio.onerror = () => { flowLog('play.error'); setScopedError('synth', 'error.synthFailed'); URL.revokeObjectURL(url); finish(); return; };
          attachEdgeLevel(audio);
          await audio.play();
          flowLog('play.start');
          clearScopedError('synth');
          if (item.onstart) item.onstart();
          return;
        }
        await playPcmStream(res.body, item, synthT0);
        if (gen !== playbackGen) return;
        finish();
      } catch (firstError) {
        if (gen !== playbackGen) { gsvPlaying = false; stopPlaybackLevel(); return; }
        // One bounded retry: a cold-start race must not silently drop a sentence.
        console.debug('[voice-conversation] chunk failed, retrying once:', firstError && firstError.message);
        if (item.retried) { setScopedError('synth', 'error.synthFailed'); finish(); return; }
        item.retried = true;
        gsvPlaying = false;
        stopPlaybackLevel();
        if (gsvAudio) { const a = gsvAudio; gsvAudio = null; a.pause(); }
        gsvQueue.unshift(item);
        await new Promise(r => setTimeout(r, 1500));
        if (gen !== playbackGen) return;
        void gsvPump();
        return;
      }
    }

    function speak(text, onend, onstart, options) {
      const body = speakable(text);
      if (!body) { if (onend) onend(); return; }
      if (options && options.source === 'reply') {
        voice.lastReply = { id: options.id || null, text: body };
      }
      const prefs = loadPrefs();
      if (voice.phase !== 'off' && voice.phase !== 'connecting' && voice.phase !== 'error') {
        voice.set({ phase: 'speaking', speakingText: body });
      }
      const engine = prefs.voiceURI === GSV_VOICE ? 'gsv'
        : (prefs.voiceURI || '').startsWith('edge:') ? 'edge' : 'system';
      flowLog('speak.enqueue', 'engine=' + engine + ' chars=' + body.length);
      if (engine === 'gsv' || engine === 'edge') {
        const chunks = splitSentences(body);
        chunks.forEach((chunk, index) => {
          gsvQueue.push({
            text: chunk,
            engine,
            voice: engine === 'edge' ? prefs.voiceURI.slice(5) : undefined,
            onend: index === chunks.length - 1 ? onend : null,
            onstart: index === 0 ? onstart : null,
          });
        });
        void gsvPump();
        return;
      }
      if (!TTS_OK) { setScopedError('synth', 'error.synthFailed'); if (onend) onend(); afterSpeaking(); return; }
      // System voices queue like the clone engine: a newer reply must not
      // cancel the one being read (the old synth.cancel() barged in and
      // skipped queued speech).
      sysQueue.push({ chunks: splitSentences(body), onend, onstart });
      sysPump();
    }

    function sysPump() {
      if (sysActive) return;
      const item = sysQueue.shift();
      if (!item) {
        synthSpeaking = false;
        if (voice.phase === 'speaking' && !isSpeaking()) afterSpeaking();
        return;
      }
      const gen = playbackGen;
      sysActive = true;
      synthSpeaking = true;
      const synth = window.speechSynthesis;
      const prefs = loadPrefs();
      let index = 0;
      const next = () => {
        if (gen !== playbackGen) { sysActive = false; synthSpeaking = false; return; }
        if (index >= item.chunks.length) {
          sysActive = false;
          synthSpeaking = false;
          if (item.onend) item.onend();
          sysPump();
          return;
        }
        const chunkIndex = index++;
        const utterance = new SpeechSynthesisUtterance(item.chunks[chunkIndex]);
        const v = pickVoice(prefs.voiceURI);
        if (v) utterance.voice = v;
        utterance.lang = (v && v.lang) || 'zh-CN';
        const rate = Number(prefs.rate);
        if (rate > 0) utterance.rate = rate;
        if (chunkIndex === 0 && item.onstart) {
          utterance.onstart = () => { clearScopedError('synth'); item.onstart(); };
        } else if (chunkIndex === 0) {
          utterance.onstart = () => clearScopedError('synth');
        }
        utterance.onend = next;
        utterance.onerror = () => { setScopedError('synth', 'error.synthFailed'); next(); };
        synth.speak(utterance);
      };
      next();
    }

    function stopSpeaking() {
      playbackGen++;
      if (TTS_OK) window.speechSynthesis.cancel();
      sysActive = false;
      synthSpeaking = false;
      sysQueue.length = 0;
      gsvQueue.length = 0;
      gsvPlaying = false;
      cancelPrefetch();
      if (gsvAudio) { const a = gsvAudio; gsvAudio = null; a.pause(); }
      streamCtl.cancelled = true;
      if (streamCtl.reader) { const r = streamCtl.reader; streamCtl.reader = null; void r.cancel().catch(() => {}); }
      for (const src of streamCtl.sources.splice(0)) { try { src.stop(); } catch { /* noop */ } }
      stopPlaybackLevel();
      if (voice.phase === 'speaking') voice.set({ phase: 'listening', speakingText: '' });
    }

    /* ---------- real audio levels ---------- */

    let levelRaf = 0;
    let micAnalyser = null;
    let playCtx = null;
    let playAnalyser = null;

    function publishLevel(raw) {
      const smooth = voice.level * 0.7 + raw * 0.3;
      const next = Math.abs(smooth - voice.level) > 0.01 ? smooth : voice.level;
      if (next !== voice.level) voice.set({ level: next });
    }

    function startMicLevel(analyser, data) {
      cancelAnimationFrame(levelRaf);
      const tick = () => {
        if (!micAnalyser) return;
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        publishLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
        levelRaf = requestAnimationFrame(tick);
      };
      levelRaf = requestAnimationFrame(tick);
    }

    function stopMicLevel() {
      micAnalyser = null;
      cancelAnimationFrame(levelRaf);
      if (voice.level !== 0) voice.set({ level: 0 });
    }

    function getPlayCtx() {
      if (!playCtx) playCtx = new AudioContext();
      if (playCtx.state === 'suspended') void playCtx.resume().catch(() => {});
      return playCtx;
    }

    function getPlayAnalyser() {
      const actx = getPlayCtx();
      if (!playAnalyser) {
        playAnalyser = actx.createAnalyser();
        playAnalyser.fftSize = 512;
        playAnalyser.connect(actx.destination);
        const data = new Uint8Array(playAnalyser.frequencyBinCount);
        cancelAnimationFrame(levelRaf);
        const tick = () => {
          if (!playAnalyser) return;
          playAnalyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          publishLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
          levelRaf = requestAnimationFrame(tick);
        };
        levelRaf = requestAnimationFrame(tick);
      }
      return playAnalyser;
    }

    function attachEdgeLevel(audio) {
      try {
        const actx = getPlayCtx();
        const analyser = getPlayAnalyser();
        actx.createMediaElementSource(audio).connect(analyser);
      } catch { /* level feedback is optional */ }
    }

    /** Play a raw PCM (int16, 32kHz mono) stream chunk by chunk as it arrives. */
    async function playPcmStream(body, item, synthT0) {
      const actx = getPlayCtx();
      const analyser = getPlayAnalyser();
      const reader = body.getReader();
      streamCtl.reader = reader;
      let pending = new Uint8Array(0);
      let nextTime = 0;
      let lastSrc = null;
      for (;;) {
        if (streamCtl.cancelled) { void reader.cancel().catch(() => {}); break; }
        const { done, value } = await reader.read();
        if (done) break;
        const merged = new Uint8Array(pending.length + value.length);
        merged.set(pending); merged.set(value, pending.length);
        const evenLen = merged.length - (merged.length % 2);
        pending = merged.slice(evenLen);
        if (!evenLen) continue;
        const pcm = new Int16Array(merged.buffer, merged.byteOffset, evenLen / 2);
        const floats = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) floats[i] = pcm[i] / 32768;
        const audioBuf = actx.createBuffer(1, floats.length, 32000);
        audioBuf.copyToChannel(floats, 0);
        const src = actx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(analyser);
        streamCtl.sources.push(src);
        const when = Math.max(nextTime, actx.currentTime + 0.03);
        src.start(when);
        nextTime = when + audioBuf.duration;
        if (!lastSrc) {
          flowLog('synth.first-audio', 'ms=' + Math.round(performance.now() - synthT0));
          flowLog('play.start');
          clearScopedError('synth');
          if (item.onstart) item.onstart();
        }
        lastSrc = src;
      }
      if (lastSrc && !streamCtl.cancelled) {
        await new Promise((resolve) => { lastSrc.onended = resolve; });
        flowLog('play.end');
      }
    }

    function stopPlaybackLevel() {
      playAnalyser = null;
      cancelAnimationFrame(levelRaf);
      if (voice.level !== 0) voice.set({ level: 0 });
    }

    /* ---------- recorder + VAD + Remote transcription ---------- */

    const rec = { stream: null, audioCtx: null, recorder: null, chunks: [], raf: 0 };

    function releaseRecorder() {
      cancelAnimationFrame(rec.raf);
      stopMicLevel();
      if (rec.recorder && rec.recorder.state !== 'inactive') { try { rec.recorder.stop(); } catch { /* noop */ } }
      if (rec.stream) { for (const t of rec.stream.getTracks()) t.stop(); }
      if (rec.audioCtx) { void rec.audioCtx.close().catch(() => {}); }
      rec.stream = null; rec.audioCtx = null; rec.recorder = null; rec.chunks = [];
    }

    function uint8ToBase64(bytes) {
      let bin = '';
      const step = 8192;
      for (let i = 0; i < bytes.length; i += step) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
      }
      return btoa(bin);
    }

    function encodeWave(samples) {
      const n = samples.length;
      const buffer = new ArrayBuffer(44 + n * 2);
      const view = new DataView(buffer);
      const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
      writeStr(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); writeStr(8, 'WAVE');
      writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
      view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      writeStr(36, 'data'); view.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      return new Uint8Array(buffer);
    }

    function isCurrentTurn(sessionGen, turnId) {
      return !!voice.sessionId
        && voice.sessionGen === sessionGen
        && voice.turnId === turnId;
    }

    function landTranscript(text, sessionGen, turnId) {
      if (!text || !voice.owner || voice.phase !== 'transcribing' || !isCurrentTurn(sessionGen, turnId)) return false;
      const { inputActions, getDraft } = voice.owner;
      const draft = getDraft();
      // The editor is unmounted while the voice panel shows: selection-level
      // writes (captureInsertion/insertText) throw then, so append at store level.
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
      flowLog('draft.write', 'chars=' + text.length);
      pushSubtitle('you', text);
      clearScopedError('draft');
      if (composerMounted && draft.trim()) {
        // insertText's resulting draft is only knowable after the store→render
        // pipeline runs; arm on the first snapshot provably equal to our write
        // (isPureInsertion), never on a stale cache read or a fixed delay.
        voice.armPending = { sessionGen, turnId, owner: voice.owner, before: draft, inserted: text };
        voice.set({ phase: 'thinking' });
      } else {
        voice.set({ phase: 'thinking' });
        beginPendingSend(nextDraft);
      }
      return true;
    }

    function maybeListen() {
      if (voice.phase !== 'listening') return;
      if (voice.muted || voice.requesting || rec.stream) return;
      if (isSpeaking()) return;
      if (!voice.owner) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      flowLog('loop.relisten');
      void startListening();
    }

    async function startListening() {
      flowLog('mic.open');
      if (!speechNs()) { flowLog('mic.error', 'noAsr'); setScopedError('asr', 'error.noAsr'); voice.set({ phase: 'error' }); return; }
      if (!REC_OK) { setScopedError('mic', 'error.micDenied'); voice.set({ phase: 'error' }); return; }
      const sessionGen = voice.sessionGen;
      const turnId = voice.turnId + 1;
      voice.set({ requesting: true, turnId });
      const prefs = loadPrefs();
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          ...(prefs.deviceId ? { deviceId: { exact: prefs.deviceId } } : {}),
        },
      };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        if (isCurrentTurn(sessionGen, turnId)) {
          setScopedError('mic', 'error.micDenied');
          voice.set({ requesting: false, phase: 'error' });
        }
        return;
      }
      if (voice.phase !== 'listening' || !isCurrentTurn(sessionGen, turnId)) { // ended while the permission prompt was open
        for (const t of stream.getTracks()) t.stop();
        voice.set({ requesting: false });
        return;
      }
      voice.set({ requesting: false });
      clearScopedError('mic');
      flowLog('mic.listen-start');
      rec.stream = stream;
      rec.audioCtx = new AudioContext();
      const analyser = rec.audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      rec.audioCtx.createMediaStreamSource(stream).connect(analyser);
      micAnalyser = analyser;
      const levelData = new Float32Array(analyser.fftSize);
      startMicLevel(analyser, levelData);
      rec.recorder = new MediaRecorder(stream);
      rec.chunks = [];
      rec.recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
      if (voice.muted) { for (const tr of stream.getTracks()) tr.enabled = false; }

      const t0 = performance.now();
      let aboveMs = 0;
      let lastT = t0;
      let silenceStart = null;
      let started = false;
      const tick = () => {
        if (!rec.recorder || voice.phase !== 'listening' || !isCurrentTurn(sessionGen, turnId)) return;
        analyser.getFloatTimeDomainData(levelData);
        let sum = 0;
        for (let i = 0; i < levelData.length; i++) sum += levelData[i] * levelData[i];
        const rms = Math.sqrt(sum / levelData.length);
        const now = performance.now();
        const dt = now - lastT;
        lastT = now;
        if (voice.muted) { rec.raf = requestAnimationFrame(tick); return; }
        if (rms > VAD_START_RMS) { aboveMs += dt; silenceStart = null; }
        else if (rms < VAD_STOP_RMS && silenceStart === null) silenceStart = now;
        else if (rms >= VAD_STOP_RMS) silenceStart = null;
        if (aboveMs >= VAD_START_MS) started = true;
        const heardEnough = started && silenceStart !== null && now - silenceStart >= VAD_STOP_MS;
        const noSpeech = !started && now - t0 >= VAD_NOSPEECH_MS;
        if (heardEnough || now - t0 >= VAD_MAX_MS || noSpeech) {
          flowLog('mic.stop', noSpeech ? 'nospeech' : (heardEnough ? 'silence' : 'maxlen'));
          void finishListening(noSpeech ? 'nospeech' : 'ok', sessionGen, turnId);
          return;
        }
        rec.raf = requestAnimationFrame(tick);
      };
      rec.recorder.start(250);
      rec.raf = requestAnimationFrame(tick);
      voice.notify();
    }

    async function finishListening(reason, sessionGen = voice.sessionGen, turnId = voice.turnId) {
      const recorder = rec.recorder;
      if (!recorder || !isCurrentTurn(sessionGen, turnId)) return;
      voice.set({ phase: reason === 'nospeech' ? 'listening' : 'transcribing' });
      const audioCtx = rec.audioCtx;
      const blobPromise = new Promise((resolve) => {
        recorder.onstop = () => resolve(new Blob(rec.chunks, { type: recorder.mimeType }));
      });
      try { recorder.stop(); } catch { /* already stopped */ }
      const blob = await blobPromise;
      cancelAnimationFrame(rec.raf);
      stopMicLevel();
      if (rec.stream) { for (const t of rec.stream.getTracks()) t.stop(); }
      rec.stream = null; rec.recorder = null; rec.chunks = [];
      if (reason === 'nospeech' || blob.size === 0) {
        if (audioCtx) void audioCtx.close().catch(() => {});
        voice.set({ phase: 'listening' });
        maybeListen();
        return;
      }
      if (!isCurrentTurn(sessionGen, turnId)) {
        if (audioCtx) void audioCtx.close().catch(() => {});
        return;
      }
      try {
        const decoded = await audioCtx.decodeAudioData(await blob.arrayBuffer());
        if (audioCtx) void audioCtx.close().catch(() => {});
        if (!isCurrentTurn(sessionGen, turnId)) return;
        const frames = Math.max(1, Math.floor(Math.min(decoded.duration, 120) * 16000));
        const offline = new OfflineAudioContext(1, frames, 16000);
        const source = offline.createBufferSource();
        source.buffer = decoded;
        source.connect(offline.destination);
        source.start();
        const rendered = await offline.startRendering();
        const wav = encodeWave(rendered.getChannelData(0));
        flowLog('asr.request', 'bytes=' + wav.length);
        if (!isCurrentTurn(sessionGen, turnId)) return;
        const asrT0 = performance.now();
        const result = await speechNs().transcribe({ audioBase64: uint8ToBase64(wav), language: 'zh' });
        const text = String((result && result.value && result.value.text) || (result && result.text) || '').trim();
        flowLog('asr.result', 'ms=' + Math.round(performance.now() - asrT0) + ' text=' + text.slice(0, 80));
        if (!isCurrentTurn(sessionGen, turnId) || voice.phase !== 'transcribing') return;
        clearScopedError('asr');
        if (text) {
          if (!landTranscript(text, sessionGen, turnId)) {
            setScopedError('draft', 'error.draftBusy');
            voice.set({ phase: 'listening' });
          }
        } else {
          voice.set({ phase: 'listening' });
        }
      } catch (error) {
        flowLog('asr.error', String((error && error.message) || error).slice(0, 120));
        reportClientError('asr: ' + String((error && error.message) || error), error && error.stack);
        if (isCurrentTurn(sessionGen, turnId) && voice.phase === 'transcribing') {
          setScopedError('asr', 'error.asrFailed');
          voice.set({ phase: 'listening' });
        }
      } finally {
        if (isCurrentTurn(sessionGen, turnId)) maybeListen();
      }
    }

    /* ---------- session-level operations ---------- */

    /** Start a fresh voice session for the given chat session, or just reveal it. */
    async function startVoice({ sessionId, inputActions, getDraft, useChat, useInput, useSessions }) {
      if (voice.phase !== 'off') { // "返回语音": reveal the existing session, never rebuild
        openVoicePage();
        return;
      }
      discardPendingSend('session-start');
      voice.sessionGen += 1;
      voice.turnId += 1;
      resetScopedErrors();
      voice.set({
        phase: 'connecting', sessionId, error: '', subtitles: [], muted: false,
        captionsOn: !!loadPrefs().captions, spokenId: null, sendPending: false,
        sendConsumed: true, sendOwner: null, armPending: null,
        startedAt: Date.now(),
      });
      flowLog('voice.start', 'session=' + sessionId + ' engine=' + engineInfo(loadPrefs().voiceURI).id);
      voice.owner = { inputActions, getDraft, useChat, useInput, useSessions };
      openVoicePage();
      // Enter listening immediately: mic permission and the first recording do
      // not wait for the clone service. The service warms in parallel and
      // playback retries cold-start races per chunk, so a slow boot no longer
      // parks the session on "connecting" for minutes.
      voice.set({ phase: 'listening' });
      maybeListen();
      if (loadPrefs().voiceURI === GSV_VOICE) {
        try {
          const res = await fetch(ROUTE_CONTROL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'warmup' }),
          });
          if (!res.ok) throw new Error(String(res.status));
        } catch {
          if (voice.phase !== 'off') setScopedError('synth', 'error.gsvFailed');
        }
      }
    }

    /** End the voice session: stop mic, playback, timers; keep the chat log. */
    function endVoice(options) {
      flowLog('voice.end', 'phase=' + voice.phase);
      const wasGsv = loadPrefs().voiceURI === GSV_VOICE;
      const sessionId = voice.sessionId;
      discardPendingSend('session-end');
      voice.sessionGen += 1;
      voice.turnId += 1;
      stopSpeaking();
      releaseRecorder();
      resetScopedErrors();
      voice.set({
        phase: 'off', sessionId: null, error: '', subtitles: [], muted: false,
        requesting: false, speakingText: '', level: 0, settingsOpen: false,
        sendPending: false, sendConsumed: true, sendOwner: null, armPending: null, lastReply: null,
      });
      voice.owner = null;
      voice.spokenId = null;
      if (sessionId) closeVoicePage();
      if (wasGsv) {
        fetch(ROUTE_CONTROL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: options && options.unload ? 'page-unload' : 'stop' }),
        }).catch(() => {});
      }
    }

    function toggleMute() {
      const next = !voice.muted;
      voice.set({ muted: next });
      clearScopedError('mic');
      if (rec.stream) for (const t of rec.stream.getTracks()) t.enabled = !next;
      if (!next) maybeListen();
    }

    /** Stop the spoken answer only; model work continues untouched. */
    function stopAnswer() {
      stopSpeaking();
      voice.set({ phase: 'listening' });
      maybeListen();
    }

    function retryMic() {
      if (voice.phase === 'off' || !voice.owner) return;
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

    /* ---------- chat snapshot helpers ---------- */

    function assistantText(chat, messageId) {
      const nodes = chat.legacy.nodes;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (node.kind === 'assistant' && node.messageId === messageId) {
          return node.blocks.filter(b => b.kind === 'text').map(b => b.text).join('\n');
        }
      }
      return '';
    }

    function lastAssistant(chat) {
      const nodes = chat.legacy.nodes;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (node.kind === 'assistant' && node.messageId && !node.interrupted) return node;
      }
      return undefined;
    }

    function assistantSeries(chat) {
      const out = [];
      for (const n of chat.legacy.nodes) {
        if (n.kind === 'assistant' && n.messageId && !n.interrupted) {
          const text = n.blocks.filter(b => b.kind === 'text').map(b => b.text).join('\n').trim();
          if (text) out.push(n.messageId + '\x1f' + (n.time || 0) + '\x1f' + text);
        }
      }
      return out.join('\x1e');
    }

    /* ---------- styles ---------- */

    const STYLES = `
.dsh-vc-start { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 0; }
.dsh-vc-start:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-vc-start[data-active="true"] { color: var(--dsw-alias-brand-primary); }
.dsh-vc-start svg { display: block; }
.dsh-vc-start[data-pending="true"] { opacity: 0.45; cursor: progress; }
.dsh-vc-start[data-pending="true"] svg { animation: dsh-vc-pulse 1.2s ease-in-out infinite; }
.dsh-vc-minibar { box-sizing: border-box; width: calc(100% - var(--dsh-composer-side-clearance, 16px) * 2 - var(--dsh-composer-dock-inset, 8px) * 4); max-width: calc(var(--dsh-composer-card-max-width, 952px) - var(--dsh-composer-dock-inset, 8px) * 4); margin: 0 auto; display: flex; align-items: center; gap: 8px; padding: 5px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-vc-minibar .dsh-vc-state { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.dsh-vc-minibar button { border: none; background: transparent; color: var(--dsw-alias-label-secondary); border-radius: 6px; padding: 2px 8px; font-size: 12px; line-height: 20px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.dsh-vc-minibar button:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-vc-minibar button[data-danger="true"]:hover { color: var(--dsw-alias-state-error-primary); }
.dsh-vc-livedot { width: 8px; height: 8px; border-radius: 50%; corner-shape: round; background: var(--dsw-alias-state-idle-primary); flex-shrink: 0; }
.dsh-vc-livedot[data-live="true"] { background: var(--dsw-alias-state-error-primary); }
.dsh-vc-livedot[data-speaking="true"] { background: var(--dsw-alias-brand-primary); }
.dsh-vc-page { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); position: relative; }
.dsh-vc-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px 8px; flex-shrink: 0; }
.dsh-vc-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; min-width: 0; }
.dsh-vc-title .dsh-vc-session { color: var(--dsw-alias-label-secondary); font-weight: 400; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-vc-topactions { display: flex; gap: 4px; flex-shrink: 0; }
.dsh-vc-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 0; }
.dsh-vc-iconbtn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-vc-iconbtn[aria-pressed="true"] { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.dsh-vc-stage { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 12px 24px; }
.dsh-vc-orb { width: 84px; height: 84px; flex: none; border-radius: 50%; corner-shape: round; background: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4172e6); transition: transform 220ms ease, opacity 220ms ease, box-shadow 220ms ease; transform: scale(calc(1 + var(--dsh-vc-level, 0) * 0.18)); box-shadow: 0 0 0 calc(var(--dsh-vc-level, 0) * 22px) color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4172e6) 16%, transparent); opacity: 0.92; }
.dsh-vc-orb[data-muted="true"] { opacity: 0.35; transform: none; box-shadow: none; }
.dsh-vc-orb[data-off="true"] { opacity: 0.5; background: var(--dsw-alias-state-idle-primary); transform: none; box-shadow: none; }
@media (prefers-reduced-motion: reduce) { .dsh-vc-orb { transition: none; } }
.dsh-vc-state { font-size: 17px; font-weight: 500; min-height: 26px; }
.dsh-vc-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); min-height: 18px; text-align: center; }
.dsh-vc-retry { border: 1px solid var(--dsw-alias-brand-primary); background: transparent; color: var(--dsw-alias-brand-primary); border-radius: 999px; corner-shape: round; padding: 4px 16px; font-size: 12px; cursor: pointer; }
.dsh-vc-captions { width: 100%; max-width: 560px; max-height: 168px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 10px 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; line-height: 1.6; }
.dsh-vc-capline { display: flex; gap: 8px; }
.dsh-vc-capwho { flex-shrink: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; padding-top: 1px; min-width: 30px; }
.dsh-vc-capline[data-who="you"] .dsh-vc-capwho { color: var(--dsw-alias-brand-primary); }
.dsh-vc-capempty { color: var(--dsw-alias-label-secondary); text-align: center; font-size: 12px; }
.dsh-vc-backlatest { position: sticky; bottom: 0; align-self: center; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-secondary); border-radius: 999px; corner-shape: round; padding: 2px 10px; font-size: 11px; cursor: pointer; }
.dsh-vc-controls { display: flex; align-items: center; justify-content: center; gap: 28px; padding: 10px 0 18px; flex-shrink: 0; }
.dsh-vc-ctl { display: flex; flex-direction: column; align-items: center; gap: 6px; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; cursor: pointer; padding: 4px; }
.dsh-vc-ctlcircle { width: 48px; height: 48px; flex: none; border-radius: 50%; corner-shape: round; display: flex; align-items: center; justify-content: center; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); transition: background 160ms ease, border-color 160ms ease; }
.dsh-vc-ctl:hover .dsh-vc-ctlcircle { background: var(--dsw-alias-bg-layer-2); }
.dsh-vc-ctl:active .dsh-vc-ctlcircle { transform: scale(0.94); }
.dsh-vc-ctl[aria-pressed="true"] { color: var(--dsw-alias-brand-primary); }
.dsh-vc-ctl[aria-pressed="true"] .dsh-vc-ctlcircle { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.dsh-vc-ctl[data-danger="true"] .dsh-vc-ctlcircle { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); color: var(--dsw-alias-state-error-primary); }
.dsh-vc-ctl[data-danger="true"]:hover .dsh-vc-ctlcircle { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.dsh-vc-stopanswer { border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); border-radius: 999px; corner-shape: round; padding: 3px 12px; font-size: 12px; cursor: pointer; min-height: 24px; }
.dsh-vc-stopanswer:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-vc-settings { position: absolute; top: 52px; right: 16px; z-index: 20; width: 280px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 8px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent); padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; font-size: 12px; color: var(--dsw-alias-label-primary); }
.dsh-vc-settings h3 { margin: 0; font-size: 13px; font-weight: 500; }
.dsh-vc-field { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.dsh-vc-field span { color: var(--dsw-alias-label-secondary); flex-shrink: 0; }
.dsh-vc-field select { max-width: 170px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 4px 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; }
.dsh-vc-advanced { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; color: var(--dsw-alias-label-secondary); }
.dsh-vc-advanced summary { cursor: pointer; font-size: 12px; }
.dsh-vc-preview { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); padding: 4px 8px; font-size: 12px; cursor: pointer; }
.dsh-vc-preview:hover { background: var(--dsw-alias-bg-layer-2); }
@media (max-width: 640px) {
  .dsh-vc-orb { width: 64px; height: 64px; }
  .dsh-vc-controls { gap: 16px; }
  .dsh-vc-captions { max-height: 128px; }
  .dsh-vc-settings { right: 8px; left: 8px; width: auto; }
}
`;

    /* ---------- icons ---------- */

    function iconProps(extra) {
      return Object.assign({
        viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': true,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }, extra);
    }
    const WaveIcon = () => h('svg', iconProps(),
      h('path', { d: 'M2 10v3' }), h('path', { d: 'M6 6v11' }), h('path', { d: 'M10 3v18' }),
      h('path', { d: 'M14 8v7' }), h('path', { d: 'M18 5v13' }), h('path', { d: 'M22 10v3' }));
    const MicIcon = () => h('svg', iconProps(),
      h('path', { d: 'M12 19v3' }), h('path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }),
      h('rect', { x: 9, y: 2, width: 6, height: 13, rx: 3 }));
    const MicOffIcon = () => h('svg', iconProps(),
      h('path', { d: 'M12 19v3' }), h('path', { d: 'M19 10v2a7 7 0 0 1-1.9 4.8' }),
      h('path', { d: 'M5 10v2a7 7 0 0 0 2 4.3' }), h('path', { d: 'M2 2l20 20' }),
      h('path', { d: 'M9 5.5V9c0 .5.1 1 .3 1.4' }), h('path', { d: 'M15 11V5a3 3 0 0 0-5.7-1.3' }));
    const PhoneOffIcon = () => h('svg', iconProps(),
      h('path', { d: 'M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272' }),
      h('path', { d: 'M22 2 2 22' }),
      h('path', { d: 'M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473' }));
    const CaptionsIcon = () => h('svg', iconProps(),
      h('rect', { width: 18, height: 14, x: 3, y: 5, rx: 2, ry: 2 }),
      h('path', { d: 'M7 15h4M15 15h2M7 11h2M13 11h4' }));
    const SlidersIcon = () => h('svg', iconProps(),
      h('path', { d: 'M14 17H5' }), h('path', { d: 'M19 7h-9' }),
      h('circle', { cx: 17, cy: 17, r: 3 }), h('circle', { cx: 7, cy: 7, r: 3 }));
    const ChevronDownIcon = () => h('svg', iconProps(), h('path', { d: 'm6 9 6 6 6-6' }));
    const ExpandIcon = () => h('svg', iconProps(), h('path', { d: 'm18 15-6-6-6 6' }));

    function SpeakerIconSmall() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, fill: 'none' },
        h('path', { d: 'M8 3.2 5.1 5.6H2.8a.8.8 0 0 0-.8.8v3.2c0 .44.36.8.8.8h2.3L8 12.8c.4.32 1 .02 1-.52V3.72c0-.54-.6-.84-1-.52Z', fill: 'currentColor' }),
        h('path', { d: 'M10.9 5.9a2.9 2.9 0 0 1 0 4.2M12.4 4.4a5 5 0 0 1 0 7.2', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' }));
    }

    /* ---------- shared hooks ---------- */

    function useVoice() {
      return useSyncExternalStore(
        (fn) => voice.subscribe(fn),
        () => `${voice.phase}\x1f${voice.muted}\x1f${voice.error}\x1f${voice.errorVersion}\x1f${voice.captionsOn}\x1f${voice.settingsOpen}\x1f${voice.sessionId}\x1f${voice.requesting}\x1f${voice.sendPending}`,
      );
    }

    function useVoiceLevel() {
      return useSyncExternalStore(
        (fn) => voice.subscribe(fn),
        () => Math.round(voice.level * 20) / 20,
      );
    }

    function useSubtitles() {
      return useSyncExternalStore(
        (fn) => voice.subscribe(fn),
        () => voice.subtitles,
      );
    }

    function stateText(t) {
      if (voice.error) return t(voice.error);
      switch (voice.phase) {
        case 'connecting': return t('state.connecting');
        case 'listening': return voice.muted ? t('state.muted') : (voice.requesting ? t('state.requesting') : t('state.listening'));
        case 'transcribing': return t('state.transcribing');
        case 'thinking': return t('state.thinking');
        case 'speaking': return t('state.speaking');
        case 'editing': return t('state.editing');
        case 'error': return t('state.error');
        default: return t('state.off');
      }
    }

    function hintText(t) {
      if (voice.phase === 'listening') return voice.muted ? t('page.hint.muted') : t('page.hint.listening');
      if (voice.phase === 'editing') return t('page.hint.editing');
      return t('page.hint.default');
    }

    /* ---------- VoiceEffects: auto-send + auto-read, bound to voice.owner ---------- */

    function VoiceEffects() {
      useVoice();
      const owner = voice.owner;
      if (!owner || !owner.useChat || !owner.useInput) return null;
      return h(VoiceEffectsInner, null);
    }

    function VoiceEffectsInner() {
      const owner = voice.owner;
      const draft = owner.useInput(s => s.draft);
      const composerPhase = owner.useInput(s => s.phase);
      const series = owner.useChat(chat => assistantSeries(chat));
      const active = voice.phase !== 'off';

      // Auto-send: all arming/cancel semantics live in the module
      // (handleComposerSnapshot, unit-tested); this effect is only the
      // store→module adapter and re-runs on every composer snapshot.
      useEffect(() => {
        if (!active) return;
        handleComposerSnapshot(draft, composerPhase);
      }, [draft, composerPhase, active]);

      // The countdown timer is created by this always-mounted effects root, so
      // it survives view switches; firing delegates to the module's
      // submitPendingSend, which re-validates everything before submitting.
      useEffect(() => {
        if (!voice.sendPending || !active) return undefined;
        const sendId = voice.sendId;
        const timer = setTimeout(() => {
          submitPendingSend(sendId);
        }, SEND_DELAY_MS);
        return () => clearTimeout(timer);
      }, [voice.sendPending, voice.sendId, active]);

      // Auto-read: every newly finalized assistant message, in order, never replaying.
      useEffect(() => {
        if (!active || !series) return;
        const entries = series.split('\x1e').map((row) => {
          const parts = row.split('\x1f');
          return { id: parts[0], time: Number(parts[1]) || 0, text: parts.slice(2).join('\x1f') };
        });
        if (!entries.length) return;
        let pending;
        if (voice.spokenId === null) {
          // Fresh binding: skip history, but speak replies newer than this voice
          // session's start (a new chat's first answer must not be swallowed).
          pending = entries.filter(e => e.time >= voice.startedAt - 5000);
        } else {
          let idx = entries.findIndex(e => e.id === voice.spokenId);
          if (idx === -1) idx = entries.length - 1;
          pending = entries.slice(idx + 1);
        }
        for (const e of pending) {
          flowLog('series.detected', e.id + ' chars=' + e.text.length);
          pushSubtitle('assistant', e.text);
          speak(e.text, null, null, { source: 'reply', id: e.id });
        }
        voice.spokenId = entries[entries.length - 1].id;
      }, [series, active]);

      // Reply watchdog: never wedge in "thinking" when nothing speakable arrives.
      useEffect(() => {
        if (!active || voice.phase !== 'thinking') return undefined;
        const timer = setTimeout(() => {
          if (voice.phase === 'thinking') { voice.set({ phase: 'listening' }); maybeListen(); }
        }, 25000);
        return () => clearTimeout(timer);
      }, [active, voice.phase]);

      return null;
    }

    function cancelPendingSendFromUi() {
      cancelPendingSend('user-cancel');
    }

    /* ---------- conversation.input.right: 开始语音 / 返回语音 ---------- */

    function VoiceStartButton(props) {
      const { sessionId, inputActions, useInput, t } = props;
      useVoice();
      const active = voice.phase !== 'off';
      const mine = active && voice.sessionId === sessionId;
      const foreign = active && voice.sessionId && voice.sessionId !== sessionId;
      // Keep the draft cache fresh while this session's composer is mounted;
      // transcription completion reads it asynchronously (see draftCache).
      const liveDraft = useInput ? useInput(s => s.draft) : '';
      useEffect(() => {
        if (sessionId) draftCache.set(sessionId, liveDraft);
      }, [sessionId, liveDraft]);
      const getDraft = useCallback(
        () => (sessionId ? draftCache.get(sessionId) || '' : ''),
        [sessionId],
      );
      const { useChat, useSessions } = props;
      const onClick = useCallback(() => {
        if (foreign) {
          // Explicit user choice: end the other chat's voice, start clean here.
          endVoice();
          void startVoice({ sessionId, inputActions, getDraft, useChat, useInput, useSessions });
          return;
        }
        if (active) { openVoicePage(); return; }
        void startVoice({ sessionId, inputActions, getDraft, useChat, useInput, useSessions });
      }, [active, foreign, sessionId, inputActions, getDraft, useChat, useInput, useSessions]);
      const label = foreign ? t('start.rebind')
        : active ? t('start.return') : t('start.begin');
      return h(React.Fragment, null,
        h('style', null, STYLES),
        h('button', {
          type: 'button', className: 'dsh-vc-start', 'aria-label': label, title: label,
          'data-active': active || undefined, onClick,
        }, h(WaveIcon)),
      );
    }

    /* ---------- conversation.input.dock: minimized voice bar ---------- */

    function VoiceMiniBar(props) {
      const { sessionId, usePanelInfo, t } = props;
      useVoice();
      const voicePageShowing = usePanelInfo
        ? usePanelInfo(s => s.activePanelId === PANEL_ID)
        : false;

      const mine = voice.sessionId === sessionId && voice.phase !== 'off';
      const foreign = voice.phase !== 'off' && voice.sessionId && voice.sessionId !== sessionId;

      if (foreign) {
        return h(React.Fragment, null,
          h('style', null, STYLES),
          h('div', { className: 'dsh-vc-minibar' },
            h('span', { className: 'dsh-vc-livedot', 'data-live': voice.phase === 'listening' || undefined,
              'data-speaking': voice.phase === 'speaking' || undefined }),
            h('span', { className: 'dsh-vc-state' }, t('mini.foreign')),
            h('button', { type: 'button', onClick: openBoundSession }, t('action.backToVoice')),
          ),
        );
      }
      if (!mine) return null;
      if (voicePageShowing) return null; // the full page is showing; no duplicate bar

      const statusText = stateText(t);
      return h(React.Fragment, null,
        h('style', null, STYLES),
        h('div', { className: 'dsh-vc-minibar' },
          h('span', {
            className: 'dsh-vc-livedot',
            'data-live': (voice.phase === 'listening' && !voice.muted) || undefined,
            'data-speaking': voice.phase === 'speaking' || undefined,
          }),
          h('span', { className: 'dsh-vc-state' }, statusText),
          voice.sendPending ? h('button', {
            type: 'button', 'data-danger': true,
            onClick: cancelPendingSendFromUi,
          }, `${t('send.pending')} · ${t('action.cancelSend')}`) : null,
          voice.phase === 'editing' ? h('button', {
            type: 'button',
            onClick: resumeListening,
          }, t('action.resumeListening')) : null,
          h('button', {
            type: 'button', 'aria-label': t('action.expand'), title: t('action.expand'),
            onClick: () => openVoicePage(),
          }, h(ExpandIcon)),
          h('button', {
            type: 'button', 'aria-label': voice.muted ? t('action.unmute') : t('action.mute'),
            title: voice.muted ? t('action.unmute') : t('action.mute'),
            'aria-pressed': voice.muted,
            onClick: (e) => { e.stopPropagation(); toggleMute(); },
          }, voice.muted ? h(MicOffIcon) : h(MicIcon)),
          h('button', {
            type: 'button', 'aria-label': t('action.end'), title: t('action.end'), 'data-danger': true,
            onClick: (e) => { e.stopPropagation(); endVoice(); },
          }, h(PhoneOffIcon)),
        ),
      );
    }

    /* ---------- settings popover ---------- */

    function SettingsPanel({ t, voices, prefs, setPrefs, devices, gsvState }) {
      // Selecting the clone voice pre-warms the service so the first play isn't a cold wait.
      useEffect(() => {
        if (loadPrefs().voiceURI !== GSV_VOICE) return;
        fetch(ROUTE_CONTROL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'warmup' }),
        }).catch(() => {});
      }, []);
      useEffect(() => {
        const onKey = (e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            voice.set({ settingsOpen: false });
          }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
      }, []);
      const chooseVoice = (e) => setPrefs(savePrefs({ voiceURI: e.target.value || undefined }));
      const chooseRate = (e) => setPrefs(savePrefs({ rate: Number(e.target.value) }));
      const chooseDevice = (e) => setPrefs(savePrefs({ deviceId: e.target.value || undefined }));
      const preview = () => speak(t('settings.sample'), null);
      const sortedVoices = [...voices].sort((a, b) =>
        (/^zh/i.test(b.lang) ? 1 : 0) - (/^zh/i.test(a.lang) ? 1 : 0));
      const gsvText = gsvState === 'ready' ? t('settings.gsvReady')
        : gsvState === 'starting' ? t('settings.gsvStarting') : t('settings.gsvOff');
      return h('div', { className: 'dsh-vc-settings', role: 'dialog', 'aria-label': t('settings.title') },
        h('h3', null, t('settings.title')),
        h('label', { className: 'dsh-vc-field' },
          h('span', null, t('settings.voice')),
          h('select', {
            'aria-label': t('settings.voice'),
            value: prefs.voiceURI === GSV_VOICE ? GSV_VOICE : (prefs.voiceURI || ''),
            onChange: chooseVoice,
          },
            h('option', { value: GSV_VOICE }, t('settings.gsvOption')),
            EDGE_VOICES.map(([v, label]) => h('option', { key: v, value: v }, label)),
            TTS_OK ? h('option', { value: '' }, t('settings.sysAuto')) : null,
            sortedVoices.map(v => h('option', { key: v.voiceURI, value: v.voiceURI }, `${v.name}（${v.lang}）`)),
          ),
        ),
        h('label', { className: 'dsh-vc-field' },
          h('span', null, t('settings.rate')),
          h('select', {
            'aria-label': t('settings.rate'), value: String(prefs.rate || 1), onChange: chooseRate,
          }, RATES.map(r => h('option', { key: r, value: r }, `${r}×`))),
        ),
        h('label', { className: 'dsh-vc-field' },
          h('span', null, t('settings.device')),
          h('select', {
            'aria-label': t('settings.device'),
            value: prefs.deviceId || '', onChange: chooseDevice,
          },
            h('option', { value: '' }, t('settings.deviceDefault')),
            devices.map(d => h('option', { key: d.deviceId, value: d.deviceId }, d.label || d.deviceId)),
          ),
        ),
        h('button', { type: 'button', className: 'dsh-vc-preview', onClick: preview },
          h(SpeakerIconSmall), t('settings.preview')),
        h('details', { className: 'dsh-vc-advanced' },
          h('summary', null, t('settings.advanced')),
          h('div', null, `${t('settings.engine')}：${engineInfo(prefs.voiceURI).labelZh}`),
          h('div', null, `${t('settings.engineState')}：${gsvText}`),
          h('div', null, `${t('settings.asr')}：${speechNs() ? t('settings.asrReady') : t('settings.asrMissing')}`),
          h('div', null, t('settings.vadNote')),
        ),
      );
    }

    /* ---------- subtitles ---------- */

    function CaptionsList({ t }) {
      const items = useSubtitles();
      const boxRef = useRef(null);
      const [stick, setStick] = useState(true);
      useEffect(() => {
        const box = boxRef.current;
        if (box && stick) box.scrollTop = box.scrollHeight;
      }, [items, stick]);
      const onScroll = () => {
        const box = boxRef.current;
        if (!box) return;
        setStick(box.scrollHeight - box.scrollTop - box.clientHeight < 24);
      };
      return h('div', { className: 'dsh-vc-captions', ref: boxRef, onScroll },
        items.length === 0 ? h('div', { className: 'dsh-vc-capempty' }, t('captions.empty')) : null,
        items.map(item => h('div', { key: item.id, className: 'dsh-vc-capline', 'data-who': item.who },
          h('span', { className: 'dsh-vc-capwho' }, item.who === 'you' ? t('captions.you') : t('captions.assistant')),
          h('span', null, item.text),
        )),
        stick ? null : h('button', {
          type: 'button', className: 'dsh-vc-backlatest',
          onClick: () => {
            setStick(true);
            const box = boxRef.current;
            if (box) box.scrollTop = box.scrollHeight;
          },
        }, t('captions.backToLatest')),
      );
    }

    /* ---------- main panel 'voice': the full voice page ---------- */

    function VoicePage(props) {
      const { sessionId, t } = props;
      useVoice();
      const level = useVoiceLevel();
      const [prefs, setPrefs] = useState(loadPrefs);
      const [voices, setVoices] = useState(() => (TTS_OK ? window.speechSynthesis.getVoices() : []));
      const [devices, setDevices] = useState([]);
      const [gsvState, setGsvState] = useState('');
      void sessionId;

      useEffect(() => {
        if (!TTS_OK) return undefined;
        const synth = window.speechSynthesis;
        const update = () => setVoices(synth.getVoices());
        update();
        if (synth.addEventListener) {
          synth.addEventListener('voiceschanged', update);
          return () => synth.removeEventListener('voiceschanged', update);
        }
        return undefined;
      }, []);

      // Input devices need one granted permission before labels resolve.
      useEffect(() => {
        if (!REC_OK) return undefined;
        let disposed = false;
        const refresh = () => {
          navigator.mediaDevices.enumerateDevices().then((list) => {
            if (!disposed) setDevices(list.filter(d => d.kind === 'audioinput'));
          }).catch(() => {});
        };
        refresh();
        if (navigator.mediaDevices.addEventListener) {
          navigator.mediaDevices.addEventListener('devicechange', refresh);
        }
        return () => {
          disposed = true;
          if (navigator.mediaDevices.removeEventListener) {
            navigator.mediaDevices.removeEventListener('devicechange', refresh);
          }
        };
      }, []);

      // Clone-service status for the settings panel.
      useEffect(() => {
        if (prefs.voiceURI !== GSV_VOICE) { setGsvState(''); return undefined; }
        let disposed = false;
        const poll = () => {
          fetch(ROUTE_CONTROL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'status' }),
          }).then(r => r.json()).then((body) => {
            if (!disposed) setGsvState(body && body.status === 'ready' ? 'ready' : 'starting');
          }).catch(() => { if (!disposed) setGsvState(''); });
        };
        poll();
        const timer = setInterval(poll, 5000);
        return () => { disposed = true; clearInterval(timer); };
      }, [prefs.voiceURI]);

      const ownerSessions = voice.owner && voice.owner.useSessions;
      const sessionTitle = ownerSessions
        ? ownerSessions(s => {
          const list = s && (s.sessions || s.items || s.list || []);
          const arr = Array.isArray(list) ? list : [];
          const found = arr.find(x => x && (x.id === voice.sessionId || x.sessionId === voice.sessionId));
          return (found && (found.title || found.name)) || '';
        })
        : '';
      const statusText = stateText(t);
      const isError = voice.phase === 'error';
      const showStopAnswer = voice.phase === 'speaking';
      const showResume = voice.phase === 'editing';
      const showSynthRetry = !!voice.errors.synth && !isError;
      return h('div', { className: 'dsh-vc-page' },
        h('style', null, STYLES),
        h('div', { className: 'dsh-vc-top' },
          h('div', { className: 'dsh-vc-title' },
            h(WaveIcon),
            h('span', null, t('page.title')),
            h('span', { className: 'dsh-vc-session' }, sessionTitle),
          ),
          h('div', { className: 'dsh-vc-topactions' },
            h('button', {
              type: 'button', className: 'dsh-vc-iconbtn', 'aria-label': t('page.settings'),
              title: t('page.settings'), 'aria-pressed': voice.settingsOpen,
              onClick: () => voice.set({ settingsOpen: !voice.settingsOpen }),
            }, h(SlidersIcon)),
            h('button', {
              type: 'button', className: 'dsh-vc-iconbtn', 'aria-label': t('page.minimize'),
              title: t('page.minimize'),
              onClick: () => closeVoicePage(),
            }, h(ChevronDownIcon)),
          ),
        ),
        voice.settingsOpen ? h(SettingsPanel, {
          t, voices, prefs, setPrefs, devices, gsvState,
        }) : null,
        h('div', { className: 'dsh-vc-stage' },
          h('div', {
            className: 'dsh-vc-orb', 'aria-hidden': true,
            'data-muted': voice.muted || undefined,
            'data-off': voice.phase === 'off' || voice.phase === 'error' || undefined,
            style: { '--dsh-vc-level': level },
          }),
          h('div', { className: 'dsh-vc-state', role: 'status', 'aria-live': 'polite' }, statusText),
          isError
            ? h('button', {
              type: 'button', className: 'dsh-vc-retry',
              onClick: retryMic,
            }, t('action.retry'))
            : h('div', { className: 'dsh-vc-hint' }, hintText(t)),
          showSynthRetry ? h('button', {
            type: 'button', className: 'dsh-vc-stopanswer', onClick: retrySpeaking,
          }, t('action.retrySpeak')) : null,
          showStopAnswer ? h('button', {
            type: 'button', className: 'dsh-vc-stopanswer', onClick: stopAnswer,
          }, t('action.stopSpeaking')) : null,
          voice.sendPending ? h('button', {
            type: 'button', className: 'dsh-vc-stopanswer', 'data-danger': true,
            onClick: cancelPendingSendFromUi,
          }, `${t('send.pending')} · ${t('action.cancelSend')}`) : null,
          showResume ? h('button', {
            type: 'button', className: 'dsh-vc-stopanswer', onClick: resumeListening,
          }, t('action.resumeListening')) : null,
          voice.captionsOn ? h(CaptionsList, { t }) : null,
        ),
        h('div', { className: 'dsh-vc-controls' },
          h('button', {
            type: 'button', className: 'dsh-vc-ctl',
            'aria-pressed': voice.muted, 'aria-label': voice.muted ? t('action.unmute') : t('action.mute'),
            title: voice.muted ? t('action.unmute') : t('action.mute'),
            onClick: toggleMute,
          },
            h('span', { className: 'dsh-vc-ctlcircle' }, voice.muted ? h(MicOffIcon) : h(MicIcon)),
            h('span', null, voice.muted ? t('action.unmute') : t('action.mute')),
          ),
          h('button', {
            type: 'button', className: 'dsh-vc-ctl', 'data-danger': true,
            'aria-label': t('action.end'), title: t('action.end'),
            onClick: endVoice,
          },
            h('span', { className: 'dsh-vc-ctlcircle' }, h(PhoneOffIcon)),
            h('span', null, t('action.end')),
          ),
          h('button', {
            type: 'button', className: 'dsh-vc-ctl',
            'aria-pressed': voice.captionsOn, 'aria-label': t('action.captions'),
            title: t('action.captions'),
            onClick: () => {
              const next = !voice.captionsOn;
              voice.set({ captionsOn: next });
              savePrefs({ captions: next });
            },
          },
            h('span', { className: 'dsh-vc-ctlcircle' }, h(CaptionsIcon)),
            h('span', null, t('action.captions')),
          ),
        ),
      );
    }

    /* ---------- per-message read-aloud action (unchanged behavior) ---------- */

    function SpeakAction(props) {
      const { messageId, useChat, t } = props;
      const text = useChat(chat => assistantText(chat, messageId));
      const [speakingNow, setSpeakingNow] = useState(false);
      const [pending, setPending] = useState(false);
      useEffect(() => () => { if (speakingNow) stopSpeaking(); }, [speakingNow]);
      const onClick = useCallback(() => {
        if (speakingNow) { stopSpeaking(); setSpeakingNow(false); return; }
        if (pending) return; // a synthesis is already in flight
        setPending(true);
        speak(
          text,
          () => { setSpeakingNow(false); setPending(false); },
          () => { setPending(false); setSpeakingNow(true); },
        );
      }, [speakingNow, pending, text]);
      if (!TTS_OK && loadPrefs().voiceURI !== GSV_VOICE) return null;
      if (!text.trim()) return null;
      const label = speakingNow ? t('action.stopSpeaking') : t('action.speak');
      return h(React.Fragment, null,
        h('style', null, STYLES),
        h('button', {
          type: 'button', className: 'dsh-vc-start', 'aria-label': label, title: label,
          'data-active': speakingNow || undefined, 'data-pending': pending || undefined,
          disabled: pending, onClick,
        }, h(SpeakerIconSmall)),
      );
    }

    /* ---------- error reporting ---------- */

    function reportClientError(message, stack) {
      try {
        fetch(ROUTE_CONTROL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'client-error', message: String(message), stack: String(stack || '') }),
        }).catch(() => {});
      } catch { /* reporting must never crash */ }
    }

    class VoiceBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null }; }
      static getDerivedStateFromError(error) { return { error }; }
      componentDidCatch(error) { reportClientError('boundary: ' + error.message, error.stack); }
      render() {
        if (this.state.error) {
          return h('div', { style: { padding: 24, fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' } },
            '语音界面出错了：' + this.state.error.message);
        }
        return this.props.children;
      }
    }

    function VoicePageGuarded(props) {
      return h(VoiceBoundary, null, h(VoicePage, props));
    }

    /* ---------- registration ---------- */

    // Debug/test handle, exposed only when __VC_TEST__ is set before module
    // load. Production exposes nothing: diagnostics go through the flow log
    // and the client-error reporter, never a writable global state object.
    const testApi = globalThis.__VC_TEST__ === true ? {
      voice,
      beginPendingSend,
      cancelPendingSend,
      submitPendingSend,
      resumeListening,
      isCurrentTurn,
      landTranscript,
      handleComposerSnapshot,
      setScopedError,
      clearScopedError,
      retryMic,
      retrySpeaking,
      stopSpeaking,
      isSpeaking,
      engineInfo,
      endVoice,
      startVoice,
      setComposerSnapshot(draft, phase) {
        voice.composerDraft = draft;
        voice.composerPhase = phase;
      },
      setOwner(owner) { voice.owner = owner; },
    } : null;
    if (testApi) globalThis.__vc = { voice, speak, test: testApi };

    return {
      inject: ['slots', 'locale', 'remote', 'layout', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'voice-conversation: dictionaries');
        ctx.effect(() => {
          const onError = (e) => reportClientError(e.message, e.error && e.error.stack);
          const onRejection = (e) => reportClientError('unhandledrejection: ' + (e.reason && e.reason.message || e.reason), e.reason && e.reason.stack);
          window.addEventListener('error', onError);
          window.addEventListener('unhandledrejection', onRejection);
          return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
          };
        }, 'voice-conversation: error reporter');
        try { svc.remoteRoot = ctx.remote; } catch { svc.remoteRoot = null; }
        try { svc.layout = ctx.layout; } catch { svc.layout = null; }
        try { svc.uiWorkspace = ctx.uiWorkspace; } catch { svc.uiWorkspace = null; }
        // Nested Remote namespaces must be injected by their dotted path on a scope.
        try {
          ctx.inject(['remote.speech'], (scope) => { svc.speech = scope.remote.speech; });
        } catch { svc.speech = null; }

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right', id: 'voice-start', order: 90, locale: NS,
        }, VoiceStartButton));

        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: 'voice-minibar', order: 90, locale: NS,
        }, VoiceMiniBar));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
        }, VoicePageGuarded));

        // The auto-send/auto-read effects live in one always-mounted root entry:
        // mounting them inside the voice page AND the minibar double-fired the
        // send timer and the read-aloud pass whenever both views were alive.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'voice-effects', order: 90,
        }, VoiceEffects));

        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions', id: 'voice-speak', order: 30, locale: NS,
        }, SpeakAction));

        // Best-effort notice so the host can idle-stop the clone server when the
        // page goes away without an explicit "end voice".
        ctx.effect(() => {
          const onUnload = () => {
            try { navigator.sendBeacon(ROUTE_CONTROL, JSON.stringify({ action: 'page-unload' })); } catch { /* noop */ }
          };
          window.addEventListener('pagehide', onUnload);
          return () => window.removeEventListener('pagehide', onUnload);
        }, 'voice-conversation: unload notice');

        // Plugin reload/disable disposes this fiber: the module-level session
        // (mic stream, recorder, playback, timers) must not outlive it.
        ctx.effect(() => () => {
          try { endVoice({ unload: true }); } catch { /* teardown must not throw */ }
        }, 'voice-conversation: session teardown');
      },
    };
  },
});
