/**
 * Scripts from elsewhere wait to be confirmed, in the running app.
 *
 * With a scripts folder of the run's own and `ai.confirmForeignScripts` switched on here:
 *
 * - a script that was there when it was switched on runs from its toolbar button;
 * - the same file changed on disk behind Obsidian's back — the way iCloud, Syncthing or git
 *   change it — shows as waiting, a notice says so, and its button does not run it: it opens the
 *   review dialog with the change in it, and "Not now" leaves it waiting;
 * - an automation's run of it is refused while it waits;
 * - confirmed from the button's dialog, it runs, and afterwards runs without asking;
 * - a script saved from the code editor on this device does not wait;
 * - on a phone (390×844, `emulateMobile`) the dialog is Obsidian's bottom sheet, inside the
 *   screen, with both buttons in sight — pictured to `/tmp/abele-phone/script-review.png`.
 *
 * The device's own record, the settings and the folder are put back afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { shotDir } from './helpers/shots'
import { SCRIPT_FIXTURE, type ScriptFixtureSnapshot } from './helpers/scriptFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele synced scripts e2e'
const SCRIPTS = `${DIR}/Scripts`
const PATH = `${SCRIPTS}/synced.js`
const SHOTS = shotDir('abele-phone')

const SCRIPT = (says: string) => `// @name E2E synced script
// @icon rocket
// @toolbar
return ${JSON.stringify(says)}`

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
  const ours = () => scripts.getAll().find((s) => s.path === ${JSON.stringify(PATH)})
  const RIBBON = 'abele:script:' + ${JSON.stringify(PATH)}
  const ribbonButton = () => app.workspace.leftRibbon.items.find((i) => i.id === RIBBON && i.buttonEl?.isConnected)?.buttonEl
  const lastRun = () => T.ScriptRuns.getInstance().runs.value[0]
  const dialog = () => document.querySelector('.modal.abele-script-review')
  const press = (text) => [...(dialog()?.querySelectorAll('.abele-modal__footer button') ?? [])].find((b) => b.textContent === text)?.click()
  // As a sync app writes it: straight to the disk, nothing in Obsidian told.
  const onDisk = async (text) => {
    require('fs').writeFileSync(app.vault.adapter.getFullPath(${JSON.stringify(PATH)}), text)
    return until(() => ours()?.source === text, 15000)
  }
`

const run = <T>(body: string, timeout = 90_000): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    timeout
  )

describe.skipIf(!available)('scripts from elsewhere wait to be confirmed', () => {
  let fixture: ScriptFixtureSnapshot | undefined
  let size: [number, number] = [0, 0]

  beforeAll(() => {
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    fixture = evalAsync<ScriptFixtureSnapshot>(
      `(async () => { ${SCRIPT_FIXTURE}; return await saveScriptFixture() })()`
    )
    expect(
      evalRaw(
        `(async () => {
        ${SCRIPT_FIXTURE}
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        for (const f of [${JSON.stringify(DIR)}, ${JSON.stringify(SCRIPTS)}]) await app.vault.createFolder(f)
        await app.vault.create(${JSON.stringify(PATH)}, ${JSON.stringify(SCRIPT('first'))})
        await enableScriptFixture(${JSON.stringify(SCRIPTS)})
        await approveScriptFixture(${JSON.stringify(PATH)}, ${JSON.stringify(SCRIPT('first'))})
        const T = window.__abeleTest
        const config = T.AbeleConfig.getInstance()
        config.ai = { ...config.ai, scriptsFolder: ${JSON.stringify(SCRIPTS)}, confirmForeignScripts: false }
        await config.saveSettings()
        const scripts = T.ScriptService.getInstance()
        scripts.setConfirmForeign(false)
        await scripts.discover()
        // Switched on here, the way the settings switch does it: what is there is accepted.
        scripts.setConfirmForeign(true)
        config.ai = { ...config.ai, confirmForeignScripts: true }
        await config.saveSettings()
        await new Promise((r) => setTimeout(r, 300))
        return 'ok'
      })()`,
        60_000
      )
    ).toBe('ok')
  }, 90_000)

  afterAll(async () => {
    if (evalJson<boolean>('app.isMobile')) {
      evalRaw(
        `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]}); return 'ok' })()`
      )
      await reloadApp('app.emulateMobile(false)')
    }
    expect(
      evalRaw(
        `(async () => {
        ${SCRIPT_FIXTURE}
        try {
        document.querySelectorAll('.modal.abele-script-review').forEach((m) => m.closest('.modal-container')?.remove())
        document.querySelectorAll('.notice').forEach((n) => n.remove())
        for (const leaf of app.workspace.getLeavesOfType('abele-code')) {
          if (leaf.view.file?.path.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        }
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
        } finally { await restoreScriptFixture(${JSON.stringify(fixture)}) }
      })()`,
        60_000
      )
    ).toBe('ok')
  }, 180_000)

  it('runs a script that was there when it was switched on', () => {
    const r = run<{ error?: string; verdict?: string; result?: string }>(`
      await until(() => ours() && ribbonButton(), 15000)
      const before = lastRun()?.id
      ribbonButton().click()
      const done = await until(() => lastRun()?.id !== before && lastRun()?.status === 'done' && lastRun())
      return { verdict: scripts.verdict(ours()), result: done?.result }
    `)
    expect(r.error).toBeUndefined()
    expect(r.verdict).toBe('confirmed')
    expect(r.result).toBe('first')
  })

  it('holds back the file changed on disk: its button opens the review instead of running it', () => {
    const r = run<{
      error?: string
      seen?: boolean
      verdict?: string
      notice?: boolean
      ran?: boolean
      shown?: string
      stillWaiting?: string
      automation?: string
    }>(`
      const seen = !!(await onDisk(${JSON.stringify(SCRIPT('second'))}))
      const verdict = scripts.verdict(ours())
      const notice = !!(await until(() => [...document.querySelectorAll('.notice')].some((n) => n.textContent.includes('E2E synced script'))))
      const before = lastRun()?.id
      ribbonButton().click()
      const box = await until(() => dialog())
      const shown = box?.querySelector('.abele-script-review__code')?.textContent ?? ''
      press('Not now')
      await until(() => !dialog())
      await wait(300)
      const ran = lastRun()?.id !== before
      let automation = ''
      try { await scripts.execute(${JSON.stringify(PATH)}, {}, { source: 'automation' }) }
      catch (e) { automation = e.name }
      return { seen, verdict, notice, ran, shown, stillWaiting: scripts.verdict(ours()), automation }
    `)
    expect(r.error).toBeUndefined()
    expect(r.seen).toBe(true)
    expect(r.verdict).toBe('waiting')
    expect(r.notice).toBe(true)
    expect(r.ran).toBe(false)
    // The diff shows the new line and the one it replaced.
    expect(r.shown).toContain('second')
    expect(r.shown).toContain('first')
    expect(r.stillWaiting).toBe('waiting')
    expect(r.automation).toBe('ScriptWaitingError')
  })

  it('runs it once confirmed from the dialog, and without asking after that', () => {
    const r = run<{ error?: string; result?: string; verdict?: string; again?: string }>(`
      const before = lastRun()?.id
      ribbonButton().click()
      await until(() => dialog())
      press('Confirm')
      const done = await until(() => lastRun()?.id !== before && lastRun()?.status === 'done' && lastRun())
      const again = await scripts.execute(${JSON.stringify(PATH)}, {}, { source: 'automation' })
      return { result: done?.result, verdict: scripts.verdict(ours()), again }
    `)
    expect(r.error).toBeUndefined()
    expect(r.result).toBe('second')
    expect(r.verdict).toBe('confirmed')
    expect(r.again).toBe('second')
  })

  it('does not hold back a script saved from the code editor here', () => {
    const r = run<{ error?: string; verdict?: string; source?: string }>(`
      const leaf = app.workspace.getLeaf('tab')
      await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)}))
      await until(() => leaf.view.getViewType() === 'abele-code' && leaf.view.editor)
      const editor = leaf.view.editor
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: ${JSON.stringify(SCRIPT('typed here'))} } })
      await leaf.view.save()
      await until(() => ours()?.source?.includes('typed here'), 15000)
      leaf.detach()
      return { verdict: scripts.verdict(ours()), source: ours()?.source }
    `)
    expect(r.error).toBeUndefined()
    expect(r.source).toContain('typed here')
    expect(r.verdict).toBe('confirmed')
  })

  it('on a phone: the dialog is the bottom sheet, inside the screen, both buttons in sight', async () => {
    evalRaw(
      `(() => { require('@electron/remote').getCurrentWindow().setContentSize(390, 844); return 'ok' })()`
    )
    await reloadApp('app.emulateMobile(true)')

    const r = run<{
      error?: string
      mobile?: boolean
      sheet?: boolean
      inside?: boolean
      buttons?: string[]
    }>(`
      await until(() => ours(), 15000)
      await onDisk(${JSON.stringify(SCRIPT('from the phone test'))})
      await until(() => scripts.verdict(ours()) === 'waiting')
      document.querySelectorAll('.notice').forEach((n) => n.remove())
      const answer = scripts.review(ours())
      const box = await until(() => dialog())
      await wait(500)
      const rect = box.getBoundingClientRect()
      const inView = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= window.innerWidth + 0.5 && b.top >= 0 && b.bottom <= window.innerHeight + 0.5 }
      const buttons = [...box.querySelectorAll('.abele-modal__footer button')].filter(inView).map((b) => b.textContent)
      const img = await require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/script-review.png', img.toPNG())
      press('Not now')
      await answer
      return {
        mobile: app.isMobile,
        sheet: box.classList.contains('mod-lg'),
        inside: rect.left >= 0 && rect.right <= window.innerWidth + 0.5 && rect.bottom <= window.innerHeight + 0.5,
        buttons,
      }
    `)
    expect(r.error).toBeUndefined()
    expect(r.mobile).toBe(true)
    expect(r.sheet).toBe(true)
    expect(r.inside).toBe(true)
    expect(r.buttons).toEqual(['Not now', 'Confirm'])
  }, 180_000)
})
