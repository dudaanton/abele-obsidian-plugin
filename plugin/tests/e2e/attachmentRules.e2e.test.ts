/**
 * Attachment folder rules in the running app: a picture pasted or dropped into a note under a
 * ruled folder lands in that rule's folder, one in a note outside every rule lands in the vault's
 * own attachment folder, and the settings group is drawn empty, with two rules and with a long
 * path — on the desktop and in the phone layout.
 *
 * The paste and the drop are synthetic events carrying a synthetic PNG, which Obsidian's editor
 * takes the same way as a real one: it reads the files off the event and saves each through the
 * vault, which is where the rules are applied.
 */
import { afterAll, describe, expect, it } from 'vitest'
import {
  activeVaultName,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  restoreDesktopWindow,
  vaultCli,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('attachment-rules')
const DIR = `Sample attachment rules ${process.pid}`
const RULED = `${DIR}/Ruled notes`
const RULE_FILES = `${DIR}/Ruled files`
const DEFAULT_FILES = `${DIR}/Default files`
const BESIDE = `${DIR}/Beside notes`

afterAll(async () => {
  if (available) await restoreDesktopWindow()
})

interface Landing {
  folder: string
  embedded: boolean
}

interface Result {
  error?: string
  mobile: boolean
  landed: Record<string, Landing[]>
  rows: Record<
    string,
    {
      fields: string[]
      places: string[]
      overflow: string[]
      binBeside: boolean[]
      endsShown: boolean[]
    }
  >
  ruleKept: unknown
  folderKept: unknown
}

const probe = (mobile: boolean) => `(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (test, ms = 10000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { const value = await test(); if (value) return value; await wait(100) }
    return null
  }
  const config = window.__abeleTest.AbeleConfig.getInstance()
  const savedRules = JSON.parse(JSON.stringify(config.attachmentRules))
  const savedFolder = app.vault.getConfig('attachmentFolderPath')
  const savedLayout = app.workspace.getLayout()
  const out = { mobile: !!app.isMobile, landed: {}, rows: {} }
  const filesIn = () => app.vault.getFiles().filter(f => f.path.startsWith(${JSON.stringify(DIR + '/')}) && f.extension === 'png')
  const png = async () => {
    const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 8
    const g = canvas.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 12, 8)
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
    return new File([blob], 'sample-image.png', { type: 'image/png' })
  }
  const send = async (notePath, how) => {
    const note = app.vault.getAbstractFileByPath(notePath)
    const leaf = app.workspace.getLeaf(false)
    await leaf.openFile(note, { active: true })
    const view = await until(() => leaf.view?.editor && leaf.view.file?.path === notePath && leaf.view)
    if (!view) throw new Error('The note never opened in an editor: ' + notePath)
    if (view.getMode() !== 'source') await view.setState({ ...view.getState(), mode: 'source' }, { history: false })
    view.editor.focus()
    view.editor.setCursor(view.editor.lastLine(), 0)
    const before = new Set(filesIn().map(f => f.path))
    const data = new DataTransfer()
    data.items.add(await png())
    const content = view.contentEl.querySelector('.cm-content')
    if (how === 'paste') content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    else {
      const box = content.getBoundingClientRect()
      const at = { clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10) }
      content.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true, ...at }))
      content.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, ...at }))
    }
    const made = await until(() => filesIn().find(f => !before.has(f.path)))
    if (!made) return { folder: '(nothing saved)', embedded: false }
    const embedded = !!(await until(() => view.editor.getValue().includes(made.name)))
    return { folder: made.parent.path, embedded }
  }
  const settingsWindow = () => app.setting.popout?.win.electronWindow || require('@electron/remote').getCurrentWindow()
  const shoot = async (state) => {
    config.attachmentRules = state === 'empty' ? [] : state === 'two'
      ? [{ notesFolder: ${JSON.stringify(RULED)}, location: 'folder', attachmentsFolder: ${JSON.stringify(RULE_FILES)}, subfolder: '' },
         { notesFolder: '/', location: 'subfolder', attachmentsFolder: '', subfolder: 'pictures' }]
      : [{ notesFolder: 'Sample archive/Twenty years of sample travel notes/Every country visited/Long sample folder name', location: 'folder',
           attachmentsFolder: 'Sample archive/Twenty years of sample travel notes/Pictures of every country/Long sample folder name', subfolder: '' }]
    config.version.value++
    app.setting.open()
    app.setting.openTabById('abele')
    const doc = app.setting.modalEl.ownerDocument
    // A phone reopens settings on the page last shown; the list of pages only comes the first time.
    const shown = await until(() => doc.querySelector('.abele-attachment-rules') || [...doc.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(t => t.textContent.trim() === 'Other'))
    if (shown && !shown.classList.contains('abele-attachment-rules')) shown.click()
    const count = state === 'empty' ? 0 : state === 'two' ? 2 : 1
    // The group drawn with the rules just set, not one still on its way out from the last opening.
    const group = await until(() => [...doc.querySelectorAll('.abele-attachment-rules')].find(g => g.isConnected && g.querySelectorAll('.abele-attachment-rules__notes').length === count))
    if (!group) throw new Error('The Attachment folders group never drew')
    await wait(400)
    group.scrollIntoView({ block: 'start' })
    await wait(300)
    const width = doc.defaultView.innerWidth
    const overflow = []
    for (const el of group.querySelectorAll('*')) {
      const box = el.getBoundingClientRect()
      // Obsidian measures a dropdown's options with a copy of it placed off screen on purpose.
      if (el.closest('.is-measuring')) continue
      if (box.width > 0 && (box.left < -1 || box.right > width + 1)) overflow.push(el.className || el.tagName)
    }
    const notes = [...group.querySelectorAll('.abele-attachment-rules__notes')]
    const fields = notes.map(row => row.querySelector('input').value)
    const places = [...group.querySelectorAll('.abele-attachment-rules__place')].map(row => row.querySelector('select').value)
    // The bin on the line of its field, at its end, on the desktop and with the phone's stacked rows.
    const binBeside = notes.map(row => {
      const field = row.querySelector('input').getBoundingClientRect(), bin = row.querySelector('.clickable-icon').getBoundingClientRect()
      return bin.left >= field.right - 1 && Math.abs((bin.top + bin.bottom) / 2 - (field.top + field.bottom) / 2) < 8
    })
    // A long path shows its end, with the whole of it in the tooltip.
    const endsShown = [...group.querySelectorAll('.abele-attachment-rules__path')].map(input =>
      input.title === input.value && (input.scrollWidth <= input.clientWidth || input.scrollLeft + input.clientWidth >= input.scrollWidth - 2))
    out.rows[state] = { fields, places, overflow, binBeside, endsShown }
    const win = settingsWindow()
    const image = await win.webContents.capturePage()
    require('fs').writeFileSync(${JSON.stringify(SHOTS + '/')} + (${mobile} ? 'phone' : 'desktop') + '-' + state + '.png',
      image.resize({ width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight }).toPNG())
    app.setting.close()
    await wait(200)
  }
  try {
    if (app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) throw new Error('The sample folder is already there')
    await app.vault.createFolder(${JSON.stringify(RULED + '/Deeper')})
    await app.vault.create(${JSON.stringify(RULED + '/Deeper/inside.md')}, '# Inside\\n\\n')
    await app.vault.create(${JSON.stringify(DIR + '/outside.md')}, '# Outside\\n\\n')
    app.vault.setConfig('attachmentFolderPath', ${JSON.stringify(DEFAULT_FILES)})
    await app.vault.createFolder(${JSON.stringify(BESIDE)})
    await app.vault.create(${JSON.stringify(BESIDE + '/beside.md')}, '# Beside\\n\\n')
    config.attachmentRules = [
      { notesFolder: ${JSON.stringify(RULED + '/')}, location: 'folder', attachmentsFolder: ${JSON.stringify(RULE_FILES)}, subfolder: '' },
      { notesFolder: ${JSON.stringify(BESIDE)}, location: 'subfolder', attachmentsFolder: '', subfolder: 'pictures' },
    ]
    for (const how of ['paste', 'drop']) {
      out.landed[how] = [
        await send(${JSON.stringify(RULED + '/Deeper/inside.md')}, how),
        await send(${JSON.stringify(DIR + '/outside.md')}, how),
        await send(${JSON.stringify(BESIDE + '/beside.md')}, how),
      ]
    }
    for (const state of ['empty', 'two', 'long']) await shoot(state)
  } catch (e) {
    out.error = String(e?.stack || e)
  } finally {
    try { app.setting.close() } catch {}
    config.attachmentRules = savedRules
    config.version.value++
    app.vault.setConfig('attachmentFolderPath', savedFolder)
    out.ruleKept = config.attachmentRules
    out.folderKept = app.vault.getConfig('attachmentFolderPath') === savedFolder
    const leaves = []
    app.workspace.iterateAllLeaves(l => { if (l.view?.file?.path.startsWith(${JSON.stringify(DIR + '/')})) leaves.push(l) })
    for (const leaf of leaves) leaf.detach()
    const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
    if (dir) await app.vault.delete(dir, true)
    await app.workspace.changeLayout(savedLayout)
  }
  return out
})()`

describe.skipIf(!available)('attachment folder rules in the running app', () => {
  it.each([false, true])(
    'pasted and dropped pictures follow the rules, and the settings group fits, mobile=%s',
    async (mobile) => {
      await reloadApp(`app.emulateMobile(${mobile})`)
      const cli = vaultCli(activeVaultName())
      const size = mobile ? [390, 844] : [1280, 900]
      cli.evalRaw(
        `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]}); return 'ok' })()`
      )
      const result = cli.evalAwait<Result>(probe(mobile), 180_000)
      expect(result.error).toBeUndefined()
      expect(result.mobile).toBe(mobile)
      for (const how of ['paste', 'drop']) {
        expect(result.landed[how], how).toEqual([
          { folder: RULE_FILES, embedded: true },
          { folder: DEFAULT_FILES, embedded: true },
          { folder: `${BESIDE}/pictures`, embedded: true },
        ])
      }
      expect(result.rows.empty.fields).toEqual([])
      expect(result.rows.two.fields).toEqual([RULED, 'Whole vault'])
      expect(result.rows.two.places).toEqual(['folder', 'subfolder'])
      expect(result.rows.long.fields).toHaveLength(1)
      for (const state of ['empty', 'two', 'long']) {
        expect(result.rows[state].overflow, state).toEqual([])
        expect(result.rows[state].binBeside.every(Boolean), state).toBe(true)
        expect(result.rows[state].endsShown.every(Boolean), state).toBe(true)
      }
      expect(result.folderKept).toBe(true)
    },
    300_000
  )
})
