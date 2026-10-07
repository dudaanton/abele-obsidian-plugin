import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { outwardBoxShadowReach } from '../helpers/focusRingPaint'

targets('desktop', 'phone')
const SHOTS = shotDir('abele-phone')
const available = isObsidianRunning() && hasTestApi()
describe.skipIf(!available)('one view of a chat’s artifacts', () => {
  it('persists uploads, completed image outputs and script writes; opens, reveals and unlinks without deleting', async () => {
    const result = JSON.parse(
      await evalLong(
        `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const until = async fn => { for (let i = 0; i < 100; i++) { const value = fn(); if (value) return value; await wait(50) } throw Error('UI did not appear') }
      const api = window.__abeleTest, chats = api.ChatService.getInstance(), config = api.AbeleConfig.getInstance()
      const priorTab = chats.activeTabId.value, priorLeaf = app.workspace.activeLeaf
      const oldScripts = { enabled: config.ai.scriptsEnabled, folder: config.ai.scriptsFolder }
      const oldFolder = app.vault.getConfig('attachmentFolderPath')
      const directory = 'Sample artifact conversation'
      if (app.vault.getAbstractFileByPath(directory)) throw Error('Synthetic folder already exists')
      await app.vault.createFolder(directory)
      await app.vault.createFolder(directory + '/Scripts')
      const layout = app.workspace.getLayout()
      let tab, session, getTools, chatFile
      const created = [], observations = {}, cuts = [], over = []
      const close = async () => { document.querySelector('.modal-close-button')?.click(); await wait(100) }
      const root = () => document.querySelector('.abele-chat-artifacts')
      const card = path => [...root().querySelectorAll('.abele-card')].find(el => el.querySelector('.abele-card__subtitle')?.textContent === path)
      const press = (host, text) => { const button = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text); if (!button || button.disabled) throw Error('Missing enabled button: ' + text); button.click() }
      const capture = async name => {
        const path = ${JSON.stringify(SHOTS + '/chat-artifacts-')} + name + '.png'
        if (${onPhone()}) await window.__e2eHost.shot(path)
        else { const image = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(path, image.toPNG()) }
        return path
      }
      try {
        config.ai.scriptsEnabled = true; config.ai.scriptsFolder = directory + '/Scripts'
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
          await session.executeCurrentPendingTool(undefined, undefined, true)
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
        await until(() => document.querySelector('.abele-ai-chat__artifacts'))
        document.querySelector('.abele-ai-chat__artifacts').click()
        await until(root)
        observations.sections = [...root().querySelectorAll('h3')].map(el => el.textContent)
        observations.images = root().querySelectorAll('.abele-chat-picture img').length
        observations.origins = root().textContent
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
        press(card(script), 'Open'); await wait(200)
        observations.opened = app.workspace.getLeavesOfType('abele-code').some(leaf => leaf.view.file?.path === script)
        press(card(script), 'Reveal'); await wait(200)
        observations.revealRows = [...document.querySelectorAll('.nav-file')].filter(el => el.dataset.path === script || el.querySelector('[data-path]')?.dataset.path === script).map(el => ({ cls: el.className + ' ' + el.querySelector('.nav-file-title')?.className, path: el.dataset.path, text: el.textContent }))
        observations.revealed = observations.revealRows.some(row => /is-selected|is-active/.test(row.cls))
        const note = directory + '/sample-note.md'
        press(card(note), 'Unlink'); await until(() => !card(note))
        observations.noteKept = !!app.vault.getAbstractFileByPath(note)
        observations.scriptKept = !!app.vault.getAbstractFileByPath(script)
        // A running turn adds a completed result to the already-open view.
        session.isStreaming.value = true
        const extra = await app.vault.createBinary(directory + '/sample-later.png', await blob.arrayBuffer())
        session.appendChatMessage({ id: 'sample-later', role: 'tool-call', content: '', toolName: 'generate_image', toolStatus: 'approved', toolResult: 'Image saved: ' + extra.path, timestamp: 20 })
        session.updateVisibleMessages()
        await until(() => root().textContent.includes('Images (4)'))
        session.isStreaming.value = false
        observations.live = true
        const missing = app.vault.getAbstractFileByPath(created[1]); await app.vault.rename(missing, directory + '/sample-moved.png')
        await until(() => card(created[1]).textContent.includes('Unavailable'))
        observations.missing = card(created[1]).textContent.includes('Show in chat')
        press(card(upload.path), 'Show in chat')
        await until(() => !root())
        observations.source = !!document.querySelector('[data-message-id="sample-upload"]')
        return JSON.stringify({ ...observations, cuts, over })
      } catch (error) { return JSON.stringify({ error: String(error.stack || error), observations }) }
      finally {
        if (session) { session.isStreaming.value = false; if (getTools) session.getTools = getTools }
        await close()
        if (tab) await chats.closeTab(tab)
        if (priorTab) chats.switchTab(priorTab)
        if (chatFile) { const file = app.vault.getAbstractFileByPath(chatFile.path); if (file) await app.vault.delete(file) }
        const dir = app.vault.getAbstractFileByPath(directory); if (dir) await app.vault.delete(dir, true)
        config.ai.scriptsEnabled = oldScripts.enabled; config.ai.scriptsFolder = oldScripts.folder
        app.vault.setConfig('attachmentFolderPath', oldFolder)
        await app.workspace.changeLayout(layout)
        if (priorLeaf?.containerEl?.isConnected) app.workspace.setActiveLeaf(priorLeaf, { focus: false })
      }
    })()`,
        45_000
      )
    )
    expect(result.error).toBeUndefined()
    expect(result.sections).toEqual(['Notes (1)', 'Images (3)', 'Scripts (1)'])
    expect(result.images).toBe(3)
    expect(result.origins).toContain('Generated')
    expect(result.origins).toContain('Edited')
    expect(result.origins).toContain('Uploaded')
    expect(result.opened).toBe(true)
    expect(result.revealed, JSON.stringify(result.revealRows)).toBe(true)
    expect(result.noteKept).toBe(true)
    expect(result.scriptKept).toBe(true)
    expect(result.live).toBe(true)
    expect(result.missing).toBe(true)
    expect(result.source).toBe(true)
    expect(result.cuts).toEqual([])
    expect(result.over).toEqual([])
  }, 60_000)
})
