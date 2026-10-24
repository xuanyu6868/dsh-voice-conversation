/**
 * Authenticated speech proxy. Edge TTS is the default cloud engine, reached
 * through the existing local lightweight bridge. Legacy GSV/MiniMax routes
 * remain compatible with explicit configurations; the UI does not select or
 * install a local clone model. Diagnostics use a bounded asynchronous queue.
 * @module @local/voice-conversation
 */

/** Optional composition services: ctx.get is the documented guard-free access. */
function optional(ctx, name) {
  if (typeof ctx.get !== 'function') return undefined
  const value = ctx.get(name)
  return value === undefined || value === null ? undefined : value
}

import { appendFile, mkdir } from 'node:fs/promises'

const ROUTE_TTS = '/voice-tts/tts'
const ROUTE_CONTROL = '/voice-tts/control'
const MAX_BODY_BYTES = 64 * 1024
const MAX_TEXT_CHARS = 2000
const SAMPLE_RATE = 32000

/** Answer an untrusted request; true when it was rejected. */
function rejected(ctx, req, res) {
  const connection = optional(ctx, 'connection')
  if (!connection || typeof connection.requestRejection !== 'function') return false
  const status = connection.requestRejection(req)
  if (status === undefined) return false
  res.statusCode = status
  res.end()
  return true
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > cap) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}


