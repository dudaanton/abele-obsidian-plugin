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
  const pagingDiagnostics = []
  let pagingState = () => null
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (fn, label) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const result = fn()
      if (result) return result
      await wait(50)
    }
    const detail = label.includes('tail page') || label.includes('reading place')
      ? '; paging=' + JSON.stringify(pagingState()) + '; prior=' + JSON.stringify(pagingDiagnostics)
      : ''
    throw Error('not ready: ' + label + detail)
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
    // A retained second pane must not be mistaken for extra rows in the paging owner.
    // Exercise that layout explicitly rather than relying on the pool's previous workspace.
    const secondChatPane = app.workspace.getLeaf('tab')
    await secondChatPane.setViewState({ type: 'abele-ai-sidebar-view', active: false })
    await chats.revealSidebar({ focus: false })
    const pagingOwner = app.workspace.getLeavesOfType('abele-ai-sidebar-view')[0]
    if (!pagingOwner) throw Error('paging owner was not revealed')
    const rows = () => [...pagingOwner.view.containerEl.querySelectorAll('.abele-ai-chat [data-message-id]')]
    const pager = () => pagingOwner.view.containerEl.querySelector('.abele-ai-chat__messages')
    pagingState = () => {
      const el = pager(), rect = el?.getBoundingClientRect()
      const visible = rect && rows().find(row => row.getBoundingClientRect().bottom > rect.top)
      return {owner:pagingOwner.id,activeTab:chats.activeTabId.value,session:session.id,
        width:el?.clientWidth,height:el?.clientHeight,scrollHeight:el?.scrollHeight,scrollTop:el?.scrollTop,
        gap:el ? el.scrollHeight-el.scrollTop-el.clientHeight : null,
        ids:rows().map(row=>row.getAttribute('data-message-id')),
        firstVisible:visible?.getAttribute('data-message-id'),offset:visible&&rect ? visible.getBoundingClientRect().top-rect.top : null}
    }
    await until(() => rows().length === 30, 'initial tail page')
    // Switching tabs resets the page. Leaving it at its end avoids restoring an older place.
    if (!previousTab) throw Error('no original chat tab')
    // Row mounting precedes the native scroll-to-end/layout work. Observe its real tail
    // rather than resetting or forcing scroll state that the tab switch is meant to test.
    const tail = () => { const state = pagingState(); return state.activeTab === session.id &&
      state.width > 0 && state.height > 0 && state.gap <= 1 && state.ids.at(-1) === 'sample-79' }
    await until(tail, 'actual initial tail page')
    await frame()
    await until(tail, 'painted initial tail page')
    pagingDiagnostics.push({phase:'before reset switch',...pagingState()})
    chats.switchTab(previousTab)
    await frame()
    chats.switchTab(session.id)
    await until(() => rows().length === 30, 'reset tail page')
    pagingDiagnostics.push({phase:'after reset switch',...pagingState()})
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

    // Independent non-tail reader: ordinary native scrolling establishes a reading place;
    // switching away/back must restore it, not satisfy the tail reset case by erasing it.
    await until(() => pagingState().gap <= 1, 'appended tail page')
    await frame()
    const box = pager().getBoundingClientRect(), x = Math.round(box.left+box.width/2)
    // The keyboard may leave a short messages viewport. Keep the whole single native
    // gesture in its scroll owner; a fixed160px move from the midpoint can land on input.
    const y = Math.round(box.top+box.height/4), endY = Math.round(Math.min(box.bottom-8,y+Math.min(160,box.height/2)))
    for (const at of [y,endY]) {
      const hit=document.elementFromPoint(x,at)
      if(!hit||!pager().contains(hit)) throw Error('non-tail gesture point is outside owner: '+JSON.stringify({x,at,box:box.toJSON(),hit:hit?.className}))
    }
    pagingDiagnostics.push({phase:'non-tail native gesture',start:[x,y],end:[x,endY],owner:pagingOwner.id})
    if (window.__e2eHost) await window.__e2eHost.swipe(x,y,x,endY,{velocity:160})
    else {
      const cdp=require('@electron/remote').getCurrentWebContents().debugger
      if(app.isMobile) {
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:endY}]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      } else await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:-180})
    }
    await until(() => pagingState().gap > 60, 'non-tail reading place')
    // Returning can legitimately reveal older history; require the complete prior window
    // as an unchanged suffix, plus the same visible message/offset, not fewer rendered rows.
    let reading
    await until(() => {
      const current=pagingState()
      const stable=reading && current.scrollTop===reading.scrollTop && current.firstVisible===reading.firstVisible && current.offset===reading.offset
      reading=current
      return stable
    }, 'settled non-tail reading place')
    await frame()
    reading=pagingState()
    pagingDiagnostics.push({phase:'before non-tail switch',...reading})
    chats.switchTab(previousTab)
    await frame()
    chats.switchTab(session.id)
    await until(() => {
      const current=pagingState()
      return current.activeTab===session.id && current.firstVisible===reading.firstVisible &&
        Math.abs(current.offset-reading.offset)<=1 &&
        current.ids.slice(-reading.ids.length).join()===reading.ids.join() && current.gap>60
    },'restored non-tail reading place')
    await frame()
    const returned=pagingState()
    pagingDiagnostics.push({phase:'after non-tail switch',...returned})
    report.nonTailRestored=returned.firstVisible===reading.firstVisible &&
      Math.abs(returned.offset-reading.offset)<=1 &&
      returned.ids.slice(-reading.ids.length).join()===reading.ids.join() && returned.gap>60
    await shoot('chat-reading-place')
    report.pagingDiagnostics = pagingDiagnostics
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
  console.info(JSON.stringify(report.pagingDiagnostics))
  const { pagingDiagnostics, ...outcomes } = report
  const beforeReset = pagingDiagnostics.find(
    (entry: { phase: string }) => entry.phase === 'before reset switch'
  )
  expect(beforeReset.activeTab).toBe(beforeReset.session)
  expect(beforeReset.gap).toBeLessThanOrEqual(1)
  expect(beforeReset.ids).toHaveLength(30)
  expect(beforeReset.ids.at(-1)).toBe('sample-79')
  expect(outcomes).toEqual({
    nested: true,
    reclassified: true,
    search: true,
    date: '2028-03-01',
    oldDayGone: true,
    resetHeld: true,
    shrinkHeld: true,
    nonTailRestored: true,
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
