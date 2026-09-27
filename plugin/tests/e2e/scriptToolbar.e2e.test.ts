/**
 * Scripts on the toolbar, in the running app.
 *
 * With a scripts folder of the run's own (written for the run and removed after it):
 *
 * - a script whose header says `@toolbar` has an icon on the left ribbon, its own icon with its
 *   name as the tooltip, listed among Obsidian's ribbon items; pressed, it runs on the note in
 *   front and the words selected in it. Notes' headers get nothing from it;
 * - a script pinned from the library (`ai.toolbarScripts`) gets one too and loses it when
 *   unpinned; a script whose name changes keeps its ribbon item, renamed; a deleted one loses it;
 * - the phone's toolbar above the keyboard (`mobileToolbarCommands`) gets each at its start; a
 *   renamed script keeps its place there; one the person took off is not put back; one
 *   switched off is taken off; a command put there by hand is never touched;
 * - on a phone (390×844, `emulateMobile`) there are no ribbon icons for them, the toolbar above
 *   the keyboard shows the script's icon and runs it on a tap — pictured to
 *   `/tmp/abele-phone/script-toolbar.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele script toolbar e2e'
const SCRIPTS = `${DIR}/Scripts`
const NOTE = `${DIR}/Toolbar note.md`
const SHOTS = '/tmp/abele-phone'
const OFFERED = 'abele-script-toolbar-offered'
const HAND = 'editor:toggle-bold'

const HEADED = `// @name E2E toolbar headed
// @icon rocket
// @toolbar
// @param words string? "Words" selection
return (activeNotePath() ?? '') + '|' + (params.words ?? '')`

const PLAIN = `// @name E2E toolbar pinned
// @icon anchor
return 'pinned ' + (activeNotePath() ?? '')`

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
  const idOf = (name) => 'abele:' + scripts.getAll().find((s) => s.meta.name === name)?.commandId
  const noteLeaf = () => app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === ${JSON.stringify(NOTE)})
  const openNote = async () => {
    let leaf = noteLeaf()
    if (!leaf) {
      leaf = app.workspace.getLeaf('tab')
      await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))
    }
    app.workspace.setActiveLeaf(leaf, { focus: true })
    await wait(300)
    return leaf
  }
  const RIBBON = 'abele:script:' + ${JSON.stringify(SCRIPTS)} + '/'
  const ribbonItems = () => app.workspace.leftRibbon.items.filter((i) => i.id.startsWith(RIBBON) && i.buttonEl?.isConnected)
  const ribbon = () => ribbonItems().map((i) => i.title)
  const buttons = (leaf) => [...leaf.view.containerEl.querySelectorAll('.view-actions .abele-script-action')].map((b) => b.dataset.script)
  const phone = () => app.vault.getConfig('mobileToolbarCommands') ?? []
  // The script takes a parameter, so it asks first, as from the command palette: the form is
  // answered with what it was filled with — the words selected.
  const answerForm = async () => {
    const run = await until(() => document.querySelector('.modal-container .modal button.mod-cta'))
    const field = document.querySelector('.modal-container .modal input')?.value
    run?.click()
    return field
  }
  const lastRun = () => T.ScriptRuns.getInstance().runs.value[0]
  const pin = async (names) => { config.ai = { ...config.ai, toolbarScripts: names }; await config.saveSettings(); await wait(200) }
  const rewrite = async (path, text) => { await app.vault.modify(app.vault.getAbstractFileByPath(path), text); await scripts.discover(); await wait(300) }
`

const run = <T>(body: string, timeout = 90_000): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    timeout
  )

describe.skipIf(!available)('scripts on the toolbar', () => {
  let saved: { folder: string; pinned: unknown; phone: unknown; offered: unknown } = {
    folder: '',
    pinned: [],
    phone: null,
    offered: null,
  }
  let size: [number, number] = [0, 0]

  beforeAll(() => {
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    saved = evalJson(
      `({ folder: window.__abeleTest.AbeleConfig.getInstance().ai.scriptsFolder ?? '',
          pinned: window.__abeleTest.AbeleConfig.getInstance().ai.toolbarScripts ?? [],
          phone: app.vault.config.mobileToolbarCommands ?? null,
          offered: app.loadLocalStorage(${JSON.stringify(OFFERED)}) })`
    )
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        await app.vault.createFolder(${JSON.stringify(SCRIPTS)})
        await app.vault.create(${JSON.stringify(`${SCRIPTS}/headed.js`)}, ${JSON.stringify(HEADED)})
        await app.vault.create(${JSON.stringify(`${SCRIPTS}/pinned.js`)}, ${JSON.stringify(PLAIN)})
        await app.vault.create(${JSON.stringify(NOTE)}, 'Some words to select here.\\n')
        app.saveLocalStorage(${JSON.stringify(OFFERED)}, null)
        // A command the person put on the phone's toolbar by hand, which nothing here may touch.
        app.vault.setConfig('mobileToolbarCommands', [${JSON.stringify(HAND)}])
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.ai = { ...config.ai, scriptsFolder: ${JSON.stringify(SCRIPTS)}, toolbarScripts: [] }
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
        config.ai = { ...config.ai, scriptsFolder: ${JSON.stringify(saved.folder)}, toolbarScripts: ${JSON.stringify(saved.pinned)} }
        await config.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        await window.__abeleTest.ScriptService.getInstance().discover()
        await new Promise((r) => setTimeout(r, 300))
        app.vault.setConfig('mobileToolbarCommands', ${JSON.stringify(saved.phone)} ?? undefined)
        app.saveLocalStorage(${JSON.stringify(OFFERED)}, ${JSON.stringify(saved.offered)})
        return 'ok'
      })()`,
      60_000
    )
  }, 180_000)

  it('a @toolbar script has an icon on the ribbon, and runs on the note in front and its selection', () => {
    const r = run<{
      error?: string
      ribbon?: string[]
      icon?: string
      id?: string
      headerButtons?: number
      field?: string
      output?: string
      source?: string
    }>(`
      const leaf = await openNote()
      const shown = await until(() => ribbon().length && ribbon())
      const item = ribbonItems()[0]
      leaf.view.editor.setSelection({ line: 0, ch: 5 }, { line: 0, ch: 10 })
      const before = lastRun()?.id
      item.buttonEl.click()
      const field = await answerForm()
      const done = await until(() => lastRun()?.id !== before && lastRun()?.status === 'done' && lastRun())
      return {
        ribbon: shown,
        icon: item.icon,
        id: item.id,
        headerButtons: document.querySelectorAll('.view-actions .abele-script-action').length,
        field,
        output: done?.result,
        source: done?.source,
      }
    `)
    expect(r.error).toBeUndefined()
    expect(r.ribbon).toEqual(['E2E toolbar headed'])
    expect(r.icon).toBe('rocket')
    expect(r.id).toBe(`abele:script:${SCRIPTS}/headed.js`)
    expect(r.headerButtons).toBe(0)
    expect(r.field).toBe('words')
    expect(r.source).toBe('command')
    expect(r.output).toBe(`${NOTE}|words`)
  })

  it('a pinned script gets a ribbon icon, keeps it through a rename, and loses it when unpinned or deleted', () => {
    const r = run<{
      error?: string
      on?: string[]
      renamed?: string[]
      renamedId?: string
      off?: string[]
      gone?: string[]
    }>(`
      // A line break written as a character, not an escape: the CLI turns escapes in the code into
      // real line breaks, which a string cannot hold.
      const NL = String.fromCharCode(10)
      await pin(['E2E toolbar pinned'])
      const on = await until(() => ribbon().length === 2 && ribbon())
      await rewrite(${JSON.stringify(`${SCRIPTS}/pinned.js`)}, ${JSON.stringify(PLAIN)}.replace('// @name E2E toolbar pinned', '// @name E2E toolbar pinned' + NL + '// @toolbar').replace('E2E toolbar pinned', 'E2E toolbar moved'))
      const renamed = await until(() => ribbon().includes('E2E toolbar moved') && ribbon())
      const renamedId = ribbonItems().find((i) => i.title === 'E2E toolbar moved')?.id
      await rewrite(${JSON.stringify(`${SCRIPTS}/pinned.js`)}, ${JSON.stringify(PLAIN)})
      await pin([])
      const off = await until(() => ribbon().length === 1 && ribbon())
      await app.vault.create(${JSON.stringify(`${SCRIPTS}/doomed.js`)}, ${JSON.stringify(PLAIN)}.replace('E2E toolbar pinned', 'E2E toolbar doomed').replace('// @icon anchor', '// @icon anchor' + NL + '// @toolbar'))
      await scripts.discover(); await wait(300)
      await until(() => ribbon().length === 2)
      await app.vault.delete(app.vault.getAbstractFileByPath(${JSON.stringify(`${SCRIPTS}/doomed.js`)}))
      await scripts.discover(); await wait(300)
      const gone = await until(() => ribbon().length === 1 && ribbon())
      return { on, renamed, renamedId, off, gone }
    `)
    expect(r.error).toBeUndefined()
    expect(r.on?.slice().sort()).toEqual(['E2E toolbar headed', 'E2E toolbar pinned'])
    expect(r.renamed?.slice().sort()).toEqual(['E2E toolbar headed', 'E2E toolbar moved'])
    expect(r.renamedId).toBe(`abele:script:${SCRIPTS}/pinned.js`)
    expect(r.off).toEqual(['E2E toolbar headed'])
    expect(r.gone).toEqual(['E2E toolbar headed'])
  })

  it('the phone toolbar gets them at its start, keeps a renamed one in place, and leaves the rest', () => {
    const r = run<{
      error?: string
      first?: string[]
      headed?: string
      pinnedOn?: string[]
      renamed?: string[]
      renamedId?: string
      pinnedOff?: string[]
      takenOff?: string[]
      command?: boolean
    }>(`
      const headed = idOf('E2E toolbar headed')
      const first = phone()
      const command = !!app.commands.findCommand(headed)
      await pin(['E2E toolbar pinned'])
      const pinnedOn = phone()
      await rewrite(${JSON.stringify(`${SCRIPTS}/headed.js`)}, ${JSON.stringify(HEADED)}.replace('E2E toolbar headed', 'E2E toolbar renamed'))
      const renamed = phone()
      const renamedId = idOf('E2E toolbar renamed')
      await pin([])
      const pinnedOff = phone()
      // Taken off by hand: stays off, through a rename back and a save.
      app.vault.setConfig('mobileToolbarCommands', phone().filter((id) => id !== renamedId))
      await rewrite(${JSON.stringify(`${SCRIPTS}/headed.js`)}, ${JSON.stringify(HEADED)})
      await pin([])
      const takenOff = phone()
      return { first, headed, pinnedOn, renamed, renamedId, pinnedOff, takenOff, command }
    `)
    expect(r.error).toBeUndefined()
    expect(r.command).toBe(true)
    expect(r.first).toEqual([r.headed, HAND])
    const pinnedId = r.pinnedOn?.[0]
    expect(pinnedId).toMatch(/^abele:abele:script-/)
    expect(r.pinnedOn).toEqual([pinnedId, r.headed, HAND])
    expect(r.renamed).toEqual([pinnedId, r.renamedId, HAND])
    expect(r.pinnedOff).toEqual([r.renamedId, HAND])
    expect(r.takenOff).toEqual([HAND])
  })

  it('on a phone: no buttons on the note, and the toolbar above the keyboard runs the script', async () => {
    // Switched on again from the library: put back even after being taken off by hand.
    run(`
      const s = scripts.getAll().find((x) => x.meta.name === 'E2E toolbar headed')
      scripts.toolbar.forgetOffered(s.path)
      await pin([])
      // Obsidian writes its config a moment after it changes; the reload below would not wait.
      await app.vault.saveConfig()
      return { ok: true }
    `)
    evalRaw(
      `(() => { require('@electron/remote').getCurrentWindow().setContentSize(390, 844); return 'ok' })()`
    )
    await reloadApp('app.emulateMobile(true)')

    const r = run<{
      error?: string
      mobile?: boolean
      buttons?: string[]
      ribbon?: string[]
      icons?: string[]
      field?: string
      output?: string
    }>(`
      await until(() => scripts.getAll().length === 2, 15000)
      const leaf = await openNote()
      await wait(500)
      leaf.view.editor.focus()
      leaf.view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 4 })
      const bar = await until(() => {
        const el = app.mobileToolbar?.optionsListEl
        return el && el.isConnected && el.children.length ? el : null
      }, 8000)
      const icons = bar ? [...bar.children].map((o) => o.querySelector('svg')?.getAttribute('class') ?? '') : []
      await wait(300)
      const img = await require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/script-toolbar.png', img.toPNG())
      const rocket = bar && [...bar.children].find((o) => o.querySelector('svg.lucide-rocket'))
      const before = lastRun()?.id
      rocket?.click()
      const field = await answerForm()
      const done = await until(() => lastRun()?.id !== before && lastRun()?.status === 'done' && lastRun())
      return { mobile: app.isMobile, buttons: buttons(leaf), ribbon: ribbon(), icons, field, output: done?.result }
    `)
    expect(r.error).toBeUndefined()
    expect(r.mobile).toBe(true)
    expect(r.buttons).toEqual([])
    expect(r.ribbon).toEqual([])
    expect(r.icons?.some((c) => c.includes('lucide-rocket'))).toBe(true)
    expect(r.field).toBe('Some')
    expect(r.output).toBe(`${NOTE}|Some`)
  }, 180_000)
})