export function apply(ctx, userConfig) {
  const config = {
    home: `${process.env.HOME}/.dsh/edge-tts`,
    port: 9880,
    refAudioPath: '',
    promptText: '',
    promptLang: 'zh',
    warmupText: '语音合成服务预热完成。',
    warmupTimeoutMs: 300_000,
    bootTimeoutMs: 180_000,
    synthTimeoutMs: 300_000,
    maxIdleMs: 30 * 60_000,
    unloadGraceMs: 5 * 60_000,
    // engine: 'gsv' = 本地 GPT-SoVITS 克隆; 'minimax' = MiniMax T2A 云端。
    engine: 'edge',
    minimaxApiKey: process.env.MINIMAX_API_KEY || '',
    minimaxGroupId: process.env.MINIMAX_GROUP_ID || '',
    minimaxHost: 'https://api.minimaxi.com',
    minimaxModel: 'speech-02-hd',
    minimaxVoiceId: 'male-qn-qingse',
    minimaxSynthTimeoutMs: 30_000,
    ...(userConfig || {}),
  }
  // Best-effort, bounded, asynchronous logging: synchronous disk writes on
  // every audio chunk can stall the Host event loop and its desktop bridge.
  let logQueue = Promise.resolve(), queuedLogs = 0
  function appendLog(file, text) {
    if (queuedLogs >= 128) return
    queuedLogs++
    const bounded = String(text).slice(0, 65536)
    logQueue = logQueue.then(async () => {
      await mkdir(config.home, { recursive: true })
      await appendFile(file, bounded)
    }).catch(() => {}).finally(() => { queuedLogs-- })
  }
  if (!config.refAudioPath) config.refAudioPath = `${config.home}/ref.wav`
  if (!config.promptText) {
    config.promptText = '你好，我是语音助手的测试参考音频。今天天气不错，我们来说一句话，试试克隆出来的效果。'
  }
  const repoDir = `${config.home}/GPT-SoVITS`
  const pythonBin = `${config.home}/venv/bin/python`
  const base = `http://127.0.0.1:${config.port}`

  /** @type {'off'|'starting'|'ready'} */ let state = 'off'
  let starting = null
  let child = null
  let managed = false
  let inFlight = 0
  let lastActivity = 0
  let unloadDispose = null

  const touch = () => {
    lastActivity = Date.now()
    if (unloadDispose !== null) { unloadDispose(); unloadDispose = null }
  }

  async function probe() {
    try {
      const res = await fetch(`${base}/docs`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch { return false }
  }

  function spawn() {
    const subprocess = optional(ctx, 'subprocess')
    if (!subprocess) throw new Error('subprocess service unavailable')
    const env = {
      HOME: process.env.HOME,
      PATH: `${process.env.HOME}/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      TMPDIR: `${config.home}/tmp`,
      NLTK_DATA: `${config.home}/nltk_data`,
      TRANSFORMERS_OFFLINE: '1',
      HF_HUB_OFFLINE: '1',
      PYTHONUNBUFFERED: '1',
      LANG: 'C.UTF-8',
    }
    child = subprocess.spawn({
      argv: [pythonBin, 'api_v2.py', '-a', '127.0.0.1', '-p', String(config.port), '-c', 'dsh-tts.yaml'],
      cwd: repoDir,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } },
      graceMs: 5000,
      env,
    })
    managed = true
    const settle = () => { if (state !== 'off') { state = 'off'; child = null } }
    child.done.then(settle, settle)
    // Tee collected server output into a log file for observability.
    const logFile = `${config.home}/api-server-plugin.log`
    let stdoutOffset = 0
    let stderrOffset = 0
    ctx.effect(() => ctx.timer.interval(() => {
      try {
        if (child && child.collected && child.collected.stdout) {
          const read = child.collected.stdout.readFrom(stdoutOffset)
          stdoutOffset = read.nextOffset
          if (read.text) appendLog(logFile, read.text)
        }
        if (child && child.collected && child.collected.stderr) {
          const read = child.collected.stderr.readFrom(stderrOffset)
          stderrOffset = read.nextOffset
          if (read.text) appendLog(logFile, read.text)
        }
      } catch { /* logging must never break the plugin */ }
    }, 2000), 'voice-conversation: server log tee')
  }

  async function callTtsStream(text, speed) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.synthTimeoutMs)
    try {
      const res = await fetch(`${base}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text, text_lang: 'zh',
          ref_audio_path: config.refAudioPath,
          prompt_lang: config.promptLang,
          prompt_text: config.promptText,
          media_type: 'raw',
          streaming_mode: true,
          speed_factor: speed > 0 ? speed : 1,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`gpt-sovits ${res.status}: ${detail.slice(0, 300)}`)
      }
      return res.body
    } finally { clearTimeout(timer) }
  }

  const EDGE_BASE = 'http://127.0.0.1:9884'
  let edgeStarting = null

  async function probeEdge() {
    try {
      const res = await fetch(`${EDGE_BASE}/`, { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch { return false }
  }

  async function ensureEdge() {
    if (await probeEdge()) return
    if (edgeStarting) return edgeStarting
    edgeStarting = (async () => {
      const subprocess = optional(ctx, 'subprocess')
      if (!subprocess) throw new Error('subprocess service unavailable')
      subprocess.spawn({
        argv: [`${config.home}/venv/bin/python`, `${config.home}/edge-server.py`],
        cwd: config.home,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 16384 }, stderr: { maxBytes: 16384 } },
        graceMs: 3000,
        env: { HOME: process.env.HOME, PATH: `${process.env.HOME}/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, TMPDIR: `${config.home}/tmp`, LANG: 'C.UTF-8' },
      })
      const deadline = Date.now() + 30_000
      while (!(await probeEdge())) {
        if (Date.now() > deadline) throw new Error('edge-tts bridge boot timeout')
        await ctx.timer.timeout(500)
      }
      edgeStarting = null
    })().catch((e) => { edgeStarting = null; throw e })
    return edgeStarting
  }

  async function edgeResponse(text, speed, voice, stream = false, signal) {
    await ensureEdge()
    const res = await fetch(`${EDGE_BASE}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, speed, voice, stream }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`edge-tts ${res.status}: ${detail.slice(0, 300)}`)
    }
    return res
  }

  async function callEdge(text, speed, voice) {
    const res = await edgeResponse(text, speed, voice)
    const buf = Buffer.from(await res.arrayBuffer())
    // [diag] bridge-reported upstream time-to-first-audio-chunk (ms), per-request.
    buf.edgeFirstChunkMs = res.headers.get('x-edge-first-chunk-ms') || 'na'
    return buf
  }

  async function callTts(text, speed) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.synthTimeoutMs)
    try {
      const res = await fetch(`${base}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text, text_lang: 'zh',
          ref_audio_path: config.refAudioPath,
          prompt_lang: config.promptLang,
          prompt_text: config.promptText,
          media_type: 'wav',
          speed_factor: speed > 0 ? speed : 1,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`gpt-sovits ${res.status}: ${detail.slice(0, 300)}`)
      }
      return Buffer.from(await res.arrayBuffer())
    } finally { clearTimeout(timer) }
  }

  // --- MiniMax T2A cloud engine -------------------------------------------
  // Endpoint: POST {host}/v1/t2a_v2?GroupId=..., Bearer auth. Errors arrive
  // as HTTP 4xx/5xx OR as HTTP 200 with base_resp.status_code !== 0 — both
  // must be surfaced, the latter is easy to miss.

  function mmAssertConfigured() {
    if (!config.minimaxApiKey || !config.minimaxGroupId) {
      throw new Error('MiniMax 未配置：请在插件配置里填 minimaxApiKey 和 minimaxGroupId')
    }
  }

  function mmPayload(text, speed, stream) {
    return JSON.stringify({
      model: config.minimaxModel,
      text,
      stream,
      output_format: 'hex',
      voice_setting: {
        voice_id: config.minimaxVoiceId,
        speed: speed > 0 ? Math.min(2, Math.max(0.5, speed)) : 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: { sample_rate: SAMPLE_RATE, bitrate: 128000, format: 'pcm', channel: 1 },
    })
  }

  function mmPost(text, speed, stream, timeoutMs) {
    mmAssertConfigured()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const url = `${config.minimaxHost}/v1/t2a_v2?GroupId=${encodeURIComponent(config.minimaxGroupId)}`
    return fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.minimaxApiKey}`,
      },
      body: mmPayload(text, speed, stream),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
  }

  /** Throw when a MiniMax JSON frame carries a failed base_resp. */
  function mmCheckFrame(frame) {
    const base = frame && frame.base_resp
    if (base && typeof base.status_code === 'number' && base.status_code !== 0) {
      throw new Error(`minimax ${base.status_code}: ${String(base.status_msg || '').slice(0, 200)}`)
    }
  }

  /** Non-streaming: one JSON body with data.audio as hex PCM16 mono 32 kHz. */
  async function mmCallTts(text, speed) {
    const res = await mmPost(text, speed, false, config.minimaxSynthTimeoutMs)
    const raw = await res.text().catch(() => '')
    let body = null
    try { body = JSON.parse(raw) } catch { /* handled below */ }
    if (!res.ok) throw new Error(`minimax ${res.status}: ${raw.slice(0, 300)}`)
    if (!body) throw new Error('minimax: invalid json response')
    mmCheckFrame(body)
    const hex = body.data && typeof body.data.audio === 'string' ? body.data.audio : ''
    if (!hex) throw new Error('minimax: empty audio')
    return Buffer.from(hex, 'hex')
  }

  /**
   * Streaming: chunked `data: {...}` frames; each may carry hex PCM in
   * data.audio. Yields audio Buffers as they arrive so the route can flush
   * them downstream immediately. Tolerant of keep-alive junk lines.
   */
  async function* mmCallTtsStream(text, speed) {
    const res = await mmPost(text, speed, true, config.minimaxSynthTimeoutMs)
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw new Error(`minimax ${res.status}: ${detail.slice(0, 300)}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let carry = ''
    let emitted = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        carry += decoder.decode(value, { stream: true })
        let nl
        while ((nl = carry.indexOf('\n')) >= 0) {
          let line = carry.slice(0, nl).trim()
          carry = carry.slice(nl + 1)
          if (!line) continue
          if (line.startsWith('data:')) line = line.slice(5).trim()
          if (!line || line === '[DONE]') continue
          let frame = null
          try { frame = JSON.parse(line) } catch { continue }
          mmCheckFrame(frame)
          const hex = frame && frame.data && typeof frame.data.audio === 'string' ? frame.data.audio : ''
          if (hex) { emitted++; yield Buffer.from(hex, 'hex') }
        }
      }
      if (carry.trim()) {
        let line = carry.trim()
        if (line.startsWith('data:')) line = line.slice(5).trim()
        try {
          const frame = JSON.parse(line)
          mmCheckFrame(frame)
          const hex = frame && frame.data && typeof frame.data.audio === 'string' ? frame.data.audio : ''
          if (hex) { emitted++; yield Buffer.from(hex, 'hex') }
        } catch { /* trailing partial frame: ignore */ }
      }
    } finally { reader.cancel().catch(() => {}) }
    if (!emitted) throw new Error('minimax: stream carried no audio')
  }

  /** Wrap raw PCM16 mono in a WAV header for the non-streaming route. */
  function pcmToWav(pcm, sampleRate) {
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + pcm.length, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20) // PCM
    header.writeUInt16LE(1, 22) // mono
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(sampleRate * 2, 28) // byte rate
    header.writeUInt16LE(2, 32) // block align
    header.writeUInt16LE(16, 34) // bits per sample
    header.write('data', 36)
    header.writeUInt32LE(pcm.length, 40)
    return Buffer.concat([header, pcm])
  }

  async function ensureReady(engine) {
    const active = engine || config.engine
    if (active !== 'gsv') { state = 'off'; starting = null }
    if (state === 'ready') return
    if (starting) return starting
    starting = (async () => {
      state = 'starting'
      if (active === 'edge') {
        // Edge bridge: spawn if down; no model warmup needed.
        try { await ensureEdge() }
        catch (error) { state = 'off'; starting = null; throw error }
        state = 'off' // the bridge needs no tracked warm state; probes are cheap
        starting = null
        touch()
        return
      }
      if (active === 'minimax') {
        // Cloud engine: no local process. A tiny real synthesis doubles as
        // the credential/connectivity check, so a bad key fails at warmup
        // instead of mid-conversation.
        try { await mmCallTts('预热', 1) }
        catch (error) { state = 'off'; starting = null; throw error }
        state = 'ready'
        starting = null
        touch()
        return
      }
      if (!(await probe())) spawn()
      const deadline = Date.now() + config.bootTimeoutMs
      while (!(await probe())) {
        if (Date.now() > deadline) { state = 'off'; starting = null; throw new Error('gpt-sovits boot timeout') }
        await ctx.timer.timeout(2000)
      }
      // Warmup: real short syntheses with the real reference audio, retried —
      // /docs answers before the inference pipeline finishes loading, and the
      // first synthesis on a fresh process can still fail during warmup.
      let warmError = null
      for (let attempt = 0; attempt < 6; attempt++) {
        try { await callTts(config.warmupText, 1); warmError = null; break }
        catch (error) {
          warmError = error
          await ctx.timer.timeout(3000)
        }
      }
      if (warmError) { state = 'off'; starting = null; throw warmError }
      state = 'ready'
      starting = null
      touch()
    })().catch((error) => { state = 'off'; starting = null; throw error })
    return starting
  }

  async function stopServer() {
    if (config.engine === 'minimax') { state = 'off'; starting = null; return }
    const deadline = Date.now() + 60_000
    while (inFlight > 0 && Date.now() < deadline) {
      await ctx.timer.timeout(500)
    }
    state = 'off'
    starting = null
    if (child && managed) {
      child.terminate()
      await child.waitForExit(AbortSignal.timeout(10_000)).catch(() => false)
      child = null
      managed = false
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_TTS,
    handler: async (req, res) => {
      try {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'POST') { sendJson(res, 405, { message: 'POST only' }); return }
      let payload
      try { payload = JSON.parse(await readBody(req, MAX_BODY_BYTES)) } catch {
        sendJson(res, 400, { message: 'invalid json' }); return
      }
      const text = String(payload?.text || '').trim()
      const speed = Number(payload?.speed) || 1
      const engine = typeof payload?.engine === 'string' ? payload.engine : config.engine
      const stream = payload?.stream === true
      const trace = typeof payload?.traceId === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(payload.traceId) ? payload.traceId : 'none'
      if (!text || text.length > MAX_TEXT_CHARS) {
        sendJson(res, 400, { message: `text required (<= ${MAX_TEXT_CHARS} chars)` }); return
      }
      touch()
      inFlight++
      const reqT0 = Date.now()
      try {
        await ensureReady(engine)
        const readyMs = Date.now() - reqT0
        if (stream) {
          if (engine === 'edge') {
            const ctrl = new AbortController()
            let reader
            const aborted = () => { ctrl.abort(); void reader?.cancel().catch(() => {}) }
            const closed = () => { if (!res.writableEnded) aborted() }
            res.on('close', closed); req.on('aborted', aborted)
            try {
              const upstream = await edgeResponse(text, speed, payload?.voice, true, ctrl.signal)
              if (!upstream.body) throw new Error('Edge returned no body')
              reader = upstream.body.getReader()
              let bytes = 0, chunks = 0
              for (;;) {
                const { done, value } = await reader.read()
                if (ctrl.signal.aborted || res.destroyed) throw new Error('Edge client disconnected')
                if (done) break
                if (!value?.length) continue
                if (!chunks) {
                  res.statusCode = 200
                  res.setHeader('content-type', 'audio/mpeg')
                  res.setHeader('cache-control', 'no-store')
                  res.setHeader('x-accel-buffering', 'no')
                  res.setHeader('x-voice-stream', upstream.headers.get('x-edge-stream') === '1' ? 'mp3' : 'buffered-bridge')
                  res.setHeader('x-edge-first-chunk-ms', upstream.headers.get('x-edge-first-chunk-ms') || 'na')
                  res.flushHeaders?.()
                  appendLog(`${config.home}/voice-flow.log`, `${new Date().toISOString()} tts.first-byte trace=${trace} engine=edge readyMs=${readyMs} atMs=${Date.now()-reqT0}\n`)
                }
                chunks++; bytes += value.length
                if (!res.write(value)) await new Promise((resolve, reject) => {
                  const clean = () => { res.off('drain', drain); res.off('close', close); res.off('error', error); ctrl.signal.removeEventListener('abort', close) }
                  const drain = () => { clean(); resolve() }
                  const error = () => { clean(); reject(new Error('Edge downstream error')) }
                  const close = () => { clean(); reject(new Error('Edge client disconnected')) }
                  res.once('drain', drain); res.once('close', close); res.once('error', error)
                  ctrl.signal.addEventListener('abort', close, { once: true })
                  if (ctrl.signal.aborted || res.destroyed) close()
                })
              }
              if (!chunks) throw new Error('Edge returned empty audio')
              appendLog(`${config.home}/voice-flow.log`, `${new Date().toISOString()} tts.stream-done trace=${trace} engine=edge chunks=${chunks} bytes=${bytes} totalMs=${Date.now()-reqT0}\n`)
              res.end()
            } finally {
              ctrl.abort(); await reader?.cancel().catch(() => {})
              res.off('close', closed); req.off('aborted', aborted)
            }
            return
          }
          if (engine === 'minimax') {
            res.statusCode = 200
            res.setHeader('content-type', 'application/octet-stream')
            res.setHeader('x-sample-rate', String(SAMPLE_RATE))
            let firstByteMs = 0
            let chunkCount = 0
            try {
              for await (const chunk of mmCallTtsStream(text, speed)) {
                chunkCount++
                if (!firstByteMs) firstByteMs = Date.now() - reqT0
                try {
                  appendLog(`${config.home}/voice-flow.log`,
                    `${new Date().toISOString()} tts.chunk n=${chunkCount} bytes=${chunk.length} atMs=${Date.now() - reqT0}\n`)
                } catch { /* noop */ }
                if (!res.write(chunk)) await new Promise(r => res.once('drain', r))
              }
              try {
                appendLog(`${config.home}/voice-flow.log`,
                  `${new Date().toISOString()} tts.stream-done chars=${text.length} engine=minimax readyMs=${readyMs} chunks=${chunkCount} totalMs=${Date.now() - reqT0}\n`)
              } catch { /* noop */ }
            } finally { /* generator cleans up its reader */ }
            res.end()
            return
          }
          const upstream = await callTtsStream(text, speed)
          res.statusCode = 200
          res.setHeader('content-type', 'application/octet-stream')
          res.setHeader('x-sample-rate', '32000')
          let firstByteMs = 0
          let chunkCount = 0
          try {
            for await (const chunk of upstream) {
              chunkCount++
              if (!firstByteMs) {
                firstByteMs = Date.now() - reqT0
              }
              try {
                appendLog(`${config.home}/voice-flow.log`,
                  `${new Date().toISOString()} tts.chunk n=${chunkCount} bytes=${chunk.length} atMs=${Date.now() - reqT0}\n`)
              } catch { /* noop */ }
              if (!res.write(chunk)) await new Promise(r => res.once('drain', r))
            }
            try {
              appendLog(`${config.home}/voice-flow.log`,
                `${new Date().toISOString()} tts.stream-done chars=${text.length} readyMs=${readyMs} chunks=${chunkCount} totalMs=${Date.now() - reqT0}\n`)
            } catch { /* noop */ }
          } finally { upstream.cancel().catch(() => {}) }
          res.end()
          return
        }
        const synthT0 = Date.now()
        const wav = engine === 'minimax'
          ? pcmToWav(await mmCallTts(text, speed), SAMPLE_RATE)
          : engine === 'edge'
            ? await callEdge(text, speed, payload?.voice)
            : await callTts(text, speed)
        try {
          appendLog(`${config.home}/voice-flow.log`,
            `${new Date().toISOString()} tts.done trace=${trace} chars=${text.length} readyMs=${readyMs} synthMs=${Date.now() - synthT0} bytes=${wav.length} edgeFirstChunkMs=${wav.edgeFirstChunkMs || 'na'}\n`)
        } catch { /* noop */ }
        res.statusCode = 200
        res.setHeader('content-type', engine === 'edge' ? 'audio/mpeg' : 'audio/wav')
        res.end(wav)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try {
          appendLog(`${config.home}/proxy-errors.log`, `${new Date().toISOString()} 502 ${message}\n`)
        } catch { /* logging must never break the route */ }
        if (res.headersSent || res.destroyed || res.writableEnded) res.destroy?.()
        else sendJson(res, 502, { message })
      } finally { inFlight--; touch() }
      } catch { try { sendJson(res, 500, { message: 'internal error' }) } catch {} }
    },
  }), `voice-conversation: POST ${ROUTE_TTS}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_CONTROL,
    handler: async (req, res) => {
      try {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'POST') { sendJson(res, 405, { message: 'POST only' }); return }
      let payload
      try { payload = JSON.parse(await readBody(req, MAX_BODY_BYTES)) } catch { payload = {} }
      const action = String(payload?.action || '')
      touch()
      try {
        if (action === 'warmup') {
          await ensureReady()
          sendJson(res, 200, { status: 'ready' })
        } else if (action === 'status') {
          sendJson(res, 200, { status: state, engine: config.engine })
        } else if (action === 'stop') {
          await stopServer()
          sendJson(res, 200, { status: 'off' })
        } else if (action === 'flow') {
          try {
            const lines = Array.isArray(payload?.lines) ? payload.lines.slice(0, 64) : []
            if (lines.length) {
              appendLog(`${config.home}/voice-flow.log`, lines.map(l => String(l).slice(0, 300) + '\n').join(''))
            }
          } catch { /* logging must never break the route */ }
          sendJson(res, 200, { status: 'logged' })
        } else if (action === 'client-error') {
          try {
            appendLog(`${config.home}/client-errors.log`,
              `${new Date().toISOString()} ${String(payload?.message || '').slice(0, 800)}\n${String(payload?.stack || '').slice(0, 6000)}\n\n`)
          } catch { /* logging must never break the route */ }
          sendJson(res, 200, { status: 'logged' })
        } else if (action === 'page-unload') {
          // A notification only: the backend still owns the actual stop.
          if (unloadDispose !== null) unloadDispose()
          unloadDispose = ctx.timer.timeout(() => {
            unloadDispose = null
            if (state === 'ready' && inFlight === 0) void stopServer()
          }, config.unloadGraceMs)
          sendJson(res, 200, { status: 'noted' })
        } else {
          sendJson(res, 400, { message: 'unknown action' })
        }
      } catch (error) {
        sendJson(res, 502, { message: error instanceof Error ? error.message : String(error) })
      }
      } catch { try { sendJson(res, 500, { message: 'internal error' }) } catch {} }
    },
  }), `voice-conversation: POST ${ROUTE_CONTROL}`)

  // Safety net: stop a ready, idle server even if every notification was lost.
  ctx.effect(() => ctx.timer.interval(() => {
    if (state === 'ready' && inFlight === 0 && Date.now() - lastActivity > config.maxIdleMs) {
      void stopServer()
    }
  }, 60_000), 'voice-conversation: idle safety net')

  ctx.effect(() => () => {
    if (unloadDispose !== null) unloadDispose()
    if (child && managed) child.terminate()
  }, 'voice-conversation: teardown')
}
