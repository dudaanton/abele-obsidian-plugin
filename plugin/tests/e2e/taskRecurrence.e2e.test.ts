/** Recurrence through the actual header button and embedded card, including phone touches. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const SHOTS = shotDir('task-recurrence')
const available = isObsidianRunning() && hasTestApi()

interface Result {
  surface: string
  rule: string
  expected: string
  due: string
  completed: boolean
  resetSubtask: boolean
  retainedLabel: boolean
  undone: boolean
  copies: number
}

const probe = `(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (fn, label) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const value = await fn()
      if (value) return value
      await wait(100)
    }
    throw new Error('Timed out: ' + label)
  }
  const folder = 'Sample recurrence probe'
  if (app.vault.getAbstractFileByPath(folder)) throw new Error('Probe folder already exists')
  const config = window.__abeleTest.AbeleConfig.getInstance()
  const oldFolder = config.tasksFolder
  const activeLeaf = app.workspace.activeLeaf
  const left = app.workspace.leftSplit.collapsed
  const right = app.workspace.rightSplit.collapsed
  const leaf = app.workspace.getLeaf('tab')
  const host = window.__e2eHost
  const win = host ? null : require('@electron/remote').getCurrentWindow()
  const report = []
  const read = file => app.vault.read(file)
  const prop = (text, key) => {
    const line = text.split('\\n').find(line => line.startsWith(key + ':'))
    return line ? line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '') : null
  }
  const open = async file => {
    await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source', source: false }, active: true })
    leaf.view.editor?.setCursor({ line: 0, ch: 0 })
    document.activeElement?.blur()
  }
  const press = async el => {
    el.scrollIntoView({ block: 'center' })
    await wait(300)
    const r = el.getBoundingClientRect()
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
    if (r.width <= 0 || r.height <= 0 || y < 0 || y >= innerHeight) throw new Error('Control is not visible')
    if (host) return host.tap(x, y)
    const cdp = win.webContents.debugger
    await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  }
  const shoot = async label => {
    const path = ${JSON.stringify(SHOTS)} + '/' + (app.isMobile ? 'mobile-' : 'desktop-') + label + '.png'
    if (host) return host.shot(path)
    require('fs').writeFileSync(path, (await win.webContents.capturePage()).toPNG())
  }
  try {
    app.workspace.leftSplit.collapse()
    app.workspace.rightSplit.collapse()
    await app.vault.createFolder(folder)
    await app.vault.createFolder(folder + '/Next')
    config.tasksFolder = folder + '/Next'
    for (const surface of ['header', 'card']) {
      for (const rule of ['weekly', 'monthly', 'completion']) {
        const title = 'Sample ' + surface + ' ' + rule
        const recurrence = { weekly: 'every 2 weeks on Monday', monthly: 'every 2 months on 15', completion: 'every 3 days from completion' }[rule]
        const due = rule === 'monthly' ? '2028-01-15' : '2028-01-03'
        const file = await app.vault.create(folder + '/' + title + ' ' + due + '.md',
          '---\\ntype: task\\ncreated: "2028-01-01"\\ndue: "' + due + '"\\nrecurrence: ' + recurrence + '\\nlabels: [sample]\\n---\\n' + title + '\\n\\n- [x] Sample subtask\\n')
        await until(() => app.metadataCache.getFileCache(file)?.frontmatter?.recurrence, 'task indexed')
        let display = file
        if (surface === 'card') {
          display = await app.vault.create(folder + '/Card ' + rule + '.md',
            'Sample card host\\n\\n- [ ] [[' + file.path.slice(0, -3) + ']]\\n\\nEnd of sample.\\n')
        }
        await open(display)
        const control = () => leaf.view.containerEl.querySelector(surface === 'header'
          ? '.abele-task-header-view > .abele-obsidian-icon'
          : '.abele-task-view input.task-list-item-checkbox')
        await until(control, 'completion control')
        if (surface === 'card') {
          await until(() => leaf.view.containerEl.querySelector('.abele-task-view__content')?.textContent.includes(title), 'card title')
        }
        await shoot(surface + '-' + rule + '-before')
        const now = new Date()
        now.setDate(now.getDate() + 3)
        const completionDue = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
        const expected = { weekly: '2028-01-17', monthly: '2028-03-15', completion: completionDue }[rule]
        await press(control())
        const nextFiles = () => app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + '/Next/' + title))
        const next = await until(() => nextFiles()[0], 'next occurrence')
        await until(async () => prop(await read(file), 'completed'), 'original saved as completed')
        const nextText = await read(next)
        const result = {
          surface, rule, expected, due: prop(nextText, 'due'),
          completed: !!prop(await read(file), 'completed'),
          resetSubtask: nextText.includes('- [ ] Sample subtask'),
          retainedLabel: nextText.includes('labels:\\n  - sample'),
          undone: false, copies: 0,
        }
        // Undo the original, not the new occurrence: no second next task may be created.
        await until(control, 'undo control')
        await wait(500)
        await press(control())
        await until(async () => !prop(await read(file), 'completed'), 'completion undone')
        result.undone = true
        result.copies = nextFiles().length
        await open(next)
        await until(() => leaf.view.containerEl.querySelector('.abele-task-header-view'), 'next task header')
        await wait(300)
        await shoot(surface + '-' + rule + '-next')
        report.push(result)
      }
    }
    return JSON.stringify(report)
  } finally {
    config.tasksFolder = oldFolder
    leaf.detach()
    if (activeLeaf) app.workspace.setActiveLeaf(activeLeaf, { focus: false })
    if (!left) app.workspace.leftSplit.expand()
    if (!right) app.workspace.rightSplit.expand()
    const created = app.vault.getAbstractFileByPath(folder)
    if (created) await app.vault.delete(created, true)
  }
})()`

function suite(name: string, prepare: () => Promise<void>, restore: () => Promise<void>) {
  describe.skipIf(!available)(name, () => {
    let results: Result[] = []
    beforeAll(async () => {
      await prepare()
      const raw = await evalLong(probe, 180_000)
      if (!raw.startsWith('[')) throw new Error(raw)
      results = JSON.parse(raw) as Result[]
      console.info(JSON.stringify(results))
    }, 240_000)
    afterAll(restore, 180_000)
    it.each(['header', 'card'])(
      '%s creates the right occurrence and undo creates no extra copy',
      (surface) => {
        const rows = results.filter((row) => row.surface === surface)
        expect(rows).toHaveLength(3)
        for (const row of rows) {
          expect(row.due, row.rule).toBe(row.expected)
          expect(row.completed).toBe(true)
          expect(row.resetSubtask).toBe(true)
          expect(row.retainedLabel).toBe(true)
          expect(row.undone).toBe(true)
          expect(row.copies).toBe(1)
        }
      }
    )
  })
}

const noop = async () => {}
if (onPhone()) {
  suite('task recurrence on a real phone', noop, noop)
} else {
  suite('task recurrence on desktop', noop, noop)
  let size: [number, number] | undefined
  suite(
    'task recurrence in phone emulation',
    async () => {
      size = JSON.parse(
        evalRaw("JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())")
      )
      await reloadApp('app.emulateMobile(true)')
      evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
      await reloadApp('window.location.reload()')
    },
    async () => {
      if (size)
        evalRaw(
          "require('@electron/remote').getCurrentWindow().setContentSize(" + size.join(',') + ')'
        )
      await reloadApp('app.emulateMobile(false)')
    }
  )
}
