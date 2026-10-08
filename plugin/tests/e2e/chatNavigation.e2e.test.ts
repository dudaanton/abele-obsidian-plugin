import { describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { tap, typeText } from './helpers/phone'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('abele-phone')

interface NavigationReport {
  unfocusedSearch: boolean
  questions: number
  hiddenBranch: boolean
  firstMounted: boolean
  jumpMs: number
  settledMs: number
  drift: number
  latest: boolean
  returned: boolean
  middleReturnDrift: number
  nestedBack: boolean
  discussion: boolean
  nested: boolean
  discussionReturn: boolean
  draft: string
  searchPart: boolean
  selectedBranch: string
  beforeBranch: string
  branchJump: boolean
  branchReturn: boolean
  branchPositionDrift: number
  branchDeferred: boolean
  allBranchSearch: boolean
  sharedOnce: boolean
  discussionSearch: boolean
  unavailable: boolean
}

const script = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async fn => { for (let i = 0; i < 300; i++) { if (fn()) return; await wait(30) } throw Error('Navigation destination did not appear: ' + fn.toString()) }
  const chats = window.__abeleTest.ChatService.getInstance()
  const comments = window.__abeleTest.CommentService.getInstance()
  const path = 'sample-navigation.abchat'
  if (app.vault.getAbstractFileByPath(path)) throw Error('Synthetic chat already exists')
  const dirs = [], files = [], report = {}
  const box = () => [...document.querySelectorAll('.abele-ai-chat__messages')].find(el => el.getClientRects().length)
  const modal = () => document.querySelector('.abele-chat-navigation')
  const item = id => box()?.querySelector('[data-message-id="' + id + '"]')
  const offset = id => item(id).getBoundingClientRect().top - box().getBoundingClientRect().top
  const open = async () => {
    document.querySelector('.abele-ai-chat__navigation').click()
    await until(modal)
    await wait(100)
  }
  const choose = async text => {
    const button = [...modal().querySelectorAll('button')].find(b => b.textContent.includes(text))
    if (!button || button.disabled) throw Error('No available navigation action: ' + text)
    button.click(); await wait(100)
  }
  const records = []
  for (let i = 0; i < 300; i++) {
    records.push({ k: 'msg', id: 'q' + i, parentId: i ? 'a' + (i - 1) : undefined, role: 'user', content: 'Sample question ' + i, timestamp: 1700000000000 + i * 3600000 })
    records.push({ k: 'msg', id: 'a' + i, parentId: 'q' + i, role: 'assistant', content: 'A sample answer about a garden.\\n\\n' + 'The beds beside the path need enough room for the herbs and the watering can. '.repeat(8), timestamp: 1700000001000 + i * 3600000 })
  }
  records.push({ k: 'msg', id: 'other', parentId: 'q0', role: 'assistant', content: 'Hidden alternate answer', timestamp: 1700000002000 })
  records.push({ k: 'msg', id: 'other-first', parentId: 'other', role: 'user', content: 'First alternate follow-up', timestamp: 1700000003000 })
  records.push({ k: 'msg', id: 'other-second', parentId: 'other', role: 'user', content: 'Second alternate follow-up', timestamp: 1700000004000 })
  records.push({ k: 'msg', id: 'other-start', role: 'user', content: 'Another sample conversation start', timestamp: 1700000005000 })
  // The current leaf is explicit; opening navigation must never change it.
  const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Sample navigation', created: '2023-11-14', activeLeafId: 'a299', comments: [{ id: 'navd01', message: 'a0', quote: 'sample answer' }] }
  let owner
  try {
    files.push(await app.vault.create(path, [meta, ...records].map(JSON.stringify).join('\\n') + '\\n'))
    const commentPath = comments.commentPath('navd01')
    const segments = commentPath.split('/').slice(0, -1)
    for (let i = 1; i <= segments.length; i++) {
      const dir = segments.slice(0, i).join('/')
      if (!app.vault.getAbstractFileByPath(dir)) { await app.vault.createFolder(dir); dirs.unshift(dir) }
    }
    files.push(await app.vault.create(commentPath, [
      { v: 2, k: 'meta', type: 'abele-chat', kind: 'comment', created: '2023-11-14', anchor: { note: path, message: 'a0', quote: 'sample answer' }, comments: [{ id: 'navd02', message: 'du', quote: 'shade' }, { id: 'navm00', message: 'du', quote: 'Missing sample passage ' + 'x'.repeat(100) }] },
      { k: 'msg', id: 'du', role: 'user', content: 'Which plants need shade?', timestamp: 1700000005000 },
    ].map(JSON.stringify).join('\\n') + '\\n'))
    files.push(await app.vault.create(comments.commentPath('navd02'), [
      { v: 2, k: 'meta', type: 'abele-chat', kind: 'comment', created: '2023-11-14', anchor: { note: commentPath, message: 'du', quote: 'shade' } },
      { k: 'msg', id: 'nu', role: 'user', content: 'How much shade?', timestamp: 1700000006000 },
    ].map(JSON.stringify).join('\\n') + '\\n'))
    await chats.openChatFile(files[0]); await chats.revealSidebar({ focus: false })
    owner = chats.getSessionByFile(path)
    await until(() => item('a299'))
    document.activeElement?.blur()
    await wait(300)
    owner.draft.value.text = 'An unsent sample follow-up'
    report.beforeBranch = owner.branchLeafId
    await open()
    report.unfocusedSearch = document.activeElement !== modal().querySelector('input')
    report.questions = modal().querySelectorAll('[data-question]').length
    report.hiddenBranch = !modal().textContent.includes('Hidden alternate answer')
    const started = performance.now()
    await choose('To start')
    await until(() => item('q0'))
    report.jumpMs = performance.now() - started
    await wait(1800)
    report.settledMs = performance.now() - started
    report.firstMounted = !!item('q0')
    // A reply arriving while the reader is at the beginning must not pull them to the end.
    const before = offset('q0')
    owner.isStreaming.value = true
    owner.streamingContent.value = 'A new sample answer. '.repeat(50)
    await wait(400)
    report.drift = Math.abs(offset('q0') - before)
    owner.streamingContent.value = ''; owner.isStreaming.value = false
    await open(); await choose('To latest'); await wait(200)
    report.latest = box().scrollHeight - box().scrollTop - box().clientHeight < 60
    await open(); await choose('Back to place'); await wait(200)
    report.returned = box().scrollHeight - box().scrollTop - box().clientHeight < 60
    box().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    box().scrollTop += offset('q80') - 16
    await wait(100)
    const middleAt = offset('q80')
    await open(); await choose('To start'); await wait(200)
    await open(); await choose('Back to place'); await wait(200)
    report.middleReturnDrift = Math.abs(offset('q80') - middleAt)
    // Put the reader at the first question again, then open its direct and nested discussions.
    await open(); await choose('To start'); await wait(200)
    await open(); await until(() => modal().textContent.includes('Which plants need shade?'))
    if (window.__e2eHost) await window.__e2eHost.shot(${JSON.stringify(SHOTS + '/navigation-discussions.png')})
    const fold = [...modal().querySelectorAll('summary')].find(s => s.textContent.includes('Nested discussions'))
    fold.click(); await until(() => modal().textContent.includes('How much shade?'))
    await choose('How much shade?')
    await until(() => chats.activeSession.value?.commentId === 'navd02')
    report.nested = true
    await open(); await choose('Back to place'); await wait(200)
    report.discussionReturn = chats.activeSession.value === owner
    await open(); await choose('Which plants need shade?')
    await until(() => chats.activeSession.value?.commentId === 'navd01')
    report.discussion = true
    await open(); await until(() => modal().textContent.includes('How much shade?'))
    await choose('How much shade?')
    await until(() => chats.activeSession.value?.commentId === 'navd02')
    await open(); await choose('Back to place'); await wait(200)
    report.nestedBack = chats.activeSession.value?.commentId === 'navd01'
    await open(); await choose('Back to place'); await wait(200)
    // Search includes a folded tool result, and selecting its snippet opens that exact part.
    const tool = { id: 'tool-sample', parentId: 'a299', role: 'tool-call', content: '', toolName: 'read', thinking: 'A sample liner', toolResult: 'A sample liner', toolStatus: 'approved', timestamp: 1700000007000 }
    owner.appendChatMessage(tool); owner.updateVisibleMessages()
    await wait(100)
    await open()
    const search = modal().querySelector('input'); search.focus(); search.value = 'liner'; search.dispatchEvent(new Event('input', { bubbles: true }))
    await until(() => modal().querySelectorAll('[data-nav-item]').length === 2)
    modal().querySelectorAll('[data-nav-item]')[1].click()
    await until(() => item(tool.id)?.querySelector('[data-find-part="result"]'))
    report.searchPart = document.querySelector('.abele-chat-find__count')?.textContent.trim() === '2 of 2'
    // Other-branch selection changes the send context, follows the earliest later fork, and
    // restores both the original path and its reading position without any rollback.
    document.querySelector('.abele-chat-find input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    // Finish the preceding find excursion before capturing a separate branch-return point.
    // Back intentionally retains the original bookmark until it is used.
    await open(); await choose('Back to place'); await wait(1800)
    const originalLeaf = owner.branchLeafId
    box().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    box().scrollTop += offset('q80') - 16
    await wait(100)
    const originalAt = offset('q80')
    await open()
    modal().querySelector('[data-fork-id="q0"] > summary').click()
    await wait(100)
    modal().querySelector('[data-continuation="other"] > button').click()
    await until(() => owner.branchLeafId === 'other-first')
    report.branchJump = document.querySelector('.abele-ai-chat__continuation')?.textContent.includes('Continuation 2 of 2')
    document.querySelector('.abele-ai-chat__continuation button').click(); await until(modal)
    await choose('Back to place'); await until(() => owner.branchLeafId === originalLeaf)
    await wait(1800)
    report.branchReturn = owner.branchLeafId === originalLeaf
    report.branchPositionDrift = Math.abs(offset('q80') - originalAt)
    owner.isExecutingTool.value = true
    await open()
    // The fork stayed expanded in this session.
    modal().querySelector('[data-continuation="other"] > button').click()
    await wait(150)
    report.branchDeferred = owner.branchLeafId === originalLeaf && !!document.querySelector('.abele-ai-chat__navigation-pending')
    owner.isExecutingTool.value = false
    await until(() => owner.branchLeafId === 'other-first')
    await open(); await choose('Back to place'); await until(() => owner.branchLeafId === originalLeaf)
    await open()
    const scope = modal().querySelector('select')
    scope.value = 'all'; scope.dispatchEvent(new Event('change', { bubbles: true }))
    const words = modal().querySelector('input')
    words.value = 'Hidden alternate'; words.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(100)
    report.allBranchSearch = modal().textContent.includes('Continuation 2 of 2') && modal().querySelectorAll('[data-nav-item]').length === 1
    words.value = 'Sample question 0'; words.dispatchEvent(new Event('input', { bubbles: true })); await wait(100)
    report.sharedOnce = modal().querySelectorAll('[data-nav-item]').length === 1
    words.value = 'How much shade'; words.dispatchEvent(new Event('input', { bubbles: true }))
    modal().querySelector('[role="checkbox"]').click()
    await until(() => modal().textContent.includes('3 of 3 discussions'))
    report.unavailable = modal().textContent.includes('Unavailable discussion') && modal().textContent.includes('Missing sample passage')
    if (window.__e2eHost) await window.__e2eHost.shot(${JSON.stringify(SHOTS + '/navigation-search-discussions.png')})
    await choose('How much shade')
    await until(() => chats.activeSession.value?.commentId === 'navd02' && document.querySelector('.abele-chat-find__count')?.textContent.trim() === '1 of 1')
    report.discussionSearch = true
    await open(); await choose('Back to place'); await until(() => chats.activeSession.value === owner)
    report.draft = owner.draft.value.text
    // The search/jump cannot have selected the alternate answer. Account for the explicit
    // synthetic append above, which alone changed the leaf.
    report.selectedBranch = owner.messages.value.some(m => m.id === 'other') ? 'other' : report.beforeBranch
    return JSON.stringify(report)
  } finally {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    if (owner) { owner.isStreaming.value = false; owner.isExecutingTool.value = false; owner.streamingContent.value = '' }
    for (const id of ['navd02', 'navd01']) {
      if (comments.isShown(id)) await comments.hideFromSidebar(id)
      await comments.remove(id)
    }
    if (owner) await chats.deleteChat(owner.id)
    for (const file of files) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file)
    for (const dir of dirs) { const folder = app.vault.getAbstractFileByPath(dir); if (folder && !folder.children.length) await app.vault.delete(folder) }
  }
})()`

describe.skipIf(!available || !onPhone())('navigation with the phone keyboard', () => {
  it('opens without the keyboard, then keeps the tapped search field above the real keyboard', async () => {
    try {
      const initial = JSON.parse(
        await evalLong(`(async () => {
        window.__abeleTest.openDialog('chat-navigation')
        for (let i=0; i<100 && !document.querySelector('.abele-chat-navigation input'); i++) await new Promise(r => setTimeout(r, 30))
        await new Promise(r => setTimeout(r, 300))
        const field = document.querySelector('.abele-chat-navigation input')
        const r = field.getBoundingClientRect()
        return JSON.stringify({ keyboard: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')) || 0, focused: field === document.activeElement, x: r.left + r.width/2, y: r.top + r.height/2 })
      })()`)
      ) as { keyboard: number; focused: boolean; x: number; y: number }
      expect(initial.keyboard).toBe(0)
      expect(initial.focused).toBe(false)
      tap(initial.x, initial.y)
      typeText('sample question')
      const measured = JSON.parse(
        await evalLong(`(async () => {
        const height = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')) || 0
        for (let i=0; i<100 && !height(); i++) await new Promise(r => setTimeout(r, 50))
        await new Promise(r => setTimeout(r, 800))
        const field = document.querySelector('.abele-chat-navigation input'), r = field.getBoundingClientRect()
        const shot = await window.__e2eHost.shot(${JSON.stringify(SHOTS + '/navigation-keyboard.png')})
        return JSON.stringify({ keyboard: height(), top: r.top, bottom: r.bottom, keyboardTop: window.innerHeight-height(), value: field.value, results: document.querySelectorAll('.abele-chat-navigation [data-nav-item]').length, shot })
      })()`)
      ) as {
        keyboard: number
        top: number
        bottom: number
        keyboardTop: number
        value: string
        results: number
      }
      expect(measured.keyboard).toBeGreaterThan(0)
      expect(measured.top).toBeGreaterThanOrEqual(0)
      expect(measured.bottom).toBeLessThanOrEqual(measured.keyboardTop)
      expect(measured.value).toBe('sample question')
      expect(measured.results).toBe(40)
    } finally {
      evalRaw(
        `document.activeElement?.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`
      )
    }
  }, 60_000)
})

describe.skipIf(!available)('current-branch chat navigation', () => {
  it('jumps, returns, opens direct and nested discussions, and keeps the draft and reading place', async () => {
    const result = JSON.parse(await evalLong(script, 90_000)) as NavigationReport
    console.warn(
      `Navigation of 600 messages: mount ${Math.round(result.jumpMs)} ms; settled sample ${Math.round(result.settledMs)} ms`
    )
    expect(result.unfocusedSearch).toBe(true)
    expect(result.questions).toBe(300)
    expect(result.hiddenBranch).toBe(true)
    expect(result.firstMounted).toBe(true)
    expect(result.drift).toBeLessThan(2)
    expect(result.latest).toBe(true)
    expect(result.returned).toBe(true)
    expect(result.middleReturnDrift).toBeLessThan(2)
    expect(result.nestedBack).toBe(true)
    expect(result.discussion).toBe(true)
    expect(result.nested).toBe(true)
    expect(result.discussionReturn).toBe(true)
    expect(result.draft).toBe('An unsent sample follow-up')
    expect(result.searchPart).toBe(true)
    expect(result.selectedBranch).toBe(result.beforeBranch)
    expect(result.branchJump).toBe(true)
    expect(result.branchReturn).toBe(true)
    expect(result.branchPositionDrift).toBeLessThan(2)
    expect(result.branchDeferred).toBe(true)
    expect(result.allBranchSearch).toBe(true)
    expect(result.sharedOnce).toBe(true)
    expect(result.discussionSearch).toBe(true)
    expect(result.unavailable).toBe(true)
  }, 100_000)
})
