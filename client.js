/**
 * Session-aware voice companion for DeepSeek Harness. One active microphone /
 * playback owner, private per-session voice drafts, explicit session-addressed
 * prompts, native Markdown transcript and manual keyboard input. Views never
 * own recording/playback lifetimes. ASR is supplied by the configured Host
 * speech service; this plugin does not install or choose a recognition model.
 * @module @local/voice-conversation/client
 */
window.__ModuleLoader__.load({
  id: '@local/voice-conversation',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore, useMemo } = React;
    let HostMarkdown = null;
    try { HostMarkdown = require('@deepseek-ai/dsh-client-ui-primitives')?.MarkdownText || null; } catch { /* Safe text-element fallback for older hosts. */ }

    /* ------------------------------------------------------------------ */
    /* Locale                                                              */
    /* ------------------------------------------------------------------ */

    const NS = 'voice-conversation';
    const PLUGIN_VERSION = '2.1.0';
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
      'page.hint.default': '语音内容保留在当前会话中',
      'state.connecting': '正在连接…', 'state.micStarting': '正在连接麦克风…', 'state.micRecovering': '麦克风连接恢复中…',
      'input.recognizing': '正在转写', 'input.sending': '正在发送…', 'input.placeholder': '正在识别…',
      'input.unconfirmed': '发送结果未确认，请先检查会话记录', 'page.hint.speaking': '可以直接说话打断，麦克风持续开启',
      'state.listening': '正在聆听',
      'state.transcribing': '正在识别…',
      'state.thinking': '正在思考…',
      'state.speaking': '正在回答',
      'state.muted': '麦克风已静音',
      'state.error': '连接失败',
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
      'settings.asrReady': '宿主配置的识别服务（增量识别）',
      'settings.asrMissing': '不可用',
      'settings.vadNote': '停顿约 0.7 秒直接发送；持续录音与增量转写，朗读时可插话',
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
      'error.asrFailed': '识别失败，该句未发送；麦克风继续工作',
      'error.asrBacklog': '识别积压，请稍后再说',
      'error.micStalled': '麦克风没有音频，请检查输入设备并重试',
      'error.gsvFailed': '克隆服务启动失败',
      'error.draftBusy': '输入框有未发送内容，转写未写入',
      'error.synthFailed': '语音合成失败',
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
      'page.hint.default': 'Voice stays in this conversation',
      'state.connecting': 'Connecting…', 'state.micStarting': 'Connecting microphone…', 'state.micRecovering': 'Recovering microphone…',
      'input.recognizing': 'Transcribing', 'input.sending': 'Sending…', 'input.placeholder': 'Recognizing…',
      'input.unconfirmed': 'Send unconfirmed; check conversation history', 'page.hint.speaking': 'Speak to interrupt; the microphone stays on',
      'state.listening': 'Listening',
      'state.transcribing': 'Transcribing…',
      'state.thinking': 'Thinking…',
      'state.speaking': 'Answering',
      'state.muted': 'Microphone muted',
      'state.error': 'Connection failed',
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
    };

    Object.assign(zh, {
      'start.here': '在此会话开启语音', 'page.context': '沿用当前会话上下文',
      'page.foreign': '语音仍属于上方标注的会话；当前选择了另一会话。',
      'page.footer': '语音停顿直接发送 · 键盘手动发送 · 最小化持续聆听',
      'keyboard.title': '键盘输入', 'keyboard.placeholder': '在这里输入，与当前会话继续对话…',
      'keyboard.hint': '键盘文字手动发送；同时仍可直接说话。',
      'keyboard.shortcut': 'Enter 发送 · Shift + Enter 换行',
      'action.keyboard': '键盘', 'action.send': '发送', 'action.edit': '编辑', 'action.clear': '清除',
      'captions.empty': '从这一刻继续对话',
      'captions.hidden': '对话记录已隐藏，点击“对话记录”重新显示', 'action.captions': '对话记录',
      'settings.asrReady': '宿主配置的识别服务（增量识别）', 'settings.vadNote': '边说边转写；停顿约 0.7 秒直接提交，无确认倒计时。朗读时可说话打断。',
      'error.sendFailed': '发送未成功，文字已保留，请确认会话连接后重试。',
      'error.sendUnknown': '发送结果暂未确认，请先查看会话记录，勿重复发送。',
      'error.sessionUnavailable': '当前会话接口不可用，请更新或重新连接 Harness。',
    });
    Object.assign(en, {
      'start.here': 'Start voice in this chat', 'page.context': 'Uses this conversation’s context',
      'page.foreign': 'Voice still belongs to the chat shown above; another chat is selected.',
      'page.footer': 'Typed text is sent manually · Minimizing keeps voice and playback',
      'keyboard.title': 'Keyboard input', 'keyboard.placeholder': 'Type here to continue this conversation…',
      'keyboard.hint': 'Typed text is sent manually; the microphone stays on.',
      'keyboard.shortcut': 'Enter to send · Shift + Enter for a new line',
      'action.keyboard': 'Keyboard', 'action.send': 'Send', 'action.edit': 'Edit', 'action.clear': 'Clear',
      'captions.empty': 'Continue the conversation here',
      'captions.hidden': 'Conversation hidden. Select Conversation to show it.', 'action.captions': 'Conversation',
      'settings.asrReady': 'Recognition service configured in Harness', 'settings.vadNote': 'Incremental transcription; a ~0.7s pause submits without confirmation. Speak to interrupt playback.',
      'error.sendFailed': 'Send failed. Your text is kept; check the session connection before retrying.',
      'error.sendUnknown': 'Send result is unconfirmed. Check conversation history before sending again.',
      'error.sessionUnavailable': 'Session API unavailable. Update or reconnect Harness.',
    });

    /* ------------------------------------------------------------------ */
    /* Constants and preferences                                           */
    /* ------------------------------------------------------------------ */

    const TTS_OK = typeof window !== 'undefined' && 'speechSynthesis' in window
      && typeof window.SpeechSynthesisUtterance === 'function';
    const REC_OK = typeof navigator !== 'undefined'
      && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      && typeof AudioContext !== 'undefined';

    const GSV_VOICE = 'gsv-local';
    const ROUTE_TTS = '/voice-tts/tts';
    const ROUTE_CONTROL = '/voice-tts/control';

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
    const VAD_STOP_MS = 700;
    const VAD_MAX_MS = 30000;
    const VAD_NOSPEECH_MS = 12000;

    function loadPrefs() {
      if (typeof window === 'undefined') return {};
      try {
        const prefs = JSON.parse(window.localStorage.getItem(PREFS_KEY)) || {};
        if (!Object.hasOwn(prefs, 'voiceURI') || prefs.voiceURI === GSV_VOICE) prefs.voiceURI = 'edge:zh-CN-XiaoxiaoNeural';
        return prefs;
      } catch { return { voiceURI: 'edge:zh-CN-XiaoxiaoNeural' }; }
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
      if (flowBuffer.length >= 100) flowBuffer.shift();
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
        const chars = Array.from(part);
        for (let offset = 0; offset < chars.length; offset += 120) {
          const fragment = chars.slice(offset, offset + 120).join('');
          if (buf.length + fragment.length > 120 && buf) { chunks.push(buf); buf = ''; }
          buf += fragment;
        }
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

    const sessionViews = new Map(); // UI drafts only; conversation history remains owned by Harness.
    let lease = null;
    const levelListeners = new Set();
    const voice = {
      phase: 'off', sessionId: null, owner: null, version: 0,
      muted: false, requesting: false, error: '', errors: { mic: '', asr: '', draft: '', synth: '' }, errorScope: '', errorVersion: 0,
      captionsOn: loadPrefs().captions !== false, settingsOpen: false, keyboardOpen: false,
      keyboardDraft: '', keyboardRevision: 0, pageVisible: false,
      inputRows: [], captureState: 'off', readBlocked: false, readAfterSeq: -1,
      messages: [], subtitles: [], level: 0, speakingText: '', spokenId: null,
      sessionGen: 0, turnId: 0,
      sending: false, awaitingReply: false, modelRunning: false, runObserved: false, lastReply: null, startedAt: 0,
      listeners: new Set(),
      notify() { this.version++; for (const fn of [...this.listeners]) fn(); },
      subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
      set(patch) { Object.assign(this, patch); this.notify(); },
    };

    function meaningfulTranscript(value) {
      let text = String(value || '').replace(/<\|[^|]*\|>/g, '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
      if (!/[\p{L}\p{N}]/u.test(text)) return '';
      // Remove orphan ASR punctuation, not legitimate sentence punctuation,
      // signed numbers, decimals or opening quotation marks.
      text = text.replace(/^[。！？，、；：!?;,：\s]+/u, '').replace(/^\.+(?!\d)/u, '')
        .replace(/([。！？!?，,；;])(?:\s*\1)+/gu, '$1').trim();
      return text;
    }

    function withDeadline(promise, ms) {
      let timer;
      return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('send receipt timeout'), { uncertain: true })), ms);
      })]).finally(() => clearTimeout(timer));
    }

    async function dispatchMessage(value, source = 'keyboard', options = {}) {
      const text = String(value || '').trim();
      const owner = voice.owner, gen = voice.sessionGen;
      const key = 'keyboardDraft', revisionKey = 'keyboardRevision';
      const revision = voice[revisionKey];
      if (!text || !owner || voice.phase === 'off' || !voice.ready || voice.sending) return false;
      if (source === 'keyboard' && !voice.pageVisible) return false;
      if (source === 'asr' && !meaningfulTranscript(text)) return false;
      const row = options.row || inputRow();
      updateInput(row, { text, status: 'sending' });
      voice.turnId++;
      const mode = options.interrupt || voice.modelRunning || voice.awaitingReply || isSpeaking() ? 'steer' : 'queue';
      if (mode === 'steer') voice.readBlocked = true;
      stopSpeaking();
      clearScopedError('draft');
      voice.set({ sending: true, awaitingReply: true, runObserved: false, phase: 'thinking' });
      flowLog('send.start', 'source=' + source + ' mode=' + mode + ' chars=' + text.length);
      try {
        await withDeadline(owner.send(text, mode), 20_000);
        if (voice.owner !== owner || voice.sessionGen !== gen) {
          const saved = sessionViews.get(owner.sessionId);
          if (source === 'keyboard' && saved && saved[revisionKey] === revision && saved[key].trim() === text) { saved[key] = ''; saved[revisionKey]++; }
          if (source === 'keyboard' && voice.sessionId === owner.sessionId && voice[revisionKey] === revision && voice[key].trim() === text) voice.set({ [key]: '', [revisionKey]: revision + 1 });
          return true;
        }
        if (source === 'keyboard' && voice[revisionKey] === revision && voice[key].trim() === text) { voice[key] = ''; voice[revisionKey]++; }
        voice.set({ sending: false });
        updateInput(row, { status: 'accepted' });
        flowLog('send.accepted', 'source=' + source);
        return true;
      } catch (error) {
        flowLog('send.error', error?.uncertain ? 'receipt-unconfirmed' : 'rejected');
        if (voice.owner === owner && voice.sessionGen === gen) {
          setScopedError('draft', error?.uncertain ? 'error.sendUnknown' : 'error.sendFailed');
          voice.set({ sending: false, awaitingReply: false, phase: 'listening' });
          updateInput(row, { status: 'failed', error: error?.uncertain ? '发送结果未确认，请先检查会话记录，勿重复发送' : '发送失败，请检查连接后手动重试' });
        }
        return false; // No automatic retry after an uncertain receipt.
      } finally {
        if (voice.owner === owner && voice.sessionGen === gen) void Promise.resolve().then(deliverInputs);
      }
    }

    function updateKeyboardDraft(text) {
      voice.set({ keyboardDraft: String(text).slice(0, 16000), keyboardRevision: voice.keyboardRevision + 1 });
    }

    function setKeyboardOpen(open) { voice.set({ keyboardOpen: open }); maybeListen(); }
    function setPageVisible(visible) { if (voice.pageVisible !== visible) voice.set({ pageVisible: visible }); }
    function resumeListening() { if (voice.phase !== 'off') { clearScopedError('mic'); maybeListen(); } }

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
    const svc = { remoteRoot: null, remoteSession: null, sessions: null, speech: null, layout: null, uiWorkspace: null };
    function speechNs() {
      return svc.speech || null;
    }

    const PANEL_ID = 'voice';
    function openVoicePage() {
      try {
        if (svc.layout && typeof svc.layout.selectPanel === 'function') { svc.layout.selectPanel(PANEL_ID); setPageVisible(true); }
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
          setPageVisible(false);
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
    let audioUrl = null;
    let activeSynth = null;
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
      if (voice.phase === 'speaking') voice.set({ phase: voice.modelRunning || voice.awaitingReply ? 'thinking' : 'listening', speakingText: '' });
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
        signal: ctrl ? AbortSignal.any([ctrl.signal, AbortSignal.timeout(65_000)]) : AbortSignal.timeout(65_000),
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
          return;
        }
        gsvPlaying = false;
        stopPlaybackLevel();
        if (gsvAudio) { const a = gsvAudio; gsvAudio = null; a.pause(); }
        if (item.onend) item.onend();
        if (!isSpeaking() && voice.phase === 'speaking') voice.set({ phase: voice.modelRunning || voice.awaitingReply ? 'thinking' : 'listening', speakingText: '' });
        void gsvPump();
      };
      try {
        flowLog('synth.request', item.text.slice(0, 40) + (item.engine === 'edge' ? ' [edge]' : ' [stream]'));
        const synthT0 = performance.now();
        const own = prefetch && prefetch.item === item && prefetch.gen === gen ? prefetch : null;
        if (own) prefetch = null;
        else cancelPrefetch();
        const ctrl = own ? own.ctrl : new AbortController();
        activeSynth = ctrl;
        primePrefetch();
        let blob = null;
        let res = null;
        if (item.engine === 'edge') {
          if (own) flowLog('synth.prefetch-hit', 'lead=' + Math.round(synthT0 - own.startedAt) + 'ms');
          blob = await (own ? own.promise : requestSynth(item, ctrl).then(async (r) => {
            if (!r.ok || !r.body) throw new Error(await r.text().catch(() => String(r.status)));
            return r.blob();
          }));
        } else {
          res = await requestSynth(item, ctrl);
          if (!res.ok || !res.body) throw new Error(await res.text().catch(() => String(res.status)));
        }
        flowLog('synth.stream-start', 'ms=' + Math.round(performance.now() - synthT0));
        if (gen !== playbackGen) return;
        streamCtl.cancelled = false;
        streamCtl.sources = [];
        if (item.engine === 'edge') {
          const url = URL.createObjectURL(blob);
          audioUrl = url;
          const audio = new Audio(url);
          gsvAudio = audio;
          audio.onended = () => { flowLog('play.end'); URL.revokeObjectURL(url); if (audioUrl === url) audioUrl = null; finish(); return; };
          audio.onerror = () => { if (gen !== playbackGen) return; flowLog('play.error'); setScopedError('synth', 'error.synthFailed'); URL.revokeObjectURL(url); if (audioUrl === url) audioUrl = null; finish(); return; };
          attachEdgeLevel(audio);
          await audio.play();
          flowLog('play.start');
          clearScopedError('synth');
          if (item.onstart) item.onstart();
          return;
        }
        await playPcmStream(res.body, item, synthT0, gen);
        if (gen !== playbackGen) return;
        finish();
      } catch (firstError) {
        if (gen !== playbackGen) return;
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
        if (gen !== playbackGen) return;
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
          utterance.onstart = () => { if (gen !== playbackGen) return; clearScopedError('synth'); item.onstart(); };
        } else if (chunkIndex === 0) {
          utterance.onstart = () => { if (gen === playbackGen) clearScopedError('synth'); };
        }
        utterance.onend = next;
        utterance.onerror = () => { if (gen !== playbackGen) return; setScopedError('synth', 'error.synthFailed'); next(); };
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
      if (activeSynth) { activeSynth.abort(); activeSynth = null; }
      if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
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
    let playMediaSource = null;

    let lastLevelAt = 0;
    function publishLevel(raw) {
      const now = performance.now();
      if (now - lastLevelAt < 80) return;
      lastLevelAt = now;
      const next = Math.round((voice.level * 0.7 + raw * 0.3) * 20) / 20;
      if (next === voice.level) return;
      voice.level = next;
      for (const fn of [...levelListeners]) fn();
    }

    function stopMicLevel() {
      micAnalyser = null;
      // PCM has no UI RAF. Do not cancel the separate playback meter when
      // muting/replacing a microphone during an answer.
      if (!isSpeaking() && voice.level !== 0) { voice.level = 0; for (const fn of [...levelListeners]) fn(); }
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
        playMediaSource = actx.createMediaElementSource(audio);
        playMediaSource.connect(analyser);
      } catch { /* level feedback is optional */ }
    }

    /** Play a raw PCM (int16, 32kHz mono) stream chunk by chunk as it arrives. */
    async function playPcmStream(body, item, synthT0, gen) {
      const actx = getPlayCtx();
      const analyser = getPlayAnalyser();
      const reader = body.getReader();
      streamCtl.reader = reader;
      let pending = new Uint8Array(0);
      let nextTime = 0;
      let lastSrc = null;
      for (;;) {
        if (streamCtl.cancelled || gen !== playbackGen) { void reader.cancel().catch(() => {}); break; }
        const { done, value } = await reader.read();
        if (done || gen !== playbackGen) { void reader.cancel().catch(() => {}); break; }
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
      if (lastSrc && !streamCtl.cancelled && gen === playbackGen) {
        await new Promise((resolve) => { lastSrc.onended = resolve; });
        flowLog('play.end');
      }
    }

    function stopPlaybackLevel() {
      if (playMediaSource) { try { playMediaSource.disconnect(); } catch {} playMediaSource = null; }
      if (playAnalyser) { try { playAnalyser.disconnect(); } catch {} }
      playAnalyser = null;
      cancelAnimationFrame(levelRaf);
      if (voice.level !== 0) { voice.level = 0; for (const fn of [...levelListeners]) fn(); }
    }

    /* ---------- recorder + VAD + Remote transcription ---------- */

    const rec = { current: null, request: 0 };
    function disposeRecording(run) {
      if (!run || run.disposed) return;
      run.disposed = true; run.cancelled = true;
      clearInterval(run.watchdog);
      run.activeJob?.controller.abort();
      for (const job of run.queue || []) job.controller.abort();
      for (const row of voice.inputRows) {
        if (row.owner === run.owner && row.gen === run.gen && row.status === 'recognizing') updateInput(row, { status: 'failed', error: '录音已中断，未发送，请重新说' });
      }
      run.queue = []; run.partial = null;
      for (const track of run.stream.getTracks()) { track.onended = null; track.stop(); }
      if (run.processor?.port) run.processor.port.onmessage = null;
      if (run.processor) { run.processor.onaudioprocess = null; try { run.processor.disconnect(); } catch {} }
      try { run.source?.disconnect(); run.sink?.disconnect(); } catch {}
      void run.audioCtx.close().catch(() => {});
      if (rec.current === run) { rec.current = null; stopMicLevel(); }
    }
    function releaseRecorder() {
      rec.request++;
      disposeRecording(rec.current);
      voice.requesting = false;
      voice.captureState = 'off';
    }

    const yieldToUi = () => new Promise(resolve => setTimeout(resolve, 0));
    async function uint8ToBase64(bytes, valid = () => true) {
      const parts = [];
      for (let i = 0; i < bytes.length; i += 8192) {
        if (!valid()) throw new Error('stale audio encode');
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
        if (i && i % 65536 === 0) await yieldToUi();
      }
      return btoa(parts.join(''));
    }

    async function encodeWave(samples, valid = () => true) {
      const n = samples.length;
      const buffer = new ArrayBuffer(44 + n * 2), view = new DataView(buffer);
      const write = (off, text) => { for (let i = 0; i < text.length; i++) view.setUint8(off + i, text.charCodeAt(i)); };
      write(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); write(8, 'WAVE');
      write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, n * 2, true);
      for (let base = 0; base < n; base += 32768) {
        if (!valid()) throw new Error('stale audio encode');
        const end = Math.min(n, base + 32768);
        for (let i = base; i < end; i++) {
          const value = Math.max(-1, Math.min(1, samples[i]));
          view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7FFF, true);
        }
        if (end < n) await yieldToUi();
      }
      return new Uint8Array(buffer);
    }

    function isCurrentTurn(gen, turn) {
      return !!voice.sessionId && voice.phase !== 'off' && voice.sessionGen === gen && voice.turnId === turn;
    }

    // Batch-only host speech API: incremental snapshots, not a fictitious
    // streaming endpoint. One request in flight, final chunks take priority.
    const ASR_PART_SAMPLES = 5 * 16000, ASR_OVERLAP = 4800, ASR_INTERVAL = 19200;
    let inputId = 0;
    function updateInput(row, patch) {
      if (voice.owner !== row.owner || voice.sessionGen !== row.gen) return;
      Object.assign(row, patch);
      voice.set({ inputRows: [...voice.inputRows] });
    }
    function joinRecognition(left, right) {
      if (!left) return right;
      if (!right) return left;
      // Overlapping audio may repeat a boundary word. Only remove a boundary
      // match of at least two significant characters; never global deduplication.
      const chars = text => { const result = []; let i = 0; for (const c of text) { if (/[\p{L}\p{N}]/u.test(c)) result.push({ c, i }); i += c.length; } return result; };
      const a = chars(left), b = chars(right);
      for (let n = Math.min(a.length, b.length, 40); n >= 2; n--) {
        if (a.slice(-n).map(x => x.c).join('') === b.slice(0,n).map(x => x.c).join('')) return left + right.slice(b[n-1].i + 1);
      }
      return left + (/^[\p{Script=Han}]/u.test(right) ? '' : ' ') + right;
    }
    function utteranceText(utterance) { return utterance.parts.reduce((text, part) => joinRecognition(text, part.text || ''), ''); }
    function inputRow() {
      const row = { id: 'live:' + (++inputId), owner: voice.owner, gen: voice.sessionGen, text: '', status: 'recognizing',
        baseline: Math.max(-1, ...(voice.owner.lastNodes || []).map(n => Number(n.seq) || 0)), matchedSeq: null };
      // Bound retained UI/audio metadata. Never discard an unfinished submission.
      voice.set({ inputRows: [...voice.inputRows.slice(-63), row] });
      return row;
    }
    async function deliverInputs() {
      const owner = voice.owner, gen = voice.sessionGen;
      if (!owner || owner.delivering) return;
      owner.delivering = true;
      try {
        for (;;) {
          if (voice.owner !== owner || voice.sessionGen !== gen) return;
          const row = voice.inputRows.find(r => r.status === 'ready');
          if (!row || voice.sending) return;
          updateInput(row, { status: 'sending' }); // claim before await, exactly once
          const ok = await dispatchMessage(row.text, 'asr', { interrupt: row.interrupt, row });
          updateInput(row, { status: ok ? 'accepted' : 'failed' });
        }
      } finally { owner.delivering = false; }
    }
    function landTranscript(value, gen, turn) {
      if (!voice.owner || !isCurrentTurn(gen, turn)) return false;
      const text = meaningfulTranscript(value);
      if (!text) return false;
      const row = inputRow(); updateInput(row, { text, status: 'ready' }); void deliverInputs(); return true;
    }
    function maybeListen() {
      if (voice.phase === 'off' || voice.muted || voice.requesting || rec.current || !voice.owner || !voice.ready) return;
      void startListening();
    }
    function advanceVad(vad, rms, now) {
      const dt = Math.min(100, Math.max(0, now - vad.lastT)); vad.lastT = now;
      if (rms > VAD_START_RMS) { vad.aboveMs += dt; vad.silenceStart = null; }
      else { vad.aboveMs = 0; if (rms < VAD_STOP_RMS) { if (vad.silenceStart === null) vad.silenceStart = now; } else vad.silenceStart = null; }
      if (vad.aboveMs >= VAD_START_MS) vad.started = true;
      if (vad.started && (now - vad.t0 >= VAD_MAX_MS || vad.silenceStart !== null && now - vad.silenceStart >= VAD_STOP_MS)) return 'ok';
      return null;
    }
    function validCapture(run) { return rec.current === run && !run.cancelled && voice.owner === run.owner && voice.sessionGen === run.gen && voice.phase !== 'off' && !voice.muted; }
    function enqueueRecognition(run, utterance, part, final) {
      if (!validCapture(run) || part.failed) return;
      const job = { utterance, part, final, samples: Float32Array.from(part.samples), controller: new AbortController() };
      if (final) {
        if (run.partial?.part === part) run.partial = null;
        // Aborting a partial is safe: its result never submits anything.
        if (run.activeJob && !run.activeJob.final) run.activeJob.controller.abort();
        if (run.queue.length >= 12) { part.failed = true; updateInput(utterance.row, { status: 'failed', error: '识别积压，请稍后再说' }); return; }
        run.queue.push(job);
      } else if (!run.queue.length) run.partial = job; // latest partial wins
      void pumpRecognition(run);
    }
    async function pumpRecognition(run) {
      if (run.pumping) return;
      run.pumping = true;
      try {
        while (validCapture(run)) {
          const job = run.queue.shift() || run.partial;
          if (!job) break;
          if (run.partial === job) run.partial = null;
          run.activeJob = job;
          const valid = () => validCapture(run) && !job.controller.signal.aborted;
          let timeout;
          try {
            const bytes = await encodeWave(job.samples, valid);
            const audioBase64 = await uint8ToBase64(bytes, valid);
            if (!valid()) continue;
            timeout = setTimeout(() => job.controller.abort(), 12000);
            const aborted = new Promise((_, reject) => job.controller.signal.addEventListener('abort', () => reject(new Error('asr-aborted')), { once: true }));
            flowLog('asr.request', 'incremental=' + !job.final + ' samples=' + job.samples.length);
            const started = performance.now();
            const result = await Promise.race([speechNs().transcribe({ audioBase64, language: 'zh' }, job.controller.signal), aborted]);
            if (!valid()) continue;
            if (result?.ok === false) throw new Error('ASR rejected');
            job.part.text = meaningfulTranscript(result?.value?.text || result?.text || '');
            if (job.final) job.part.done = true;
            clearScopedError('asr');
            if (!job.utterance.row.text && job.part.text) flowLog('asr.first-text', 'id=' + job.utterance.row.id + ' ms=' + Math.round(performance.now() - job.utterance.row.startedAt));
            updateInput(job.utterance.row, { text: utteranceText(job.utterance) });
            flowLog('asr.result', 'final=' + job.final + ' ms=' + Math.round(performance.now() - started));
            settleUtterance(job.utterance);
          } catch (error) {
            if (validCapture(run) && job.final) {
              flowLog('asr.error', 'final=true aborted=' + job.controller.signal.aborted);
              job.part.failed = true;
              updateInput(job.utterance.row, { status: 'failed', error: '语音识别失败，请重新说；未发送' });
              setScopedError('asr', 'error.asrFailed');
            }
          } finally {
            clearTimeout(timeout); if (run.activeJob === job) run.activeJob = null;
            if (job.final) job.part.samples = [];
          }
        }
      } finally { run.pumping = false; }
    }
    function settleUtterance(utterance) {
      if (!utterance.ended || utterance.parts.some(p => !p.done || p.failed)) return;
      const text = meaningfulTranscript(utteranceText(utterance));
      if (!text) { updateInput(utterance.row, { status: 'discarded', text: '' }); flowLog('asr.discarded', 'empty-or-symbols'); return; }
      updateInput(utterance.row, { text, status: 'ready' }); void deliverInputs();
    }
    function finishListening(reason = 'ok', gen, turn, run = rec.current) {
      if (!run || !validCapture(run) || !run.utterance) return;
      const utterance = run.utterance; run.utterance = null;
      utterance.ended = true;
      flowLog('voice.endpoint', 'id=' + utterance.row.id + ' ms=' + Math.round(performance.now() - utterance.row.startedAt));
      enqueueRecognition(run, utterance, utterance.parts.at(-1), true);
      settleUtterance(utterance);
      // Keep the stream running through recognition, model work and playback.
      run.vad = null; run.preRoll = []; run.preCount = 0;
    }
    function processPcm(run, samples) {
      if (!validCapture(run) || !samples?.length) return;
      run.lastFrame = performance.now(); run.clock += samples.length / 16;
      if (voice.captureState !== 'active') { clearScopedError('mic'); voice.set({ captureState: 'active' }); }
      let sum = 0; for (const x of samples) sum += x*x;
      const rms = Math.sqrt(sum / samples.length); publishLevel(Math.min(1, rms*6));
      if (!run.vad) run.vad = { t0: run.clock, lastT: run.clock - samples.length/16, aboveMs: 0, silenceStart: null, started: false };
      const wasStarted = run.vad.started, reason = advanceVad(run.vad, rms, run.clock);
      if (!run.utterance) {
        run.preRoll.push(samples); run.preCount += samples.length;
        while (run.preCount > 6400 && run.preRoll.length > 1) run.preCount -= run.preRoll.shift().length;
        if (!run.vad.started) { if (!rms || rms < VAD_STOP_RMS) run.vad.t0 = run.clock; return; }
        if (voice.inputRows.filter(r => ['recognizing','ready','sending'].includes(r.status)).length >= 8) {
          setScopedError('asr', 'error.asrBacklog'); run.vad = null; run.preRoll = []; run.preCount = 0; return;
        }
        const interrupt = isSpeaking() || voice.modelRunning || voice.awaitingReply;
        const row = inputRow(); row.interrupt = interrupt; row.startedAt = performance.now();
        flowLog('voice.input-start', 'id=' + row.id + ' barge=' + interrupt);
        run.utterance = { row, ended: false, parts: [{ samples: [], text: '', done: false }], nextPartial: ASR_INTERVAL };
        for (const frame of run.preRoll) for (const x of frame) run.utterance.parts[0].samples.push(x);
        run.preRoll = []; run.preCount = 0; run.vad.t0 = run.clock;
        if (interrupt) { voice.readBlocked = true; stopSpeaking(); flowLog('voice.barge-in'); }
      } else {
        const part = run.utterance.parts.at(-1); for (const x of samples) part.samples.push(x);
      }
      const utterance = run.utterance, part = utterance.parts.at(-1);
      if (reason && wasStarted) { finishListening('ok', undefined, undefined, run); return; }
      if (part.samples.length >= ASR_PART_SAMPLES) {
        enqueueRecognition(run, utterance, part, true);
        utterance.parts.push({ samples: part.samples.slice(-ASR_OVERLAP), text: '', done: false });
        utterance.nextPartial = ASR_INTERVAL;
      } else if (part.samples.length >= utterance.nextPartial) {
        utterance.nextPartial = part.samples.length + ASR_INTERVAL;
        enqueueRecognition(run, utterance, part, false);
      }
    }
    const CAPTURE_WORKLET = `
      class VoicePcm extends AudioWorkletProcessor {
        constructor() { super(); this.buf=new Float32Array(1600); this.pos=0; this.phase=0; this.sum=0; this.n=0; }
        process(inputs) {
          const input=inputs[0]?.[0]; if (!input) return true;
          for (const x of input) { this.sum+=x; this.n++; this.phase+=16000;
            if (this.phase>=sampleRate) { this.phase-=sampleRate; this.buf[this.pos++]=this.sum/this.n; this.sum=0; this.n=0;
              if (this.pos===1600) { this.port.postMessage(this.buf,[this.buf.buffer]); this.buf=new Float32Array(1600); this.pos=0; }
            }
          } return true;
        }
      } registerProcessor('dsh-voice-pcm', VoicePcm);`;
    async function startListening() {
      if (voice.requesting || rec.current || !voice.owner || voice.phase === 'off' || voice.muted) return;
      if (!speechNs()) { setScopedError('asr', 'error.noAsr'); voice.set({ captureState: 'error' }); return; }
      if (!REC_OK) { setScopedError('mic', 'error.micDenied'); voice.set({ captureState: 'error' }); return; }
      const gen = voice.sessionGen, owner = voice.owner, request = ++rec.request;
      const current = () => gen === voice.sessionGen && owner === voice.owner && request === rec.request && voice.phase !== 'off' && !voice.muted;
      voice.set({ requesting: true, captureState: 'starting' });
      let stream, audioCtx, run;
      try {
        const prefs = loadPrefs();
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          ...(prefs.deviceId ? { deviceId: { exact: prefs.deviceId } } : {}) } });
        if (!current()) { for (const track of stream.getTracks()) track.stop(); return; }
        audioCtx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        run = { stream, audioCtx, gen, owner, cancelled: false, queue: [], partial: null, clock: 0, preRoll: [], preCount: 0, lastFrame: performance.now() };
        run.source = audioCtx.createMediaStreamSource(stream); run.sink = audioCtx.createGain(); run.sink.gain.value = 0;
        if (audioCtx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
          const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }));
          try { await audioCtx.audioWorklet.addModule(url); run.processor = new AudioWorkletNode(audioCtx, 'dsh-voice-pcm'); }
          catch { /* Older host/CSP: the fallback is explicitly diagnosed below. */ }
          finally { URL.revokeObjectURL(url); }
        }
        if (!current()) { disposeRecording(run); return; }
        if (run.processor) run.processor.port.onmessage = event => processPcm(run, event.data);
        else {
          if (!audioCtx.createScriptProcessor || audioCtx.sampleRate !== 16000) throw new Error('continuous PCM capture unavailable');
          run.processor = audioCtx.createScriptProcessor(2048, 1, 1);
          let buffered = [];
          run.processor.onaudioprocess = event => {
            buffered.push(...event.inputBuffer.getChannelData(0));
            while (buffered.length >= 1600) processPcm(run, Float32Array.from(buffered.splice(0,1600)));
          };
          flowLog('mic.degraded', 'ScriptProcessor fallback; background reliability requires runtime verification');
        }
        rec.current = run;
        run.source.connect(run.processor); run.processor.connect(run.sink); run.sink.connect(audioCtx.destination);
        for (const track of stream.getTracks()) track.onended = () => {
          if (validCapture(run)) recoverCapture(run);
        };
        run.watchdog = setInterval(() => checkCapture(run), 1000);
        clearScopedError('mic'); flowLog('mic.connected', run.processor.port ? 'AudioWorklet' : 'ScriptProcessor');
      } catch (error) {
        if (run) disposeRecording(run);
        else { if (stream) for (const track of stream.getTracks()) track.stop(); if (audioCtx) void audioCtx.close().catch(() => {}); }
        if (current()) { setScopedError('mic', 'error.micDenied'); voice.set({ captureState: 'error' }); }
        flowLog('mic.error', String(error?.name || 'setup-failed'));
      } finally { if (current()) voice.set({ requesting: false }); }
    }
    function checkCapture(run = rec.current) {
      if (!run || !validCapture(run)) return;
      if (performance.now() - run.lastFrame > 2500) {
        if (voice.captureState !== 'recovering') { voice.set({ captureState: 'recovering' }); flowLog('mic.stalled', run.audioCtx.state); }
        if (run.audioCtx.state === 'suspended') void run.audioCtx.resume().catch(() => {});
        if (performance.now() - run.lastFrame > 5000) {
          recoverCapture(run);
        }
      }
    }

    function recoverCapture(run) {
      const owner = run.owner, now = performance.now();
      if (!owner.recoveryAt || now - owner.recoveryAt > 30000) { owner.recoveryAt = now; owner.recoveryCount = 0; }
      disposeRecording(run);
      if ((owner.recoveryCount = (owner.recoveryCount || 0) + 1) <= 3) { voice.set({ captureState: 'recovering' }); maybeListen(); }
      else { setScopedError('mic', 'error.micStalled'); voice.set({ captureState: 'error' }); }
    }

    /* ---------- session-level operations ---------- */

    function saveSessionView() {
      if (!voice.sessionId) return;
      sessionViews.set(voice.sessionId, { keyboardDraft: voice.keyboardDraft,
        keyboardOpen: voice.keyboardOpen, muted: voice.muted, keyboardRevision: voice.keyboardRevision });
    }

    function releaseSession() {
      if (lease) { const current = lease; lease = null; try { current.release(); } catch { /* host already disposed */ } }
    }

    function assertReceipt(result) {
      if (!result || result.ok !== true) throw new Error('session prompt rejected');
    }

    function createOwner(args) {
      const { sessionId, useChat, useSessions, useSession } = args;
      const ownerGen = voice.sessionGen;
      if (!sessionId) throw new Error('session identity required');
      let retained = null;
      if (svc.sessions && typeof svc.sessions.retain === 'function') {
        retained = svc.sessions.retain(sessionId, { source: 'voiceConversation' });
        lease = retained;
      }
      return { sessionId, useChat, useSessions, useSession, lastNodes: null, lastPartial: null, seenReplies: null,
        async send(text, mode = 'queue') {
          if (typeof args.send === 'function' && globalThis.__VC_TEST__ === true) return args.send(text, sessionId, mode);
          if (retained) {
            const binding = await retained.ready;
            if (binding.sessionId !== sessionId || voice.sessionGen !== ownerGen || voice.phase === 'off') throw new Error('session binding changed');
            const submission = binding.session.beginSubmission?.({ mode, text, attachments: [] });
            try { assertReceipt(await binding.session.prompt([{ type: 'text', text }], mode, undefined, submission?.requestId)); }
            catch (error) { submission?.abandon(); throw error; }
            return;
          }
          if (mode === 'queue' && svc.sessions && typeof svc.sessions.scope === 'function') {
            const scope = svc.sessions.scope(sessionId);
            if (scope?.conversation && typeof scope.conversation.send === 'function') { await scope.conversation.send(text); return; }
          }
          if (svc.remoteSession && typeof svc.remoteSession.prompt === 'function') {
            assertReceipt(await svc.remoteSession.prompt({ sessionId, requestId: crypto.randomUUID(), mode,
              content: [{ type: 'text', text }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
            return;
          }
          throw new Error('session-addressed send API unavailable');
        },
        ready: retained ? retained.ready : Promise.resolve(),
      };
    }

    async function startVoice(args) {
      if (!args.sessionId) return false;
      if (voice.phase !== 'off' && voice.sessionId === args.sessionId) { openVoicePage(); return true; }
      if (voice.phase !== 'off') endVoice({ switching: true });
      voice.sessionGen++; voice.turnId++;
      const gen = voice.sessionGen;
      const saved = sessionViews.get(args.sessionId) || {};
      resetScopedErrors();
      let owner;
      try { owner = createOwner(args); } catch { setScopedError('draft', 'error.sessionUnavailable'); return false; }
      voice.owner = owner;
      voice.set({ phase: 'connecting', ready: false, sessionId: args.sessionId, messages: [], subtitles: [],
        keyboardDraft: saved.keyboardDraft || '', keyboardRevision: saved.keyboardRevision || 0, keyboardOpen: !!saved.keyboardOpen,
        muted: !!saved.muted, captionsOn: loadPrefs().captions !== false, speakingText: '', spokenId: null, lastReply: null,
        sending: false, awaitingReply: false, modelRunning: false, runObserved: false, inputRows: [], captureState: 'off', readBlocked: false, readAfterSeq: -1,
        startedAt: Date.now(), requesting: false });
      openVoicePage();
      try {
        await owner.ready;
        if (voice.sessionGen !== gen || voice.owner !== owner) return false;
        voice.set({ ready: true, phase: 'listening' });
        maybeListen();
        flowLog('voice.start', 'engine=' + engineInfo(loadPrefs().voiceURI).id);
        return true;
      } catch {
        if (voice.owner === owner && voice.sessionGen === gen) { setScopedError('draft', 'error.sessionUnavailable'); voice.set({ phase: 'error' }); }
        return false;
      }
    }

    function endVoice(options = {}) {
      saveSessionView();
      voice.sessionGen++; voice.turnId++;
      // Disarm listening first; cleanup callbacks cannot restart it.
      voice.set({ phase: 'off', ready: false, requesting: false, sending: false, awaitingReply: false, modelRunning: false });
      releaseRecorder(); stopSpeaking(); releaseSession();
      if (playCtx) { void playCtx.close().catch(() => {}); playCtx = null; }
      voice.owner = null;
      resetScopedErrors();
      voice.set({ sessionId: null, messages: [], subtitles: [], inputRows: [], keyboardDraft: '', keyboardOpen: false,
        settingsOpen: false, pageVisible: false, speakingText: '', lastReply: null });
      if (!options.switching) closeVoicePage();
      flowLog('voice.end');
    }

    function toggleMute() {
      const muted = !voice.muted;
      voice.turnId++;
      releaseRecorder();
      voice.set({ muted, requesting: false, phase: isSpeaking() ? 'speaking' : voice.sending || voice.awaitingReply || voice.modelRunning
        ? 'thinking' : 'listening' });
      clearScopedError('mic');
      if (!muted) maybeListen();
    }

    function stopAnswer() {
      stopSpeaking();
      voice.set({ phase: voice.modelRunning || voice.awaitingReply ? 'thinking' : 'listening' });
      maybeListen();
    }

    function retryMic() {
      if (voice.phase === 'off' || !voice.owner) return;
      clearScopedError('mic'); clearScopedError('asr');
      releaseRecorder();
      voice.set({ phase: isSpeaking() ? 'speaking' : 'listening' }); maybeListen();
    }

    function retrySpeaking() {
      const reply = voice.lastReply;
      if (!reply?.text) return false;
      clearScopedError('synth');
      const hook = globalThis.__VC_TEST__ === true && globalThis.__VC_TEST_HOOKS__?.speak;
      (typeof hook === 'function' ? hook : speak)(reply.text, null, null, { source: 'reply', id: reply.id });
      return true;
    }

    function chatNodes(chat) { return chat?.legacy?.nodes || (Array.isArray(chat?.nodes) ? chat.nodes : []); }
    function assistantBody(node) { return (node.blocks || []).filter(b => b.kind === 'text').map(b => b.text || '').join('\n').trim(); }
    function assistantText(chat, messageId) {
      const nodes = chatNodes(chat);
      for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].kind === 'assistant' && nodes[i].messageId === messageId) return assistantBody(nodes[i]);
      return '';
    }

    function projectMessages(chat) {
      const nodes = chatNodes(chat), result = [];
      for (let i = nodes.length - 1; i >= 0 && result.length < 80; i--) {
        const node = nodes[i];
        if (node.kind === 'assistant') {
          const text = assistantBody(node);
          if (text) result.push({ id: 'a:' + (node.messageId || node.seq || i), who: 'assistant', text, time: node.time, streaming: false });
        } else if (node.kind === 'user' || node.kind === 'steering') {
          const text = (node.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
          if (text) result.push({ id: 'u:' + (node.seq ?? i), who: 'you', text, time: node.time, streaming: false });
        }
      }
      result.reverse();
      const partial = chat?.legacy?.partial || chat?.partial;
      if (partial) {
        const text = assistantBody(partial);
        if (text) result.push({ id: 'partial:' + partial.turn + ':' + partial.step, who: 'assistant', text, streaming: true });
      }
      return result;
    }

    function acceptChatSnapshot(chat, owner = voice.owner, gen = voice.sessionGen) {
      if (voice.owner !== owner || voice.sessionGen !== gen || voice.phase === 'off') return;
      const nodes = chatNodes(chat), partial = chat?.legacy?.partial || chat?.partial || null;
      if (owner.lastNodes === nodes && owner.lastPartial === partial) return;
      owner.lastNodes = nodes; owner.lastPartial = partial;
      // Match each optimistic speech row to exactly one native user record.
      const used = new Set(voice.inputRows.filter(r => r.matchedSeq !== null).map(r => r.matchedSeq));
      for (const row of voice.inputRows) {
        if (row.matchedSeq !== null || !['sending','accepted','failed'].includes(row.status)) continue;
        const node = nodes.find(n => (n.kind === 'user' || n.kind === 'steering') && n.seq > row.baseline && !used.has(n.seq)
          && (n.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n').trim() === row.text);
        if (node) { row.matchedSeq = node.seq; used.add(node.seq); voice.readBlocked = false; voice.readAfterSeq = node.seq; }
      }
      const messages = projectMessages(chat);
      if (messages.length !== voice.messages.length || messages.some((m, i) => m.id !== voice.messages[i]?.id || m.text !== voice.messages[i]?.text || m.streaming !== voice.messages[i]?.streaming)) voice.set({ messages });
      if (owner.seenReplies === null) {
        owner.seenReplies = new Set(nodes.filter(n => n.kind === 'assistant').map(n => n.messageId));
        return; // display existing history without replaying it on open or return
      }
      const fresh = [];
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (node.kind !== 'assistant' || !node.messageId) continue;
        if (owner.seenReplies.has(node.messageId)) break;
        owner.seenReplies.add(node.messageId);
        if (!voice.readBlocked && (node.seq == null || node.seq > voice.readAfterSeq) && !node.interrupted && assistantBody(node)) fresh.unshift(node);
      }
      if (fresh.length && !owner.useSession) voice.set({ awaitingReply: false });
      for (const node of fresh) {
        if (voice.owner !== owner || voice.sessionGen !== gen) return;
        flowLog('reply.final', 'chars=' + assistantBody(node).length);
        const hook = globalThis.__VC_TEST__ === true && globalThis.__VC_TEST_HOOKS__?.speak;
        (typeof hook === 'function' ? hook : speak)(assistantBody(node), null, null, { source: 'reply', id: node.messageId });
      }
    }

    function acceptRunning(running, owner = voice.owner, gen = voice.sessionGen) {
      if (voice.owner !== owner || voice.sessionGen !== gen) return;
      if (running) {
        voice.set({ phase: isSpeaking() ? 'speaking' : 'thinking' });
      }
      const observed = voice.runObserved || running;
      const done = !running && observed;
      voice.set({ modelRunning: !!running, runObserved: observed, ...(done ? { awaitingReply: false } : {}) });
      if (done && !isSpeaking() && !voice.sending) { voice.set({ phase: 'listening' }); maybeListen(); }
    }

    /* ---------- styles ---------- */

    const STYLES = `
.dsh-vc-page { --vc-accent:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#517cef); --vc-soft:color-mix(in srgb,var(--vc-accent) 10%,transparent); display:flex; flex-direction:column; height:100%; min-height:0; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); position:relative; font-family:inherit; }
.dsh-vc-page *, .dsh-vc-minibar * { box-sizing:border-box; }
.dsh-vc-page button, .dsh-vc-page textarea, .dsh-vc-page select { font:inherit; }
.dsh-vc-page button { cursor:pointer; }
.dsh-vc-page button:disabled { cursor:default; opacity:.45; }
.dsh-vc-page button:focus-visible, .dsh-vc-page textarea:focus-visible, .dsh-vc-start:focus-visible { outline:2px solid var(--vc-accent,#517cef); outline-offset:3px; }
.dsh-vc-start { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border:0; border-radius:8px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; padding:0; }
.dsh-vc-start:hover, .dsh-vc-iconbtn:hover { background:var(--dsw-alias-bg-layer-2); }
.dsh-vc-start[data-active="true"] { color:var(--dsw-alias-brand-primary); }
.dsh-vc-start[data-pending="true"] { opacity:.45; }
.dsh-vc-top { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:20px 28px; border-bottom:1px solid var(--dsw-alias-border-l1); flex:none; }
.dsh-vc-title { display:flex; align-items:center; gap:12px; min-width:0; }
.dsh-vc-title strong { font-size:16px; font-weight:600; }
.dsh-vc-mark { width:36px; height:36px; display:grid; place-items:center; border-radius:12px; color:var(--vc-accent); background:var(--vc-soft); flex:none; }
.dsh-vc-session { font-size:12px; color:var(--dsw-alias-label-secondary); margin-top:4px; max-width:38vw; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dsh-vc-topactions { display:flex; align-items:center; gap:8px; flex:none; }
.dsh-vc-context-pill { font-size:11px; color:var(--dsw-alias-label-secondary); border:1px solid var(--dsw-alias-border-l1); border-radius:999px; padding:5px 10px; }
.dsh-vc-iconbtn { display:inline-grid; place-items:center; width:34px; height:34px; border:0; border-radius:9px; background:transparent; color:var(--dsw-alias-label-secondary); }
.dsh-vc-stage { display:flex; align-items:center; gap:18px; width:min(100%,960px); margin:0 auto; padding:22px 32px; flex:none; }
.dsh-vc-state-copy { flex:1; min-width:0; }
.dsh-vc-stage-actions { display:flex; flex-wrap:wrap; gap:6px; }
.dsh-vc-orb { display:grid; place-items:center; width:54px; height:54px; flex:none; border-radius:50%; color:white; background:linear-gradient(145deg,color-mix(in srgb,var(--vc-accent) 70%,white),var(--vc-accent)); box-shadow:0 0 0 calc(5px + var(--dsh-vc-level,0)*14px) var(--vc-soft); transform:scale(calc(1 + var(--dsh-vc-level,0)*.14)); transition:transform .16s,box-shadow .16s,opacity .16s; }
.dsh-vc-orb svg { width:26px; height:26px; }
.dsh-vc-orb[data-muted="true"], .dsh-vc-orb[data-off="true"] { opacity:.5; box-shadow:0 0 0 5px var(--vc-soft); transform:none; }
.dsh-vc-state { font-size:16px; font-weight:550; line-height:1.5; }
.dsh-vc-hint { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:1.6; margin-top:4px; }
.dsh-vc-captions { flex:1; min-height:100px; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; padding:8px 32px 24px; position:relative; scrollbar-gutter:stable; }
.dsh-vc-transcript { max-width:896px; margin:0 auto; }
.dsh-vc-capline { display:flex; flex-direction:column; align-items:flex-start; margin:12px 0 26px; line-height:1.85; font-size:15px; overflow-wrap:anywhere; }
.dsh-vc-capline[data-who="you"] { align-items:flex-end; }
.dsh-vc-capwho { font-size:11px; color:var(--dsw-alias-label-secondary); margin-bottom:6px; }
.dsh-vc-input-status { display:block; font-size:11px; opacity:.65; margin-top:4px; }
.dsh-vc-usertext[data-live] { border:1px solid color-mix(in srgb,var(--vc-accent) 30%,transparent); }
.dsh-vc-usertext { max-width:85%; padding:11px 17px; border-radius:18px 18px 5px 18px; background:var(--vc-soft); white-space:pre-wrap; }
.dsh-vc-response { width:100%; min-width:0; }
.dsh-vc-markdown p { margin:.5em 0 .9em; white-space:pre-wrap; }
.dsh-vc-markdown ul { padding-left:1.4em; margin:.7em 0; }
.dsh-vc-markdown li { margin:.35em 0; }
.dsh-vc-markdown h3 { font-size:1.05em; margin:1em 0 .5em; }
.dsh-vc-markdown pre { background:var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l1); border-radius:12px; padding:14px; overflow-x:auto; white-space:pre; font-size:13px; }
.dsh-vc-markdown code { font-family:ui-monospace,monospace; }
.dsh-vc-capempty { min-height:180px; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--dsw-alias-label-secondary); padding:40px 12px; text-align:center; }
.dsh-vc-capempty>svg { width:36px; height:36px; color:var(--vc-accent); opacity:.45; }
.dsh-vc-capempty p { margin:16px 0 8px; font-size:14px; }
.dsh-vc-capempty small, .dsh-vc-hidden-captions { font-size:12px; }
.dsh-vc-hidden-captions { display:grid; place-items:center; color:var(--dsw-alias-label-secondary); }
.dsh-vc-backlatest { position:sticky; display:block; bottom:0; margin:0 auto; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-overlay); border-radius:20px; padding:7px 14px; color:var(--dsw-alias-label-primary); font-size:12px; box-shadow:0 2px 12px #00000008; }
.dsh-vc-dock { width:min(100%,960px); margin:0 auto; padding:8px 32px 16px; flex:none; }
.dsh-vc-composer { border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); border-radius:18px; padding:13px 16px; margin-bottom:12px; box-shadow:0 4px 20px #00000004; }
.dsh-vc-composer:focus-within { border-color:color-mix(in srgb,var(--vc-accent) 55%,transparent); }
.dsh-vc-review-label { display:block; font-size:11px; color:var(--dsw-alias-label-secondary); line-height:1.5; }
.dsh-vc-composer textarea { display:block; width:100%; min-height:58px; max-height:160px; margin:8px 0; padding:0; resize:vertical; border:0; outline:none; background:transparent; color:inherit; line-height:1.6; font-size:14px; }
.dsh-vc-composer-bottom { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.dsh-vc-composer-bottom small { color:var(--dsw-alias-label-secondary); font-size:11px; }
.dsh-vc-send { background:var(--vc-accent); border:0; border-radius:10px; padding:7px 18px; color:white; font-size:12px!important; flex:none; }
.dsh-vc-review-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; align-items:center; gap:8px; }
.dsh-vc-controls { display:flex; justify-content:center; gap:12px; flex-wrap:wrap; }
.dsh-vc-ctl { display:inline-flex; align-items:center; gap:7px; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); font-size:12px!important; min-height:42px; padding:6px 13px; }
.dsh-vc-ctlcircle { display:grid; place-items:center; width:21px; height:24px; }
.dsh-vc-ctl:hover { background:var(--dsw-alias-bg-layer-2); }
.dsh-vc-ctl[aria-pressed="true"] { color:var(--vc-accent); background:var(--vc-soft); border-color:color-mix(in srgb,var(--vc-accent) 25%,transparent); }
.dsh-vc-ctl[data-danger="true"] { color:var(--dsw-alias-state-error-primary,#dd5555); }
.dsh-vc-footer-note { text-align:center; font-size:10px; color:var(--dsw-alias-label-secondary); margin-top:10px; line-height:1.6; }
.dsh-vc-retry, .dsh-vc-stopanswer { border:1px solid var(--dsw-alias-border-l1); border-radius:9px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); padding:5px 10px; font-size:12px!important; }
.dsh-vc-notice { display:flex; align-items:center; justify-content:center; gap:12px; padding:10px 20px; font-size:12px; background:var(--vc-soft); color:var(--dsw-alias-label-secondary); }
.dsh-vc-settings { position:absolute; top:74px; right:24px; z-index:20; width:290px; max-height:70%; overflow-y:auto; border:1px solid var(--dsw-alias-border-l1); border-radius:16px; background:var(--dsw-alias-bg-overlay); box-shadow:0 12px 32px #00000016; padding:18px; display:flex; flex-direction:column; gap:14px; font-size:12px; }
.dsh-vc-settings h3 { margin:0; font-size:14px; }
.dsh-vc-field { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.dsh-vc-field select { max-width:175px; min-width:0; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-1); color:inherit; padding:6px; font-size:12px; }
.dsh-vc-advanced { border-top:1px solid var(--dsw-alias-border-l1); padding-top:12px; color:var(--dsw-alias-label-secondary); line-height:1.8; }
.dsh-vc-preview { border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:transparent; color:inherit; padding:6px 10px; display:inline-flex; gap:5px; align-items:center; align-self:flex-start; }
.dsh-vc-minibar { box-sizing:border-box; width:calc(100% - 32px); max-width:920px; margin:0 auto; display:flex; gap:8px; align-items:center; padding:7px 10px; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); font-size:12px; }
.dsh-vc-minibar .dsh-vc-state { flex:1; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:12px; }
.dsh-vc-minibar button { display:inline-flex; align-items:center; gap:4px; border:0; border-radius:7px; background:transparent; color:inherit; padding:4px 7px; cursor:pointer; font-size:12px; }
.dsh-vc-minibar button:hover { background:var(--dsw-alias-bg-layer-2); }
.dsh-vc-livedot { width:7px; height:7px; border-radius:50%; background:var(--dsw-alias-state-idle-primary); flex:none; }
.dsh-vc-livedot[data-live="true"] { background:var(--dsw-alias-state-error-primary); }
.dsh-vc-livedot[data-speaking="true"] { background:var(--dsw-alias-brand-primary); }
@media(max-width:640px) { .dsh-vc-top { padding:14px 16px; } .dsh-vc-context-pill { display:none; } .dsh-vc-stage { padding:16px 20px; gap:14px; flex-wrap:wrap; } .dsh-vc-stage-actions { margin-left:68px; } .dsh-vc-captions { padding:4px 20px 14px; } .dsh-vc-dock { padding:6px 16px 12px; } .dsh-vc-controls { gap:6px; } .dsh-vc-ctl { padding:6px 10px; } .dsh-vc-settings { right:12px; left:12px; width:auto; } .dsh-vc-orb { width:48px; height:48px; } .dsh-vc-session { max-width:48vw; } }
@media(prefers-reduced-motion:reduce) { .dsh-vc-orb { transition:none; } }

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
    const KeyboardIcon = () => h('svg', iconProps(), h('rect', { x: 2, y: 5, width: 20, height: 14, rx: 3 }), h('path', { d: 'M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10' }));
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
        () => voice.version,
        () => voice.version,
      );
    }

    function useVoiceLevel() {
      return useSyncExternalStore(
        (fn) => { levelListeners.add(fn); return () => levelListeners.delete(fn); },
        () => voice.level,
        () => voice.level,
      );
    }

    function useSubtitles() {
      return useSyncExternalStore(
        (fn) => voice.subscribe(fn),
        () => voice.messages,
        () => voice.messages,
      );
    }

    function stateText(t) {
      if (voice.error) return t(voice.error);
      if (voice.phase !== 'off' && !voice.muted && voice.captureState !== 'active') return voice.captureState === 'recovering' ? t('state.micRecovering') : voice.captureState === 'error' ? t('error.micDenied') : t('state.micStarting');
      switch (voice.phase) {
        case 'connecting': return t('state.connecting');
        case 'listening': return voice.muted ? t('state.muted') : (voice.requesting ? t('state.requesting') : t('state.listening'));
        case 'transcribing': return t('state.transcribing');
        case 'thinking': return t('state.thinking');
        case 'speaking': return t('state.speaking');
        case 'error': return t('state.error');
        default: return t('state.off');
      }
    }

    function hintText(t) {
      if (voice.phase === 'speaking') return t('page.hint.speaking');
      if (voice.phase === 'listening') return voice.muted ? t('page.hint.muted') : t('page.hint.listening');
      return t('page.hint.default');
    }

    /* ---------- Final reply observation, explicitly bound to one owner generation ---------- */

    function VoiceEffects() {
      useVoice();
      if (!voice.owner?.useChat || voice.phase === 'off') return null;
      return h(VoiceEffectsInner, { key: voice.sessionGen, owner: voice.owner, gen: voice.sessionGen });
    }

    function VoiceEffectsInner({ owner, gen }) {
      const chat = owner.useChat(snapshot => snapshot.legacy || snapshot);
      const running = owner.useSession ? owner.useSession(snapshot => !!snapshot?.running) : null;
      useEffect(() => { acceptChatSnapshot(chat, owner, gen); }, [chat, owner, gen]);
      useEffect(() => {
        if (running !== null) acceptRunning(running, owner, gen);
      }, [running, owner, gen]);
      useEffect(() => {
        if (voice.phase !== 'thinking' || voice.sending) return undefined;
        const timer = setTimeout(() => {
          if (voice.owner !== owner || voice.sessionGen !== gen || voice.phase !== 'thinking' || voice.modelRunning || voice.sending || isSpeaking()) return;
          voice.set({ awaitingReply: false, phase: 'listening' });
          flowLog('reply.watchdog', 'no-running-turn');
          maybeListen();
        }, 25_000);
        return () => clearTimeout(timer);
      }, [owner, gen, voice.phase, voice.sending]);
      return null;
    }

    function VoiceStartButton(props) {
      useVoice();
      const mine = voice.phase !== 'off' && voice.sessionId === props.sessionId;
      const label = mine ? props.t('start.return') : props.t('start.begin');
      return h(React.Fragment, null, h('style', null, STYLES),
        h('button', { type: 'button', className: 'dsh-vc-start', 'aria-label': label, title: label,
          'data-active': mine || undefined, onClick: () => { void startVoice(props); } }, h(WaveIcon)));
    }

    /* ---------- conversation.input.dock: minimized voice bar ---------- */

    function VoiceMiniBar(props) {
      const { sessionId, usePanelInfo, t } = props;
      useVoice();
      const voicePageShowing = voice.pageVisible;

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
            h('button', { type: 'button', onClick: () => { void startVoice(props); } }, t('start.here')),
          ),
        );
      }
      if (!mine) return null;
      if (voicePageShowing) return null; // the full page is showing; no duplicate bar

      const live = voice.inputRows.findLast(row => row.matchedSeq === null && !['discarded','failed'].includes(row.status));
      const statusText = live?.text || stateText(t);
      return h(React.Fragment, null,
        h('style', null, STYLES),
        h('div', { className: 'dsh-vc-minibar' },
          h('span', {
            className: 'dsh-vc-livedot',
            'data-live': (voice.captureState === 'active' && !voice.muted) || undefined,
            'data-speaking': voice.phase === 'speaking' || undefined,
          }),
          h('span', { className: 'dsh-vc-state' }, statusText),
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

    function SettingsPanel({ t, voices, prefs, setPrefs, devices }) {
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
      const chooseVoice = (e) => setPrefs(savePrefs({ voiceURI: e.target.value }));
      const chooseRate = (e) => setPrefs(savePrefs({ rate: Number(e.target.value) }));
      const chooseDevice = (e) => { setPrefs(savePrefs({ deviceId: e.target.value || undefined })); releaseRecorder(); maybeListen(); };
      const preview = () => speak(t('settings.sample'), null);
      const sortedVoices = [...voices].sort((a, b) =>
        (/^zh/i.test(b.lang) ? 1 : 0) - (/^zh/i.test(a.lang) ? 1 : 0));
      return h('div', { className: 'dsh-vc-settings', role: 'dialog', 'aria-label': t('settings.title') },
        h('h3', null, t('settings.title')),
        h('label', { className: 'dsh-vc-field' },
          h('span', null, t('settings.voice')),
          h('select', {
            'aria-label': t('settings.voice'),
            value: prefs.voiceURI === GSV_VOICE ? GSV_VOICE : (prefs.voiceURI || ''),
            onChange: chooseVoice,
          },
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
          h('div', null, (t('page.title') === zh['page.title'] ? '插件版本：' : 'Plugin version: ') + PLUGIN_VERSION),
          h('div', null, `${t('settings.engine')}：${engineInfo(prefs.voiceURI).labelZh}`),
          h('div', null, `${t('settings.asr')}：${speechNs() ? t('settings.asrReady') : t('settings.asrMissing')}`),
          h('div', null, t('settings.vadNote')),
        ),
      );
    }

    /* ---------- subtitles ---------- */

    const MD_ZH = { code: { copyLabel: '复制代码', copiedLabel: '已复制' }, footnotes: '注释' };
    const MD_EN = { code: { copyLabel: 'Copy code', copiedLabel: 'Copied' }, footnotes: 'Footnotes' };

    // Older hosts may not export MarkdownText. This fallback creates text-only
    // React elements: no innerHTML, raw HTML execution, or unsafe-link activation.
    function inlineMarkdown(text) {
      return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? h('strong', { key: i }, part.slice(2, -2))
          : part.startsWith('`') && part.endsWith('`') ? h('code', { key: i }, part.slice(1, -1)) : part);
    }
    function SafeMarkdown({ text }) {
      const blocks = [], lines = String(text).split('\n');
      let paragraph = [], list = [], code = null;
      const flush = () => {
        if (paragraph.length) { blocks.push(h('p', { key: blocks.length }, ...inlineMarkdown(paragraph.join('\n')))); paragraph = []; }
        if (list.length) { blocks.push(h('ul', { key: blocks.length }, ...list.map((line, i) => h('li', { key: i }, ...inlineMarkdown(line))))); list = []; }
      };
      for (const line of lines) {
        if (/^\s*```/.test(line)) { flush(); if (code !== null) { blocks.push(h('pre', { key: blocks.length }, h('code', null, code.join('\n')))); code = null; } else code = []; continue; }
        if (code !== null) { code.push(line); continue; }
        if (!line.trim()) { flush(); continue; }
        const item = /^\s*(?:[-*+] |\d+[.)] )(.*)/.exec(line);
        if (item) { if (paragraph.length) flush(); list.push(item[1]); continue; }
        if (list.length) flush();
        if (/^#{1,6}\s+/.test(line)) { flush(); blocks.push(h('h3', { key: blocks.length }, ...inlineMarkdown(line.replace(/^#{1,6}\s+/, '')))); }
        else paragraph.push(line);
      }
      flush();
      if (code !== null) blocks.push(h('pre', { key: blocks.length }, h('code', null, code.join('\n'))));
      return h('div', { className: 'dsh-vc-markdown' }, ...blocks);
    }

    function VoiceOrb() {
      useVoice();
      const level = useVoiceLevel();
      return h('div', { className: 'dsh-vc-orb', 'aria-hidden': true, 'data-muted': voice.muted || undefined,
        'data-off': voice.phase === 'off' || voice.phase === 'error' || undefined, style: { '--dsh-vc-level': level } }, h(WaveIcon));
    }

    function CaptionsList({ t }) {
      const history = useSubtitles(); useVoice();
      const live = voice.inputRows.filter(row => row.matchedSeq === null && row.status !== 'discarded');
      const items = [...(voice.captionsOn ? history : []), ...live.map(row => ({ id: row.id, who: 'you', text: row.text || t('input.placeholder'), status: row.status, error: row.error }))];
      const boxRef = useRef(null), [stick, setStick] = useState(true);
      const labels = useMemo(() => t('page.title') === zh['page.title'] ? MD_ZH : MD_EN, [t]);
      useEffect(() => { const box = boxRef.current; if (box && stick) box.scrollTop = box.scrollHeight; }, [items, stick]);
      return h('div', { className: 'dsh-vc-captions', ref: boxRef, role: 'region', 'aria-label': t('action.captions'),
        onScroll: () => { const box = boxRef.current; if (box) setStick(box.scrollHeight - box.scrollTop - box.clientHeight < 48); } },
        h('div', { className: 'dsh-vc-transcript' },
          !items.length ? h('div', { className: 'dsh-vc-capempty' }, h(WaveIcon), h('p', null, t(voice.captionsOn ? 'captions.empty' : 'captions.hidden')), h('small', null, t('page.context'))) : null,
          items.map(item => h('article', { key: item.id, className: 'dsh-vc-capline', 'data-who': item.who },
            h('div', { className: 'dsh-vc-capwho' }, item.who === 'you' ? t('captions.you') : t('captions.assistant')),
            item.who === 'you' ? h('div', { className: 'dsh-vc-usertext', 'data-live': item.status === 'recognizing' || undefined }, item.text, item.status && item.status !== 'accepted' ? h('small', { className: 'dsh-vc-input-status', role: 'status' }, item.status === 'failed' ? item.error || t('input.unconfirmed') : item.status === 'recognizing' ? t('input.recognizing') : t('input.sending')) : null)
              : h('div', { className: 'dsh-vc-response' }, HostMarkdown
                ? h(HostMarkdown, { text: item.text, streaming: !!item.streaming, labels }) : h(SafeMarkdown, { text: item.text })),
          ))),
        stick ? null : h('button', { type: 'button', className: 'dsh-vc-backlatest', onClick: () => setStick(true) }, t('captions.backToLatest')));
    }

    function canSubmit() { return voice.pageVisible && voice.ready && !voice.sending; }
    function keyboardKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.nativeEvent?.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        if (canSubmit()) void dispatchMessage(voice.keyboardDraft, 'keyboard');
      }
    }

    function VoicePage(props) {
      const { t } = props;
      useVoice();
      const [prefs, setPrefs] = useState(loadPrefs), [voices, setVoices] = useState(() => TTS_OK ? window.speechSynthesis.getVoices() : []), [devices, setDevices] = useState([]);
      const owner = voice.owner; // keyed by session generation in VoicePageGuarded
      const title = owner.useSessions ? owner.useSessions(snapshot => {
        const row = snapshot?.byId?.[voice.sessionId];
        if (row) return row.title || row.displayTitle || voice.sessionId;
        const list = snapshot?.sessions || snapshot?.items || snapshot?.list || [];
        const found = Array.isArray(list) ? list.find(item => (item.id || item.sessionId) === voice.sessionId) : null;
        return found?.title || found?.name || voice.sessionId;
      }) : voice.sessionId;
      useEffect(() => {
        if (!TTS_OK) return undefined;
        const update = () => setVoices(window.speechSynthesis.getVoices());
        window.speechSynthesis.addEventListener?.('voiceschanged', update);
        return () => window.speechSynthesis.removeEventListener?.('voiceschanged', update);
      }, []);
      useEffect(() => {
        if (!REC_OK || !voice.settingsOpen) return undefined;
        let disposed = false;
        navigator.mediaDevices.enumerateDevices().then(list => { if (!disposed) setDevices(list.filter(device => device.kind === 'audioinput')); }).catch(() => {});
        return () => { disposed = true; };
      }, [voice.settingsOpen]);
      useEffect(() => { setPageVisible(true); return () => setPageVisible(false); }, []);
      const foreign = props.sessionId && props.sessionId !== voice.sessionId;
      useEffect(() => { setPageVisible(!foreign); }, [foreign]);
      return h('div', { className: 'dsh-vc-page' },
        h('style', null, STYLES),
        h('header', { className: 'dsh-vc-top' },
          h('div', { className: 'dsh-vc-title' }, h('span', { className: 'dsh-vc-mark' }, h(WaveIcon)),
            h('div', null, h('strong', null, t('page.title')), h('div', { className: 'dsh-vc-session', title }, title))),
          h('div', { className: 'dsh-vc-topactions' },
            h('span', { className: 'dsh-vc-context-pill' }, t('page.context')),
            h('button', { type: 'button', className: 'dsh-vc-iconbtn', 'aria-label': t('page.settings'), title: t('page.settings'), 'aria-pressed': voice.settingsOpen,
              onClick: () => voice.set({ settingsOpen: !voice.settingsOpen }) }, h(SlidersIcon)),
            h('button', { type: 'button', className: 'dsh-vc-iconbtn', 'aria-label': t('page.minimize'), title: t('page.minimize'), onClick: closeVoicePage }, h(ChevronDownIcon)))),
        voice.settingsOpen ? h(SettingsPanel, { t, voices, prefs, setPrefs, devices }) : null,
        foreign ? h('div', { className: 'dsh-vc-notice' }, t('page.foreign'),
          h('button', { type: 'button', className: 'dsh-vc-retry', onClick: () => { void startVoice(props); } }, t('start.here'))) : null,
        h('section', { className: 'dsh-vc-stage' }, h(VoiceOrb),
          h('div', { className: 'dsh-vc-state-copy' }, h('div', { className: 'dsh-vc-state', role: 'status' }, stateText(t)),
            h('div', { className: 'dsh-vc-hint' }, hintText(t))),
          h('div', { className: 'dsh-vc-stage-actions' },
            voice.captureState === 'error' || voice.captureState === 'recovering' ? h('button', { type: 'button', className: 'dsh-vc-retry', onClick: retryMic }, t('action.retry')) : null,
            voice.errors.synth ? h('button', { type: 'button', className: 'dsh-vc-retry', onClick: retrySpeaking }, t('action.retrySpeak')) : null,
            voice.phase === 'speaking' ? h('button', { type: 'button', className: 'dsh-vc-stopanswer', onClick: stopAnswer }, t('action.stopSpeaking')) : null)),
        h(CaptionsList, { t }),
        h('footer', { className: 'dsh-vc-dock' },
          voice.keyboardOpen ? h('form', { className: 'dsh-vc-composer', onSubmit: event => { event.preventDefault(); if (canSubmit()) void dispatchMessage(voice.keyboardDraft, 'keyboard'); } },
            h('label', { className: 'dsh-vc-review-label', htmlFor: 'dsh-vc-keyboard' }, t('keyboard.title')),
            h('textarea', { id: 'dsh-vc-keyboard', 'aria-label': t('keyboard.title'), placeholder: t('keyboard.placeholder'),
              value: voice.keyboardDraft, maxLength: 16000, autoFocus: true, rows: 2,
              onChange: event => updateKeyboardDraft(event.target.value), onKeyDown: keyboardKeyDown }),
            h('div', { className: 'dsh-vc-composer-bottom' }, h('small', null, t('keyboard.shortcut')),
              h('button', { type: 'submit', className: 'dsh-vc-send', disabled: !canSubmit() || !voice.keyboardDraft.trim() }, t('action.send')))) : null,
          h('div', { className: 'dsh-vc-controls' },
            h('button', { type: 'button', className: 'dsh-vc-ctl', disabled: !voice.ready,
              'aria-pressed': voice.muted, 'aria-label': voice.muted ? t('action.unmute') : t('action.mute'), onClick: toggleMute },
              h('span', { className: 'dsh-vc-ctlcircle' }, voice.muted ? h(MicOffIcon) : h(MicIcon)), h('span', null, voice.muted ? t('action.unmute') : t('action.mute'))),
            h('button', { type: 'button', className: 'dsh-vc-ctl', 'aria-label': t('action.keyboard'), 'aria-pressed': voice.keyboardOpen,
              onClick: () => setKeyboardOpen(!voice.keyboardOpen) }, h('span', { className: 'dsh-vc-ctlcircle' }, h(KeyboardIcon)), h('span', null, t('action.keyboard'))),
            h('button', { type: 'button', className: 'dsh-vc-ctl', 'aria-label': t('action.captions'), 'aria-pressed': voice.captionsOn,
              onClick: () => { const captionsOn = !voice.captionsOn; voice.set({ captionsOn }); savePrefs({ captions: captionsOn }); } },
              h('span', { className: 'dsh-vc-ctlcircle' }, h(CaptionsIcon)), h('span', null, t('action.captions'))),
            h('button', { type: 'button', className: 'dsh-vc-ctl', 'data-danger': true, 'aria-label': t('action.end'), onClick: () => endVoice() },
              h('span', { className: 'dsh-vc-ctlcircle' }, h(PhoneOffIcon)), h('span', null, t('action.end')))),
          h('div', { className: 'dsh-vc-footer-note' }, t('page.footer'))));
    }

    /* ---------- per-message read-aloud action (unchanged behavior) ---------- */

    function SpeakAction(props) {
      const { messageId, useChat, t } = props;
      const text = useChat(chat => assistantText(chat, messageId));
      const [speakingNow, setSpeakingNow] = useState(false);
      const [pending, setPending] = useState(false);
      // Playback is module-owned and must survive view unmounts.
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
      if (!TTS_OK && !loadPrefs().voiceURI?.startsWith('edge:')) return null;
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
      useVoice();
      return h(VoiceBoundary, { key: voice.sessionGen }, voice.owner ? h(VoicePage, props) : h('div', { className: 'dsh-vc-page' }, h('p', null, props.t('state.off'))));
    }

    /* ---------- registration ---------- */

    // Debug/test handle, exposed only when __VC_TEST__ is set before module
    // load. Production exposes nothing: diagnostics go through the flow log
    // and the client-error reporter, never a writable global state object.
    const testApi = globalThis.__VC_TEST__ === true ? {
      voice, rec, svc, sessionViews, splitSentences, dictionary: zh, VoiceEffects, VoiceMiniBar, VoiceStartButton, meaningfulTranscript,
      dispatchMessage, updateKeyboardDraft, setKeyboardOpen, setPageVisible, keyboardKeyDown,
      resumeListening, isCurrentTurn, landTranscript, advanceVad, startListening, finishListening, releaseRecorder,
      processPcm, checkCapture, joinRecognition, deliverInputs, inputRow, updateInput, pumpRecognition, encodeWave, uint8ToBase64, acceptChatSnapshot, acceptRunning, projectMessages,
      setScopedError, clearScopedError, retryMic, retrySpeaking, stopSpeaking, isSpeaking, engineInfo,
      endVoice, startVoice, publishLevel, SafeMarkdown, CaptionsList, VoicePageGuarded,
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
        ctx.inject(['sessions'], scope => { svc.sessions = scope.sessions; });
        ctx.inject(['remote.session'], scope => { svc.remoteSession = scope.remote.session; });
        // Nested Remote namespaces must be injected by their dotted path on a scope.
        try {
          ctx.inject(['remote.speech'], (scope) => { svc.speech = scope.remote.speech; maybeListen(); });
        } catch { svc.speech = null; }

        ctx.effect(() => {
          const source = svc.layout?.panelInfo;
          if (!source || typeof source.subscribe !== 'function') return undefined;
          return source.subscribe(() => {
            if (voice.phase !== 'off') setPageVisible(source.getSnapshot().activePanelId === PANEL_ID);
          });
        }, 'voice-conversation: visible panel');
        ctx.effect(() => {
          if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return undefined;
          const observer = new PerformanceObserver(list => {
            if (voice.phase === 'off') return;
            for (const entry of list.getEntries().filter(e => e.duration >= 100).slice(0, 3)) flowLog('ui.long-task', 'ms=' + Math.round(entry.duration) + ' phase=' + voice.phase);
          });
          observer.observe({ type: 'longtask', buffered: false });
          return () => observer.disconnect();
        }, 'voice-conversation: long-task diagnostics');

        ctx.slots.inject('conversation.input.right' , () => ctx.slots.register({
          name: 'conversation.input.right', id: 'voice-start', order: 90, locale: NS,
        }, VoiceStartButton));

        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: 'voice-minibar', order: 90, locale: NS,
        }, VoiceMiniBar));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
        }, VoicePageGuarded));

        // The auto-send/auto-read effects live in one always-mounted root entry:
        // mounting them inside both views would duplicate reply observation.
        // PCM capture and recognition are module-owned, outside React.
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
          try { endVoice({ unload: true }); flushFlow(); sessionViews.clear(); } catch { /* teardown must not throw */ }
        }, 'voice-conversation: session teardown');
      },
    };
  },
});
