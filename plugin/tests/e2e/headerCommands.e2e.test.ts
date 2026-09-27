/**
 * Command buttons in a note's header, in the running app.
 *
 * With notes of the run's own (written for it and removed after it):
 *
 * - a button for a folder shows on the notes inside it and not on one outside, as the same tab
 *   goes from one to the other; pressed, it runs its command — here a script's, which says
 *   which note was in front;
 * - going between two notes that show the same buttons leaves the header alone: the button is
 *   the same element, not a new one drawn over it;
 * - a button whose command is not there — its plugin off — shows nowhere;
 * - on a phone (390×844, `emulateMobile`) the header holds two of them, the rest are at the top
 *   of the note's more-options menu, and every icon of the header stays on screen — pictured to
 *   `/tmp/abele-phone/header-commands.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele header commands e2e'
const SCRIPTS = `${DIR}/Scripts`
const INSIDE = `${DIR}/Inside/First.md`
const INSIDE_TOO = `${DIR}/Inside/Second.md`
const OUTSIDE = `${DIR}/Outside/Third.md`
const SHOTS = '/tmp/abele-phone'

const SCRIPT = `// @name E2E header command
// @icon rocket
return 'ran on ' + (activeNotePath() ?? '')`

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const T = window.__abeleTest
  const config = T.AbeleConfig.getInstance()
  const scripts = T.ScriptService.getInstance()
  const scriptCommand = () => 'abele:' + scripts.getAll().find((s) => s.meta.name === 'E2E header command')?.commandId
  const leafOf = async (path) => {
    let leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path.startsWith(${JSON.stringify(DIR)}))
    if (!leaf) leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(app.vault.getAbstractFileByPath(path))
    app.workspace.setActiveLeaf(leaf, { focus: true })
    await wait(300)
    return leaf
  }
  const ours = (leaf) => [...leaf.view.containerEl.querySelectorAll('.view-actions .abele-command-action')]
  const ids = (leaf) => ours(leaf).map((b) => b.dataset.button)
  const setButtons = async (list) => { config.headerButtons = list; config.version.value++; await config.saveSettings(); await wait(300) }
  const button = (id, extra) => ({ id, name: id, icon: 'star', noteTypes: [], runs: 'command', scriptName: '', commandId: '', params: {}, enabled: true, iconOnly: false, allNotes: true, folders: [], tags: [], otherFiles: false, conditions: [], conditionMode: 'all', ...extra })
  const lastRun = () => T.ScriptRuns.getInstance().runs.value[0]
`

const run = <T>(body: string, timeout = 90_000): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    timeout
  )

describe.skipIf(!available)('command buttons in the note header', () => {
  let saved: { folder: string; buttons: unknown } = { folder: '', buttons: [] }
  let size: [number, number] = [0, 0]

  beforeAll(() => {
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    saved = evalJson(
      `({ folder: window.__abeleTest.AbeleConfig.getInstance().ai.scriptsFolder ?? '',
          buttons: window.__abeleTest.AbeleConfig.getInstance().headerButtons })`
    )
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        for (const f of [${JSON.stringify(DIR)}, ${JSON.stringify(SCRIPTS)}, ${JSON.stringify(`${DIR}/Inside`)}, ${JSON.stringify(`${DIR}/Outside`)}]) await app.vault.createFolder(f)
        await app.vault.create(${JSON.stringify(`${SCRIPTS}/header.js`)}, ${JSON.stringify(SCRIPT)})
        for (const p of [${JSON.stringify(INSIDE)}, ${JSON.stringify(INSIDE_TOO)}, ${JSON.stringify(OUTSIDE)}]) await app.vault.create(p, 'Some words.\\n')
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.ai = { ...config.ai, scriptsFolder: ${JSON.stringify(SCRIPTS)} }
        await config.saveSettings()
        await window.__abeleTest.ScriptService.getInstance().discover()
        await new Promise((r) => setTimeout(r, 300))
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(async () => {
    if (evalJson<boolean>('app.isMobile')) {
      evalRaw(
        `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]}); return 'ok' })()`
      )
      await reloadApp('app.emulateMobile(false)')
    }
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('markdown')) {
          if (leaf.view.file?.path.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        }
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.headerButtons = ${JSON.stringify(saved.buttons)}
        config.ai = { ...config.ai, scriptsFolder: ${JSON.stringify(saved.folder)} }
        config.version.value++
        await config.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        await window.__abeleTest.ScriptService.getInstance().discover()
        return 'ok'
      })()`,
      60_000
    )
  }, 180_000)

  it('shows a folder button only inside the folder, and runs its command on that note', () => {
    const r = run<{
      error?: string
      inside?: string[]
      outside?: string[]
      back?: string[]
      label?: string
      output?: string
    }>(`
      await until(() => scripts.getAll().some((s) => s.meta.name === 'E2E header command'), 15000)
      await setButtons([button('in-folder', { name: 'Run it', icon: 'rocket', commandId: scriptCommand(), allNotes: false, folders: [${JSON.stringify(`${DIR}/Inside`)}] })])
      let leaf = await leafOf(${JSON.stringify(INSIDE)})
      const inside = await until(() => ids(leaf).length && ids(leaf))
      leaf = await leafOf(${JSON.stringify(OUTSIDE)})
      const outside = (await until(() => ids(leaf).length === 0 && [])) ?? ids(leaf)
      leaf = await leafOf(${JSON.stringify(INSIDE)})
      const back = await until(() => ids(leaf).length && ids(leaf))
      const el = ours(leaf)[0]
      const label = el?.getAttribute('aria-label')
      // Another tab in front: the button's own note is the one the command runs on.
      const other = app.workspace.getLeaf('split')
      app.workspace.setActiveLeaf(other, { focus: true })
      const before = lastRun()?.id
      el.click()
      const done = await until(() => lastRun()?.id !== before && lastRun()?.status === 'done' && lastRun())
      other.detach()
      return { inside, outside, back, label, output: done?.result }
    `)
    expect(r.error).toBeUndefined()
    expect(r.inside).toEqual(['in-folder'])
    expect(r.outside).toEqual([])
    expect(r.back).toEqual(['in-folder'])
    expect(r.label).toBe('Run it')
    expect(r.output).toBe(`ran on ${INSIDE}`)
  })

  it('leaves the header alone between two notes that show the same buttons', () => {
    const r = run<{ error?: string; same?: boolean; connected?: boolean }>(`
      let leaf = await leafOf(${JSON.stringify(INSIDE)})
      const first = await until(() => ours(leaf)[0])
      leaf = await leafOf(${JSON.stringify(INSIDE_TOO)})
      await wait(300)
      return { same: ours(leaf)[0] === first, connected: first.isConnected }
    `)
    expect(r.error).toBeUndefined()
    expect(r.same).toBe(true)
    expect(r.connected).toBe(true)
  })

  it('shows nowhere a button whose command is not there', () => {
    const r = run<{ error?: string; shown?: string[] }>(`
      await setButtons([
        button('gone', { commandId: 'no-such-plugin:do-it' }),
        button('bold', { commandId: 'editor:toggle-bold', icon: 'bold' }),
      ])
      const leaf = await leafOf(${JSON.stringify(OUTSIDE)})
      const shown = await until(() => ids(leaf).length && ids(leaf))
      return { shown }
    `)
    expect(r.error).toBeUndefined()
    expect(r.shown).toEqual(['bold'])
  })

  it('on a phone: two in the header, the rest near the top of the note menu, and nothing cut off', async () => {
    evalRaw(
      `(() => { require('@electron/remote').getCurrentWindow().setContentSize(390, 844); return 'ok' })()`
    )
    await reloadApp('app.emulateMobile(true)')

    const r = run<{
      error?: string
      mobile?: boolean
      shown?: string[]
      menu?: string[]
      overflowing?: boolean
      visible?: boolean
    }>(`
      await until(() => T.AbeleConfig.getInstance().headerButtons.length, 15000)
      await setButtons(['one', 'two', 'three', 'four'].map((id, i) =>
        button(id, { name: 'Button ' + id, icon: ['bold', 'italic', 'star', 'rocket'][i], commandId: 'editor:toggle-bold' })))
      const leaf = await leafOf(${JSON.stringify(OUTSIDE)})
      const shown = await until(() => ids(leaf).length === 2 && ids(leaf))
      const header = leaf.view.containerEl.querySelector('.view-header')
      // Ours are drawn and whole; every icon Obsidian itself shows in the header stays on screen
      // (it hides some on a phone, which take no room).
      const onScreen = (b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth }
      const shownActions = [...leaf.view.containerEl.querySelectorAll('.view-actions .view-action')].filter((b) => b.getBoundingClientRect().width > 0)
      const visible = ours(leaf).every((b) => b.getBoundingClientRect().width > 0) && shownActions.every(onScreen)
      await wait(300)
      const img = await require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/header-commands.png', img.toPNG())
      const more = leaf.view.containerEl.querySelector('.view-actions .view-action[aria-label="More options"]')
      more?.click()
      const menuEl = await until(() => document.querySelector('.menu'))
      const menu = menuEl ? [...menuEl.querySelectorAll('.menu-item-title')].map((t) => t.textContent) : []
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      document.querySelector('.menu')?.remove()
      return {
        mobile: app.isMobile,
        shown,
        menu,
        overflowing: header.scrollWidth > header.clientWidth + 1,
        visible,
      }
    `)
    expect(r.error).toBeUndefined()
    expect(r.mobile).toBe(true)
    expect(r.shown).toEqual(['one', 'two'])
    const at = r.menu?.indexOf('Button three') ?? -1
    expect(at).toBeGreaterThanOrEqual(0)
    expect(at).toBeLessThanOrEqual(3)
    expect(r.menu?.slice(at, at + 2)).toEqual(['Button three', 'Button four'])
    expect(r.overflowing).toBe(false)
    expect(r.visible).toBe(true)
  }, 180_000)
})
