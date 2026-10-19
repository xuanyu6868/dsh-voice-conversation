/**
 * Stable bootstrap for the voice-conversation Host half. The Cordis loader
 * caches ESM modules per process, so the executable logic lives in impl.mjs
 * and is re-imported with a cache-busting query on every (re)activation —
 * edit impl.mjs and toggle the plugin to iterate, no app restart needed.
 * @module @local/voice-conversation
 */
export const inject = ['webServer', 'timer']

export async function apply(ctx, config) {
  const impl = new URL('./impl.mjs', import.meta.url)
  impl.searchParams.set('v', String(Date.now()))
  const mod = await import(impl.href)
  return mod.apply(ctx, config)
}
