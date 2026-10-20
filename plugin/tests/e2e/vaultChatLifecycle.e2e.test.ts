import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop')
const shots = shotDir('vault-chat-lifecycle')

// Uses real vault tools and approval controls, without a provider or a model request.
const probe = (screen: string) => `(async () => {
  const chats = window.__abeleTest.ChatService.getInstance()
  const prior = chats.activeTabId.value
  const collapsed = app.workspace.rightSplit.collapsed
  const root = 'SampleVaultChatLifecycle'
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (fn, stage = 'chat') => { for (let i=0; i<100; i++) { if (fn()) return; await wait(50) } throw Error('Sample state timed out: ' + stage) }
  const closeModal = async () => {
    const modal = [...document.querySelectorAll('.modal')].reverse().find(el => el.getBoundingClientRect().width)
    if (!modal) return
    const close = [...modal.closest('.modal-container').querySelectorAll('.modal-header-button, .modal-close-button')].find(el => el.getBoundingClientRect().width)
    if (!close) throw Error('Sample modal has no visible native close control')
    close.click()
    await until(() => !modal.isConnected, 'modal closed')
  }
  const report = { error: '', shots: [], edited: false, moved: false, hiddenRemoved: false, denied: false, failed: false, stopped: false, permission: false, changes: false, scope: false, runFits: false, quoteWidth: 0 }
  let session
  const shot = async name => {
    await wait(150)
    const path = ${JSON.stringify(shots)} + '/' + ${JSON.stringify(screen)} + '-' + name + '.png'
    const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
    require('fs').writeFileSync(path, image.toPNG()); report.shots.push(path)
  }
  const pending = async (id, name, args) => {
    const call = { type: 'toolCall', id, name, arguments: args }
    session.pendingToolCalls.value = [call]
    session.ensurePendingToolCallMessage(call)
    session.updateVisibleMessages()
    await until(() => document.querySelector('.abele-tool-approval'))
  }
  try {
    if (await app.vault.adapter.exists(root)) throw Error('Sample folder already exists')
    await app.vault.createFolder(root)
    await app.vault.create(root + '/sample.md', 'Before')
    const tab = chats.createTab()
    if (tab === prior) throw Error('No sample tab available')
    session = chats.getSession(tab)
    session.checkAnswer = async () => {}
    session.runAgentLoop = async () => {}
    session.scopeResolver.setFullVaultAccess(true)
    session.permissionMode.value = 'confirm-all'
    session.toolModes.value = { ...session.toolModes.value, edit: 'ask', create: 'ask', mv: 'ask', rm: 'ask' }
    await chats.revealSidebar()
    await session.addUserNote('> From [[Sample note]]:\\n> Move the release to Friday and keep the whole selected passage readable.\\n\\nPlease update this passage.')
    await until(() => document.querySelector('.abele-chat-msg_user blockquote'))
    const quote = document.querySelector('.abele-chat-msg_user blockquote')
    report.quoteWidth = quote.getBoundingClientRect().width
    await shot('quote')
    await session.getTools().find(tool => tool.name === 'read').execute('sample-read', { path: root + '/sample.md' })
    await pending('sample-edit', 'edit', { path: root + '/sample.md', old_string: 'Before', new_string: 'Proposed\\nSecond line' })
    document.querySelector('.abele-tool-approval__more').click()
    await until(() => [...document.querySelectorAll('.menu-item')].some(el => el.textContent.trim() === 'Edit before allowing'))
    ;[...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim() === 'Edit before allowing').click()
    await until(() => document.querySelector('.abele-tool-approval textarea'))
    const editor = document.querySelector('.abele-tool-approval textarea')
    if (editor.value !== 'Proposed\\nSecond line') throw Error('Approval edits JSON instead of content')
    editor.value = 'Revised\\nSecond line'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await shot('edit-content')
    ;[...document.querySelectorAll('.abele-tool-approval button')].find(el => el.textContent === 'Allow as edited').click()
    await until(() => !session.pendingToolCalls.value.length && !session.isExecutingTool.value)
    report.edited = await app.vault.adapter.read(root + '/sample.md') === 'Revised\\nSecond line'
    await shot('after-edit')
    await pending('sample-denied', 'mv', { from: root + '/sample.md', to: root + '/Denied/sample.md' })
    await session.rejectToolCall()
    await wait(100)
    report.denied = document.querySelector('.abele-ai-chat').textContent.includes('Denied: Move file')
    await shot('denied')
    await pending('sample-move', 'mv', { from: root + '/sample.md', to: root + '/New/Nested/sample.md' })
    await session.approveToolCall()
    report.moved = await app.vault.adapter.exists(root + '/New/Nested/sample.md')
    await pending('sample-failed-move', 'mv', { from: root + '/New/Nested/sample.md', to: root + '/New/Nested/sample.md' })
    await session.approveToolCall()
    report.failed = document.querySelector('.abele-ai-chat').textContent.includes('Move file failed:')
    const run = document.querySelector('.abele-chat-run > .tree-item-self')
    const edge = document.querySelector('.abele-ai-chat').getBoundingClientRect().right
    report.runFits = run.scrollWidth <= run.clientWidth + 1 && [...run.querySelectorAll('.abele-tree-item__text')].every(el => el.getBoundingClientRect().right <= edge + 1)
    report.runFits = report.runFits && Math.abs(run.querySelector('.collapse-icon').getBoundingClientRect().top - run.querySelector('.tree-item-inner').getBoundingClientRect().top) <= 4
    await shot('failed-action')
    await pending('sample-create-hidden', 'create', { path: root + '/.sample.md', content: 'Hidden sample' })
    await session.approveToolCall()
    await pending('sample-remove-hidden', 'rm', { path: root + '/.sample.md' })
    await session.approveToolCall()
    report.hiddenRemoved = !(await app.vault.adapter.exists(root + '/.sample.md'))
    session.permissionMode.value = 'allow-edit'
    await until(() => document.querySelector('.abele-chat-write-permission'))
    await shot('automatic-writes')
    document.querySelector('.abele-chat-write-permission').click()
    await until(() => session.permissionMode.value === 'confirm-all')
    report.permission = true
    await pending('sample-stop', 'edit', { path: root + '/New/Nested/sample.md', old_string: 'Revised', new_string: 'Unfinished' })
    session.stopFromApproval('sample-stop')
    await wait(100)
    report.stopped = document.querySelector('.abele-ai-chat').textContent.includes('Stopped by you')
    await shot('stopped')
    document.querySelector('.abele-ai-chat__overflow .abele-obsidian-icon').click()
    await until(() => [...document.querySelectorAll('.menu-item')].some(el => el.textContent.trim() === 'Files from this chat'))
    ;[...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim() === 'Files from this chat').click()
    await until(() => document.querySelector('.abele-chat-artifacts'))
    report.changes = !!document.querySelector('.abele-chat-artifacts__changes')
    await shot('files')
    document.querySelector('.abele-chat-artifacts__changes [data-path="' + root + '/New/Nested/sample.md"]').click()
    await until(() => {
      const diff = document.querySelector('.abele-chat-artifacts__changes .abele-diff')
      return diff?.textContent.includes('Before') && diff.textContent.includes('Revised')
    }, 'saved file diff')
    await shot('files-diff')
    await closeModal()
    await until(() => !document.querySelector('.abele-chat-artifacts'), 'files closed')
    session.scopeResolver.setFullVaultAccess(false)
    document.querySelector('.abele-ai-chat__overflow .abele-obsidian-icon').click()
    await until(() => [...document.querySelectorAll('.menu-item')].some(el => el.textContent.trim() === 'Access, tools and chat settings'), 'setup menu')
    ;[...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim() === 'Access, tools and chat settings').click()
    await until(() => document.querySelector('.abele-scope-mgr__field input'), 'scope field')
    const scopeInput = document.querySelector('.abele-scope-mgr__field input')
    scopeInput.focus(); scopeInput.value = root
    scopeInput.dispatchEvent(new Event('input', { bubbles: true }))
    await until(() => [...document.querySelectorAll('.suggestion-container')].some(el => el.textContent.includes(root)), 'scope suggestions')
    report.scope = true
    await shot('scope-suggestions')
  } catch (error) {
    report.error = String(error.message ?? error)
    report.scopeState = { fullVault: session?.scopeResolver.fullVaultAccess.value, input: document.querySelector('.abele-scope-mgr__field input')?.value, suggestions: [...document.querySelectorAll('.suggestion-container')].map(el => el.textContent.slice(0, 300)), modal: document.querySelector('.modal')?.textContent.slice(0, 1000) }
    await shot('error')
  }
  finally {
    await closeModal()
    if (session) { session.abort(); await chats.deleteChat(session.id) }
    if (prior) chats.activeTabId.value = prior
    const folder = app.vault.getAbstractFileByPath(root)
    if (folder) await app.vault.delete(folder, true)
    if (collapsed) app.workspace.rightSplit.collapse()
  }
  return JSON.stringify(report)
})()`

describe('vault chat file lifecycle', () => {
  it.each(['desktop', 'phone'])(
    '%s shows actual outcomes and usable approval content',
    async (screen) => {
      expect(isObsidianRunning() && hasTestApi()).toBe(true)
      const run = async () => JSON.parse(await evalLong(probe(screen), 180_000))
      const report = screen === 'phone' ? await withEmulatedPhone(run) : await run()
      console.info(JSON.stringify(report))
      expect(report.error).toBe('')
      for (const key of [
        'edited',
        'moved',
        'hiddenRemoved',
        'denied',
        'failed',
        'stopped',
        'permission',
        'changes',
        'scope',
        'runFits',
      ])
        expect(report[key], key).toBe(true)
      expect(report.quoteWidth).toBeGreaterThan(180)
      expect(report.shots).toHaveLength(10)
    },
    240_000
  )
})
