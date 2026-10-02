/** Live metadata events and the timer/log UI, with isolated synthetic notes. */
import { afterAll, describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('log-timer-journal')
let emulated = false

const probe = (label: string) => String.raw`(async () => {
  const api = window.__abeleTest
  const config = api.AbeleConfig.getInstance()
  const store = api.GlobalStore.getInstance()
  const folder = 'Sample log timer probe'
  if (app.vault.getAbstractFileByPath(folder)) throw Error('probe folder already exists')
  const previousTypes = config.timeTrackableNoteTypes
  const previousMonday = config.weekStartsOnMonday
  const previousLeaf = app.workspace.activeLeaf
  const previousViewState = previousLeaf?.getViewState()
  const previousRemember = config.rememberNotePlaces
  const entries = [], logs = []
  let leaf
  const report = {}
  const until = async (fn, label) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const value = fn()
      if (value) return value
      await new Promise(r => setTimeout(r, 100))
    }
    throw Error('not ready: ' + label)
  }
  const create = async (name, body) => {
    const file = await app.vault.create(folder + '/' + name + '.md', body)
    await until(() => app.metadataCache.getFileCache(file), name + ' metadata')
    return file
  }
  const shoot = async name => {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('window is not drawing')), 5000)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(timeout)
        resolve()
      }))
    })
    const path = ${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png'
    if (window.__e2eHost) await window.__e2eHost.shot(path)
    else {
      const fs = require('fs')
      fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      const image = await require('@electron/remote').getCurrentWebContents().capturePage()
      fs.writeFileSync(path, image.toPNG())
    }
  }
  try {
    config.timeTrackableNoteTypes = [...previousTypes, 'sample-timer-group']
    config.weekStartsOnMonday = true
    config.rememberNotePlaces = false
    store.applySettings()
    await app.vault.createFolder(folder)
    const group = await create('Sample grove', '---\ntype: sample-timer-group\n---\nSample group.\n')
    const other = await create('Sample grove annex', 'Sample unrelated note.\n')
    const malformed = await create('Sample seed', '---\ngroups:\n  invalid: true\n---\nSample seed.\n')
    const logFile = await create('Sample log', '---\ntype: log\ncreated: 2024-01-01\n---\nKeep [[' + group.path + ']].\n\nDrop [[' + other.path + ']].\n\nOther [[' + malformed.path + ']].\n')
    await until(() => app.metadataCache.resolvedLinks[logFile.path]?.[group.path], 'resolved links')
    const log = new api.Log(logFile.path, group.path)
    logs.push(log)
    await log.loadContent()
    report.relatedText = log.content
    const malformedLogFile = await create('Sample malformed log', 'About [[' + malformed.path + ']].\n')
    await until(() => app.metadataCache.resolvedLinks[malformedLogFile.path]?.[malformed.path], 'malformed groups links')
    const malformedLog = new api.Log(malformedLogFile.path, group.path)
    logs.push(malformedLog)
    await malformedLog.loadContent()
    report.malformedText = malformedLog.content

    const timerBody = '---\ntype: time-entry\nstart: 2024-01-01T12:00:00\ngroups:\n  - "[[' + group.path + ']]"\n---\n'
    const timerFile = await create('Sample timer', timerBody)
    await until(() => store.timeEntryList.value.entries.has(timerFile.path), 'timer list insertion')
    leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(group, { state: { mode: 'source', source: false } })
    app.workspace.setActiveLeaf(leaf, { focus: true })
    const root = () => leaf.view.containerEl
    const stop = await until(() => {
      const icon = root().querySelector('.abele-header-view .lucide-timer-off')
      return icon?.getBoundingClientRect().height > 0 && icon
    }, 'Stop timer button')
    report.stopButton = !!stop
    stop.scrollIntoView({ block: 'center' })
    await shoot('running')
    const content = await until(() => root().querySelector('.abele-log__file-content'), 'rendered log')
    content.scrollIntoView({ block: 'center' })
    await until(() => content.textContent.includes('Keep'), 'log content')
    report.renderedLog = content.textContent
    await shoot('log')

    const original = store.timeEntryList.value.entries.get(timerFile.path)
    await app.vault.modify(timerFile, timerBody.replace('type: time-entry', 'type: note'))
    await until(() => !store.timeEntryList.value.entries.has(timerFile.path), 'timer type removal')
    report.cleaned = !original.loaded
    const start = await until(() => root().querySelector('.abele-header-view .lucide-timer'), 'Start timer button')
    report.startButton = !root().querySelector('.abele-header-view .lucide-timer-off')
    start.scrollIntoView({ block: 'center' })
    await shoot('stopped')
    await app.vault.modify(timerFile, timerBody)
    await until(() => store.timeEntryList.value.entries.has(timerFile.path), 'timer type restored')
    const standalone = new api.TimeEntry({ wikilink: '[[' + timerFile.path + ']]' })
    entries.push(standalone)
    await standalone.load()
    await app.vault.delete(timerFile)
    await until(() => standalone.entryNotFound, 'external deletion watcher')
    await until(() => !store.timeEntryList.value.entries.has(timerFile.path), 'deleted timer list removal')
    report.deleted = standalone.entryNotFound

    const journalFile = await create('2024-01-01', '---\ntype: sample-weekly\n---\nSample weekly journal.\n')
    const journal = new api.Journal({ id: 'sample-weekly', name: 'Sample weekly', type: 'sample-weekly', isDefault: false, recurrence: 'weekly', dayOfPeriod: 1 })
    const from = journal.checkIfNotePathIsJournal(journalFile.path)
    report.nextDate = journal.getNextDate(from).format('YYYY-MM-DD')
    report.weeklyMatches = journal.isJournalDate(journal.getNextDate(from))
    return report
  } finally {
    entries.forEach(entry => entry.cleanup())
    logs.forEach(log => log.cleanup())
    if (leaf === previousLeaf && previousViewState) await leaf.setViewState(previousViewState)
    else leaf?.detach()
    if (previousLeaf) app.workspace.setActiveLeaf(previousLeaf, { focus: true })
    const scratch = app.vault.getAbstractFileByPath(folder)
    if (scratch) await app.vault.delete(scratch, true)
    config.timeTrackableNoteTypes = previousTypes
    config.weekStartsOnMonday = previousMonday
    config.rememberNotePlaces = previousRemember
    store.applySettings()
  }
})()`

async function check(label: string) {
  const raw = await evalLong(probe(label))
  // Keep the named readiness condition instead of burying it in a JSON parse error.
  if (raw.startsWith('Error:')) throw new Error(`${label} timer/log probe: ${raw}`)
  const result = JSON.parse(raw)
  expect(result.relatedText).toBe('Keep [[Sample log timer probe/Sample grove.md]].')
  expect(result.malformedText).toBe('About [[Sample log timer probe/Sample seed.md]].')
  expect(result.stopButton).toBe(true)
  expect(result.startButton).toBe(true)
  expect(result.cleaned).toBe(true)
  expect(result.deleted).toBe(true)
  expect(result.renderedLog).toContain('Keep')
  expect(result.renderedLog).not.toContain('Drop')
  expect(result.nextDate).toBe('2024-01-08')
  expect(result.weeklyMatches).toBe(true)
}

describe.skipIf(!available)('logs, timers and weekly journals in the live vault', () => {
  afterAll(async () => {
    if (emulated) await reloadApp('app.emulateMobile(false)')
  })

  it('updates timer controls and log paragraphs after real vault events', async () => {
    await check(onPhone() ? 'phone' : 'desktop')
  }, 180_000)

  it.skipIf(onPhone())(
    'keeps the same state and related text under phone emulation',
    async () => {
      emulated = true
      await reloadApp('app.emulateMobile(true)')
      evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
      await check('emulated')
    },
    180_000
  )
})
