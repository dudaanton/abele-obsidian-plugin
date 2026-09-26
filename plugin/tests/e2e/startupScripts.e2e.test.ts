/**
 * Startup scripts, in the running app.
 *
 * With a scripts folder of the run's own (written for the run and removed after it), the app is
 * reloaded — a start like any other for the plugin — and:
 *
 * - the scripts on the startup list run in its order, then the one with `@startup` in its
 *   header, each after the last has finished: they write to one log note, in that order;
 * - one that throws is a failed run, and the ones after it still run;
 * - one that needs a value with no default is not run;
 * - one whose header says `@startup mobile` is not run on a computer;
 * - with "Don't run startup scripts" on, a reload runs none of them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele startup scripts e2e'
const SCRIPTS = `${DIR}/Scripts`
const LOG = `${DIR}/Startup log.md`

const appending = (name: string, header: string, word: string, delay = 0) => `// @name ${name}
${header}
await new Promise((r) => setTimeout(r, ${delay}))
let old = null
try { old = await read(${JSON.stringify(LOG)}) } catch {}
if (old === null) await create(${JSON.stringify(LOG)}, ${JSON.stringify(word)} + '\\n')
else await write(${JSON.stringify(LOG)}, old + ${JSON.stringify(word)} + '\\n')`

const FILES: Record<string, string> = {
  // Slow on purpose: the next one waits for it rather than starting beside it.
  'first.js': appending('E2E startup first', '// @description Listed first', 'first', 800),
  'boom.js': `// @name E2E startup boom\nthrow new Error('boom at startup')`,
  'needy.js': appending('E2E startup needy', '// @param query string "What to look for"', 'needy'),
  'second.js': appending('E2E startup second', '// @startup', 'second'),
  'phone.js': appending('E2E startup phone', '// @startup mobile', 'phone'),
}

const LIST = [
  { script: 'E2E startup first', devices: 'both' },
  { script: 'E2E startup boom', devices: 'both' },
  { script: 'E2E startup needy', devices: 'both' },
]

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const T = window.__abeleTest
  const config = T.AbeleConfig.getInstance()
  const log = async () => {
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(LOG)})
    return f ? await app.vault.read(f) : null
  }
  const runs = () => T.ScriptRuns.getInstance().runs.value
    .filter((r) => r.source === 'startup')
    .map((r) => ({ name: r.name, status: r.status }))
`

const run = <T>(body: string, timeout = 90_000): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    timeout
  )

describe.skipIf(!available)('startup scripts', () => {
  let saved = { folder: '', list: [] as unknown, paused: false }

  beforeAll(() => {
    saved = evalJson(
      `(() => { const ai = window.__abeleTest.AbeleConfig.getInstance().ai
        return { folder: ai.scriptsFolder ?? '', list: ai.startupScripts ?? [], paused: !!ai.startupScriptsPaused } })()`
    )
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        await app.vault.createFolder(${JSON.stringify(SCRIPTS)})
        const files = ${JSON.stringify(FILES)}
        for (const [name, text] of Object.entries(files)) {
          await app.vault.create(${JSON.stringify(SCRIPTS)} + '/' + name, text)
        }
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.ai = { ...config.ai, scriptsFolder: ${JSON.stringify(SCRIPTS)},
          startupScripts: ${JSON.stringify(LIST)}, startupScriptsPaused: false }
        await config.saveSettings()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(async () => {
    evalRaw(
      `(async () => {
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.ai = { ...config.ai, scriptsFolder: ${JSON.stringify(saved.folder)},
          startupScripts: ${JSON.stringify(saved.list)}, startupScriptsPaused: ${saved.paused} }
        await config.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        await window.__abeleTest.ScriptService.getInstance().discover()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('runs them at startup in order, past one that fails, and skips what cannot run here', async () => {
    await reloadApp()

    const r = run<{ error?: string; log?: string | null; runs?: unknown[]; marker?: unknown }>(`
      const text = await until(async () => { const t = await log(); return t && t.includes('second') && t }, 30000)
      await wait(1500)
      return {
        log: await log(),
        runs: runs(),
        marker: app.loadLocalStorage('abele-startup-script-running'),
      }
    `)

    expect(r.error).toBeUndefined()
    expect(r.log).toBe('first\nsecond\n')
    // Newest first in the list of runs.
    expect(r.runs).toEqual([
      { name: 'E2E startup second', status: 'done' },
      { name: 'E2E startup boom', status: 'failed' },
      { name: 'E2E startup first', status: 'done' },
    ])
    expect(r.marker ?? null).toBeNull()
  })

  it('runs none of them while "Don\'t run startup scripts" is on', async () => {
    run(`
      await app.vault.delete(app.vault.getAbstractFileByPath(${JSON.stringify(LOG)}))
      config.ai = { ...config.ai, startupScriptsPaused: true }
      await config.saveSettings()
      return { ok: true }
    `)
    await reloadApp()

    const r = run<{ error?: string; log?: string | null; runs?: unknown[] }>(`
      await until(() => T.ScriptService.getInstance().getAll().length === 5, 15000)
      await wait(5000)
      const result = { log: await log(), runs: runs() }
      config.ai = { ...config.ai, startupScriptsPaused: false }
      await config.saveSettings()
      return result
    `)

    expect(r.error).toBeUndefined()
    expect(r.log).toBeNull()
    expect(r.runs).toEqual([])
  })
})
