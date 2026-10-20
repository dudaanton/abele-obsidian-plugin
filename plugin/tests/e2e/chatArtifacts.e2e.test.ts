import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { outwardBoxShadowReach } from '../helpers/focusRingPaint'
import { SCRIPT_FIXTURE } from './helpers/scriptFixture'

targets('desktop', 'phone')
const SHOTS = shotDir('abele-phone')
const available = isObsidianRunning() && hasTestApi()
describe.skipIf(!available)('one view of a chat’s artifacts', () => {
  it('persists uploads, completed image outputs and script writes; opens, reveals and unlinks without deleting', async () => {
    const result = JSON.parse(
      await evalLong(
        `(async () => {
      ${SCRIPT_FIXTURE}
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const until = async (fn, what = 'UI') => { for (let i = 0; i < 100; i++) { const value = fn(); if (value) return value; await wait(50) } throw Error(what + ' did not appear') }
      // The phone slides a menu sheet away after its item is pressed; the next menu is only
      // reliably the one just opened once the old sheet has left the DOM.
      const menusGone = () => until(() => !document.querySelector('.menu'), 'no menu')
      const fromMenu = async text => {
        const item = await until(() => [...document.querySelectorAll('.menu .menu-item')].find(el => el.textContent.trim() === text), 'menu item ' + text)
        item.click()
        await menusGone()
      }
      const api = window.__abeleTest, chats = api.ChatService.getInstance(), config = api.AbeleConfig.getInstance()
      const priorTab = chats.activeTabId.value, priorLeaf = app.workspace.activeLeaf
      const oldFolder = app.vault.getConfig('attachmentFolderPath')
      const directory = ${JSON.stringify('Sample artifact conversation ' + randomUUID())}
      let ownsDirectory = false
      const scriptFixture = await saveScriptFixture()
      const layout = app.workspace.getLayout()
      let tab, session, getTools, chatFile
      const created = [], observations = {}, cuts = [], over = []
      const close = async () => { document.querySelector('.modal-close-button')?.click(); await wait(100) }
      const root = () => document.querySelector('.abele-chat-artifacts')
      const openArtifacts = async () => {
        const overflow = await until(() => document.querySelector('.abele-ai-chat__overflow [aria-haspopup="menu"]'))
        await menusGone()
        overflow.click()
        await fromMenu('Files from this chat')
        await until(root, 'files view')
      }
      // A note or script is a tree row, a picture a tile; both carry the file's path.
      const card = path => [...root().querySelectorAll('.abele-chat-artifacts__row, .abele-chat-artifacts__image')].find(el => (el.matches('[data-path]') ? el : el.querySelector('[data-path]'))?.getAttribute('data-path') === path)
      const missing = el => el.matches('.abele-chat-artifacts__row_missing, .abele-chat-artifacts__image_missing')
      const heading = el => el.querySelector('.abele-fold-heading__text').textContent.trim() + ' (' + el.querySelector('.abele-fold-heading__count').textContent.trim() + ')'
      const headings = () => [...root().querySelectorAll(':scope > section:not(.abele-chat-artifacts__changes) > .abele-list-section-header .abele-fold-heading')].map(heading)
      // What the ⋯ of a row (or a right click on a picture) holds; nativeMenus is off for the run.
      const menuOf = async host => {
        await menusGone()
        const more = host.querySelector('.abele-chat-artifacts__more')
        if (more) more.click()
        else host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
        return [...(await until(() => document.querySelector('.menu'), 'menu')).querySelectorAll('.menu-item')]
      }
      const press = async (host, text) => {
        const item = (await menuOf(host)).find(el => el.textContent.trim() === text)
        if (!item || item.classList.contains('is-disabled')) throw Error('Missing enabled menu item: ' + text)
        item.click(); await menusGone(); await wait(50)
      }
      const oldNative = app.vault.getConfig('nativeMenus')
      const capture = async name => {
        const path = ${JSON.stringify(SHOTS + '/chat-artifacts-')} + name + '.png'
        if (${onPhone()}) await window.__e2eHost.shot(path)
        else { const image = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(path, image.toPNG()) }
        return path
      }
      try {
        if (app.vault.getAbstractFileByPath(directory)) throw Error('Synthetic folder already exists')
        await app.vault.createFolder(directory)
        ownsDirectory = true
        await app.vault.createFolder(directory + '/Scripts')
        await enableScriptFixture(directory + '/Scripts')
        app.vault.setConfig('attachmentFolderPath', directory)
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24
        canvas.getContext('2d').fillRect(0, 0, 32, 24)
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
        const upload = await api.importExternalFile(new File([blob], 'sample-upload.png', { type: 'image/png' }))
        created.push(upload.path)
        tab = chats.createTab(); if (tab === priorTab) throw Error('No free chat tab')
        session = chats.getSession(tab)
        session.scopeResolver.entries.value = [{ type: 'folder', path: directory }]
        session.permissionMode.value = 'allow-all'
        session.toolModes.value = { ...session.toolModes.value, create_script: 'auto' }
        await session.addUserNote('An invented conversation')
        session.appendChatMessage({ id: 'sample-upload', role: 'user', content: 'Uploaded picture', timestamp: 1, attachments: [upload.path] })
        session.updateVisibleMessages()
        getTools = session.getTools
        // Only external image generation is deterministic; tool completion, save and reload are real.
        session.getTools = function() {
          const real = getTools.call(this)
          return [...real.filter(t => !['generate_image', 'edit_image'].includes(t.name)), ...['generate_image', 'edit_image'].map(name => ({
            name, label: name, parameters: {}, execute: async () => {
              const file = await app.vault.createBinary(directory + '/' + name + '.png', await blob.arrayBuffer())
              created.push(file.path)
              return { content: [{ type: 'text', text: (name === 'generate_image' ? 'Image saved: ' : 'Edited image saved: ') + file.path }], details: { imagePath: file.path } }
            },
          }))]
        }
        const execute = async (name, args) => {
          const tc = { id: 'sample-' + name + '-' + session.allMessages.value.length, name, arguments: args }
          session.pendingToolCalls.value = [tc]
          session.ensurePendingToolCallMessage(tc)
          await session.executeCurrentPendingTool(tc, args, undefined, true)
          session.updateVisibleMessages(); await session.save()
        }
        await execute('generate_image', { prompt: 'Synthetic square' })
        await execute('edit_image', { source: upload.path, prompt: 'Synthetic edit' })
        await execute('create_script', { name: 'sample-script', content: '// alpha' })
        await execute('read', { path: directory + '/Scripts/sample-script.js' })
        await execute('edit', { path: directory + '/Scripts/sample-script.js', old_string: 'alpha', new_string: 'beta' })
        await execute('create', { path: directory + '/sample-note.md', content: 'An invented note' })
        session.getTools = getTools
        chatFile = session.currentChatFile.value
        await chats.closeTab(tab)
        await chats.openChatFile(chatFile)
        session = chats.getSessionByFile(chatFile.path); tab = session.id
        config.ai.scriptsEnabled = false
        await chats.revealSidebar()
        app.vault.setConfig('nativeMenus', false)
        const overflow = () => document.querySelector('.abele-ai-chat__overflow [aria-haspopup="menu"]')
        await until(overflow)
        document.querySelector('.abele-chat-input__expand').click()
        await until(() => document.querySelector('.abele-ai-chat--composing'))
        overflow().click()
        await fromMenu('Files from this chat')
        await until(root, 'files view')
        observations.sections = headings()
        observations.images = root().querySelectorAll('.abele-chat-picture img').length
        // A picture says where it came from in its tooltip.
        observations.origins = [...root().querySelectorAll('.abele-chat-artifacts__image')].map(el => el.getAttribute('aria-label')).join(' | ')
        const body = root().closest('.abele-modal__body')
        const measure = () => {
          for (const el of root().querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width && r.right > root().getBoundingClientRect().right + 1) over.push(el.className) }
          for (const field of root().querySelectorAll('button, [tabindex="0"]')) {
            if (field.disabled) continue
            field.focus()
            const s = getComputedStyle(field), reach = Math.max((${outwardBoxShadowReach.toString()})(s.boxShadow), s.outlineStyle !== 'none' ? parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset || '0') : 0)
            const r = field.getBoundingClientRect()
            for (let parent = field.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
              const style = getComputedStyle(parent); if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
              const b = parent.getBoundingClientRect(), left = b.left + parent.clientLeft
              if (Math.max(left - r.left + reach, r.right + reach - left - parent.clientWidth) > .5) cuts.push(field.textContent.trim())
            }
          }
        }
        measure(); body.scrollTop = 0
        observations.shot = await capture('populated')
        const script = directory + '/Scripts/sample-script.js'
        card(script).querySelector('.tree-item-self').click(); await wait(200)
        observations.opened = app.workspace.getLeavesOfType('abele-code').some(leaf => leaf.view.file?.path === script)
        await press(card(script), 'Reveal in explorer'); await wait(200)
        observations.revealRows = [...document.querySelectorAll('.nav-file')].filter(el => el.dataset.path === script || el.querySelector('[data-path]')?.dataset.path === script).map(el => ({ cls: el.className + ' ' + el.querySelector('.nav-file-title')?.className, path: el.dataset.path, text: el.textContent }))
        observations.revealed = observations.revealRows.some(row => /is-selected|is-active/.test(row.cls))
        const note = directory + '/sample-note.md'
        await press(card(note), 'Unlink from chat'); await until(() => !card(note))
        observations.noteKept = !!app.vault.getAbstractFileByPath(note)
        observations.scriptKept = !!app.vault.getAbstractFileByPath(script)
        // A running turn adds a completed result to the already-open view.
        session.isStreaming.value = true
        const extra = await app.vault.createBinary(directory + '/sample-later.png', await blob.arrayBuffer())
        session.appendChatMessage({ id: 'sample-later', role: 'tool-call', content: '', toolName: 'generate_image', toolStatus: 'approved', toolResult: 'Image saved: ' + extra.path, toolImagePath: extra.path, timestamp: 20 })
        session.updateVisibleMessages()
        await until(() => headings().includes('Images (4)'))
        session.isStreaming.value = false
        observations.live = true
        const invalidPath = '/' + upload.path
        session.appendChatMessage({ id: 'sample-invalid-path', role: 'user', content: '', attachments: [invalidPath], timestamp: 21 })
        session.updateVisibleMessages()
        await until(() => card(invalidPath))
        observations.invalidUnavailable = missing(card(invalidPath)) &&
          card(invalidPath).querySelector('.abele-status-dot')?.getAttribute('aria-label') === 'File missing' &&
          !card(invalidPath).querySelector('img')
        const moved = app.vault.getAbstractFileByPath(created[1]); await app.vault.rename(moved, directory + '/sample-moved.png')
        await until(() => !card(created[1]))
        observations.missing = !card(created[1]) && session.allMessages.value.some(message => message.toolImagePath === created[1])
        await press(card(upload.path), 'Show in chat')
        await until(() => !root(), 'files view closed')
        const sourceVisible = () => {
          const source = document.querySelector('[data-message-id="sample-upload"]')
          const box = source?.closest('.abele-ai-chat__messages')
          if (!box || box.closest('.abele-ai-chat--composing') || getComputedStyle(box).display === 'none') return false
          const b = box.getBoundingClientRect(), s = source.getBoundingClientRect()
          // Wait for the owning chat's reveal and scroll, not just the dialog's removal.
          return source.classList.contains('abele-footnote-flash') && b.width > 0 && b.height > 0 &&
            b.left >= -1 && b.right <= innerWidth + 1 && s.bottom > b.top && s.top < b.bottom
        }
        await until(sourceVisible, 'the upload in its chat')
        observations.source = !!document.querySelector('[data-message-id="sample-upload"]')
        observations.sourceVisible = sourceVisible()
        observations.sourceShot = await capture('source')
        return JSON.stringify({ ...observations, cuts, over })
      } catch (error) { return JSON.stringify({ error: String(error) + (error && error.stack ? '\\n' + error.stack : ''), observations }) }
      finally {
        // Tools and code views can save the temporary settings. Restore durably before any
        // workspace cleanup that could fail, so the next file never inherits scripts off.
        try {
        app.vault.setConfig('nativeMenus', oldNative)
        config.ai = fixtureClone(scriptFixture.ai)
        await config.saveSettings()
        if (session) { session.isStreaming.value = false; if (getTools) session.getTools = getTools }
        await close()
        if (tab) await chats.closeTab(tab)
        if (priorTab) chats.switchTab(priorTab)
        if (chatFile) { const file = app.vault.getAbstractFileByPath(chatFile.path); if (file) await app.vault.delete(file) }
        if (ownsDirectory) for (const leaf of app.workspace.getLeavesOfType('abele-code')) {
          if (leaf.view.file?.path.startsWith(directory + '/')) leaf.detach()
        }
        const dir = ownsDirectory && app.vault.getAbstractFileByPath(directory); if (dir) await app.vault.delete(dir, true)
        app.vault.setConfig('attachmentFolderPath', oldFolder)
        await app.workspace.changeLayout(layout)
        if (priorLeaf?.containerEl?.isConnected) app.workspace.setActiveLeaf(priorLeaf, { focus: false })
        } finally { await restoreScriptFixture(scriptFixture) }
      }
    })()`,
        45_000
      )
    )
    console.info(JSON.stringify(result))
    expect(result.error).toBeUndefined()
    expect(result.sections).toEqual(['Notes (1)', 'Images (3)', 'Scripts (1)'])
    expect(result.images).toBe(3)
    expect(result.origins).toContain('Made by the agent')
    expect(result.origins).toContain('Edited by the agent')
    expect(result.origins).toContain('Uploaded')
    expect(result.opened).toBe(true)
    expect(result.revealed, JSON.stringify(result.revealRows)).toBe(true)
    expect(result.noteKept).toBe(true)
    expect(result.scriptKept).toBe(true)
    expect(result.live).toBe(true)
    expect(result.missing).toBe(true)
    expect(result.source).toBe(true)
    expect(result.sourceVisible).toBe(true)
    expect(result.invalidUnavailable).toBe(true)
    expect(result.cuts).toEqual([])
    expect(result.over).toEqual([])
  }, 60_000)
})
