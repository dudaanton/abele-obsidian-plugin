/** Live footer updates, using only synthetic notes and restoring the workspace afterwards. */
import { afterAll, describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('relation-updates')
let emulated = false

const probe = (label: string) => String.raw`(async () => {
  const api = window.__abeleTest
  const store = api.GlobalStore.getInstance()
  const config = api.AbeleConfig.getInstance()
  const folder = 'Sample relation updates'
  if (app.vault.getAbstractFileByPath(folder)) throw Error('scratch folder already exists')
  const previousLeaf = app.workspace.activeLeaf
  const previousView = previousLeaf?.getViewState()
  const previousJournals = config.journals
  const previousRemember = config.rememberNotePlaces
  const cachedRead = app.vault.cachedRead
  const chats = api.ChatService.getInstance()
  const previousTab = chats.activeTabId.value
  const sidebarLeaves = new Set(app.workspace.getLeavesOfType('abele-ai-sidebar-view'))
  const rightCollapsed = app.workspace.rightSplit.collapsed
  let leaf, tracked, releaseRead, session
  const report = {}
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (fn, label) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const result = fn()
      if (result) return result
      await wait(50)
    }
    throw Error('not ready: ' + label)
  }
  const frame = () => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('window is not drawing')), 5000)
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); resolve() }))
  })
  const shoot = async name => {
    await frame()
    const path = ${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png'
    if (window.__e2eHost) await window.__e2eHost.shot(path)
    else {
      const fs = require('fs')
      fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      const image = await require('@electron/remote').getCurrentWebContents().capturePage()
      fs.writeFileSync(path, image.toPNG())
    }
  }
  const create = async (name, body) => {
    const file = await app.vault.create(folder + '/' + name + '.md', body)
    await until(() => app.metadataCache.getFileCache(file), name + ' metadata')
    return file
  }
  const open = async file => {
    await leaf.openFile(file, { state: { mode: 'source', source: false } })
    app.workspace.setActiveLeaf(leaf, { focus: true })
    return until(() => store.footersContainers.value.find(f => f.filePath === file.path), 'footer')
  }
  const root = () => leaf.view.containerEl
  const anchor = (kind, path) => [...root().querySelectorAll('[data-abele-anchor]')]
    .find(el => el.getAttribute('data-abele-anchor') === kind + ':' + path)
  try {
    await frame()
    config.rememberNotePlaces = false
    await app.vault.createFolder(folder)
    await app.vault.createFolder(folder + '/East')
    await app.vault.createFolder(folder + '/West')
    const east = await create('East/Sample grove', 'Sample eastern grove.\n')
    const west = await create('West/Sample grove', 'Sample western grove.\n')
    // Choose the group the old root-relative resolution would NOT find.
    const global = app.metadataCache.getFirstLinkpathDest('Sample grove', '')
    const group = global?.path === east.path ? west : east
    const branch = await create(group.parent.name + '/Sample branch', '---\ngroups:\n  - "[[Sample grove]]"\n---\nSample branch.\n')
    const body = '---\ntype: note\ngroups:\n  - "[[' + branch.path + ']]"\n---\nSample seedling.\n'
    const member = await create('Sample seedling', body)
    await until(() => app.metadataCache.resolvedLinks[branch.path]?.[group.path] &&
      app.metadataCache.resolvedLinks[member.path]?.[branch.path], 'local group links')
    leaf = app.workspace.getLeaf('tab')
    const footer = await open(group)
    await until(() => footer.noteRelations.notes.has(member.path), 'nested member')
    report.nested = true
    await app.vault.modify(member, body.replace('type: note', 'type: task'))
    await until(() => footer.noteRelations.tasks.has(member.path) && !footer.noteRelations.notes.has(member.path), 'type reclassification')
    const task = await until(() => anchor('task', member.path), 'task card')
    task.scrollIntoView({ block: 'center' })
    await shoot('task')
    report.reclassified = !!task

    // Hold the search's old text across a real write, then type a query for the new text.
    const logBody = text => '---\ntype: log\ncreated: 2028-03-01\ngroups:\n  - "[[' + group.path + ']]"\n---\n' + text + '\n'
    const log = await create('Sample orchard log', logBody('Obsolete apples'))
    const logRow = await until(() => anchor('log', log.path), 'log row')
    logRow.scrollIntoView({ block: 'center' })
    await until(() => logRow.textContent.includes('Obsolete apples'), 'loaded log')
    let entered = false
    const held = new Promise(resolve => { releaseRead = resolve })
    app.vault.cachedRead = async function(file) {
      const text = await cachedRead.call(this, file)
      if (file.path === log.path && !entered) {
        entered = true
        await held
      }
      return text
    }
    const list = root().querySelector('.abele-logs-list')
    list.querySelector('.abele-logs-list__search-toggle').click()
    await until(() => entered, 'search read')
    await app.vault.modify(log, logBody('Fresh pears'))
    if (!(await cachedRead.call(app.vault, log)).includes('Fresh pears')) throw Error('write did not persist')
    releaseRead()
    await wait(100)
    const input = list.querySelector('input[type="search"]')
    input.value = 'fresh pears'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await until(() => list.querySelector('.abele-log')?.textContent.includes('Fresh pears'), 'fresh search result')
    // Wait beyond the debounce: the original unfiltered row must not count as success.
    await wait(500)
    report.search = list.querySelector('.abele-log')?.textContent.includes('Fresh pears') ?? false
    list.scrollIntoView({ block: 'center' })
    await shoot('search')
    app.vault.cachedRead = cachedRead

    config.journals = [...previousJournals, new api.Journal({ id: 'sample-daily', name: 'Sample daily',
      type: 'sample-daily', isDefault: true, recurrence: 'daily' })]
    const day = await create('2028-02-29', '---\ntype: sample-daily\n---\nSample daily note.\n')
    const old = await create('Sample leap entry', '---\ntype: note\ndate: 2028-02-29\n---\nLeap entry.\n')
    const next = await create('Sample march entry', '---\ntype: note\ndate: 2028-03-01\n---\nMarch entry.\n')
    const dailyFooter = await open(day)
    await until(() => dailyFooter.noteRelations.notes.has(old.path), 'old day')
    // The view may remount on rename. Also keep an independent watcher alive throughout it.
    tracked = new dailyFooter.noteRelations.constructor(day.path)
    await app.fileManager.renameFile(day, folder + '/2028-03-01.md')
    await until(() => tracked.notes.has(next.path) && !tracked.notes.has(old.path), 'renamed day relations')
    report.date = tracked.journalDate.format('YYYY-MM-DD')
    await until(() => root().querySelector('.abele-footer-view')?.textContent.includes('Sample march entry'), 'new day footer')
    const daily = root().querySelector('.abele-footer-view')
    report.oldDayGone = !daily.textContent.includes('Sample leap entry')
    daily.scrollIntoView({ block: 'center' })
    await shoot('daily')

    // Exercise the actual chat component's paging window, without sending to a model.
    if (!chats.canCreateTab) throw Error('no room for a scratch chat tab')
    chats.createTab()
    const chatFile = await app.vault.create(folder + '/Sample paging.abchat', JSON.stringify({
      v: 2, k: 'meta', type: 'abele-chat', title: 'Sample paging', providerId: '', modelId: '', created: '2028-03-01'
    }) + '\n')
    await chats.openChatFile(chatFile)
    session = chats.getSessionByFile(chatFile.path)
    const messages = n => Array.from({ length: n }, (_, i) => ({ id: 'sample-' + i, role: 'user',
      content: 'Sample message ' + i, timestamp: Date.now() }))
    session.messages.value = messages(80)
    await chats.revealSidebar({ focus: false })
    const rows = () => [...document.querySelectorAll('.abele-ai-chat [data-message-id]')]
    await until(() => rows().length === 30, 'initial tail page')
    // Switching tabs resets the page. Leaving it at its end avoids restoring an older place.
    if (!previousTab) throw Error('no original chat tab')
    chats.switchTab(previousTab)
    await frame()
    chats.switchTab(session.id)
    await until(() => rows().length === 30, 'reset tail page')
    const resetFirst = rows()[0].getAttribute('data-message-id')
    session.messages.value.push({ id: 'sample-reset-reply', role: 'user', content: 'Sample appended reply', timestamp: Date.now() })
    await until(() => rows().some(el => el.getAttribute('data-message-id') === 'sample-reset-reply'), 'appended reset reply')
    report.resetHeld = rows()[0].getAttribute('data-message-id') === resetFirst && rows().length === 31
    session.messages.value = messages(50)
    await until(() => rows().length === 30, 'shrunk tail page')
    const shrinkFirst = rows()[0].getAttribute('data-message-id')
    session.messages.value.push({ id: 'sample-shrink-reply', role: 'user', content: 'Sample next reply', timestamp: Date.now() })
    await until(() => rows().some(el => el.getAttribute('data-message-id') === 'sample-shrink-reply'), 'appended shrink reply')
    report.shrinkHeld = rows()[0].getAttribute('data-message-id') === shrinkFirst && rows().length === 31
    await shoot('chat')
    return report
  } finally {
    releaseRead?.()
    app.vault.cachedRead = cachedRead
    tracked?.cleanup()
    if (session) await chats.deleteChat(session.id)
    if (previousTab) chats.switchTab(previousTab)
    for (const sidebar of app.workspace.getLeavesOfType('abele-ai-sidebar-view')) {
      if (!sidebarLeaves.has(sidebar)) sidebar.detach()
    }
    if (rightCollapsed) app.workspace.rightSplit.collapse()
    if (leaf === previousLeaf && previousView) await leaf.setViewState(previousView)
    else leaf?.detach()
    if (previousLeaf) app.workspace.setActiveLeaf(previousLeaf, { focus: true })
    config.journals = previousJournals
    config.rememberNotePlaces = previousRemember
    const scratch = app.vault.getAbstractFileByPath(folder)
    if (scratch) await app.vault.delete(scratch, true)
  }
})()`

async function check(label: string) {
  const raw = await evalLong(probe(label))
  if (raw.startsWith('Error:')) throw new Error(raw)
  const report = JSON.parse(raw)
  expect(report).toEqual({
    nested: true,
    reclassified: true,
    search: true,
    date: '2028-03-01',
    oldDayGone: true,
    resetHeld: true,
    shrinkHeld: true,
  })
}

describe.skipIf(!available)('relation updates in an open footer', () => {
  afterAll(async () => {
    if (emulated) await reloadApp('app.emulateMobile(false)')
  })

  it('updates nested members, types, search text and renamed days without reopening', async () => {
    await check(onPhone() ? 'phone' : 'desktop')
  }, 180_000)

  it.skipIf(onPhone())(
    'updates the same footer under phone emulation',
    async () => {
      emulated = true
      await reloadApp('app.emulateMobile(true)')
      evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
      await reloadApp()
      await check('emulated')
    },
    180_000
  )
})
