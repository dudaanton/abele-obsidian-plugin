import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evalJson, evalLong } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { designCaptureExpression } from '../helpers/designCapture'
import { lintDesign, type DesignSnapshot } from '../helpers/designLint'

targets('desktop', 'phone')
const directory = shotDir('agents-list')
const states = ['empty', 'waiting', 'many', 'working', 'error', 'mixed'] as const
const close = `for (const button of [...document.querySelectorAll('.modal .modal-header-button, .modal-close-button')].reverse()) button.click()`

beforeAll(async () => {
  expect(
    await evalLong(`(async () => {
    ${close}
    const root = 'AgentsListLayoutFixture'
    if (app.vault.getAbstractFileByPath(root)) throw new Error('Layout fixture already exists')
    window.__agentsListLayout = app.workspace.getLayout()
    await app.vault.createFolder(root)
    await app.vault.create(root + '/target.md', 'A fabricated target.\\n')
    await app.vault.create(root + '/source.md', 'A fabricated link to [[' + root + '/target]].\\n')
    for (let i = 0; i < 50 && !app.metadataCache.resolvedLinks[root + '/source.md']?.[root + '/target.md']; i++) await new Promise(r => setTimeout(r, 100))
    await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath(root + '/target.md'))
    const leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: 'backlink', state: { file: root + '/target.md' }, active: true })
    app.workspace.leftSplit.collapse()
    await new Promise(r => setTimeout(r, 500))
    return 'ready'
  })()`)
  ).toBe('ready')
})
afterAll(async () => {
  await evalLong(`(async () => {
    ${close}
    if (window.__agentsListLayout) {
      await app.workspace.changeLayout(window.__agentsListLayout)
      delete window.__agentsListLayout
      const root = app.vault.getAbstractFileByPath('AgentsListLayoutFixture')
      if (root) await app.vault.delete(root, true)
    }
    return 'closed'
  })()`)
})

describe('real agents list on synthetic states', () => {
  for (const state of states) {
    it(`${state} keeps native rows, labelled states, one close and no overflow`, async () => {
      const path = join(directory, `${state}-${onPhone() ? 'phone' : 'desktop'}.png`)
      const raw = await evalLong(`(async () => {
        ${close}
        window.__abeleTest.openDialog('agents', { agentsState: ${JSON.stringify(state)} })
        await new Promise(r => setTimeout(r, 400))
        await document.fonts.ready
        const root = document.querySelector('.abele-agents')
        if (!root) throw new Error('Agents list did not mount')
        const snapshot = ${designCaptureExpression('.modal.abele-modal', { nativeSelector: '.backlink-pane .search-result-file-title' })}
        const overflowing = [...root.querySelectorAll('*')].filter(el => {
          const r = el.getBoundingClientRect()
          return r.width && (r.left < 0 || r.right > innerWidth + 1)
        }).map(el => el.className)
        const closes = document.querySelectorAll('.modal .modal-header-button, .modal .modal-close-button').length
        const searchFocused = root.querySelector('input') === document.activeElement
        const rows = root.querySelectorAll('.abele-list-row').length
        if (window.__e2eHost) await window.__e2eHost.shot(${JSON.stringify(path)})
        else {
          const win = require('@electron/remote').getCurrentWindow()
          require('fs').writeFileSync(${JSON.stringify(path)}, (await win.webContents.capturePage()).toPNG())
        }
        return JSON.stringify({ snapshot, overflowing, closes, searchFocused, rows })
      })()`)
      const result = JSON.parse(raw) as {
        snapshot: DesignSnapshot
        overflowing: string[]
        closes: number
        searchFocused: boolean
        rows: number
      }
      expect(result.overflowing).toEqual([])
      expect(result.closes).toBe(1)
      expect(result.searchFocused).toBe(false)
      expect(result.rows).toBe(
        state === 'empty' ? 0 : state === 'many' ? 4 : state === 'mixed' ? 3 : 1
      )
      const violations = lintDesign(result.snapshot, { requireNative: true })
      writeFileSync(
        join(directory, `${state}-${onPhone() ? 'phone' : 'desktop'}-lint.json`),
        JSON.stringify({ snapshot: result.snapshot, violations }, null, 2)
      )
      expect(violations).toEqual([])
    })
  }
  it('Reply opens the existing live question and focuses its composer without answering', async () => {
    const raw = await evalLong(`(async () => {
      ${close}
      const chats = window.__abeleTest.ChatService.getInstance()
      const previous = chats.activeTabId.value
      const id = chats.newTab()
      const session = chats.getSession(id)
      try {
        session.chatTitle.value = 'Fabricated waiting question'
        const questions = [{ question: 'Which fabricated folder?', options: [] }]
        session.pendingQuestions.value = { questions, currentIndex: 0, answers: [], resolve: () => {} }
        session.attention.value = { question: { id: 'fabricated-question', at: Date.now(), status: 'waiting', currentIndex: 0, answers: [], questions } }
        await chats.revealSidebar({ focus: false })
        app.commands.executeCommandById('abele:agents')
        await new Promise(r => setTimeout(r, 300))
        const row = [...document.querySelectorAll('.abele-list-row')].find(el => el.querySelector('.abele-list-row__title-text')?.textContent === session.chatTitle.value)
        if (!row) throw new Error('Live question is not in the list')
        row.querySelector('.abele-list-row__recovery button').click()
        await new Promise(r => setTimeout(r, 500))
        const question = document.querySelector('.abele-ai-chat__questions')
        const composer = document.querySelector('.abele-chat-input')
        return JSON.stringify({ modalClosed: !document.querySelector('.abele-agents'), exactQuestion: question?.dataset.attentionId === 'fabricated-question', composerFocused: composer?.contains(document.activeElement), waiting: session.attention.value.question?.status, pending: !!session.pendingQuestions.value, sameSession: chats.activeSession.value === session })
      } finally {
        ${close}
        session.pendingQuestions.value = null
        session.attention.value = {}
        chats.dropTab(id)
        session.destroy()
        if (previous) chats.switchTab(previous)
      }
    })()`)
    expect(JSON.parse(raw)).toEqual({
      modalClosed: true,
      exactQuestion: true,
      composerFocused: true,
      waiting: 'waiting',
      pending: true,
      sameSession: true,
    })
  })
  it.skipIf(onPhone())(
    'activates the native opening button once for Enter and once for Space',
    async () => {
      const result = await evalLong(`(async () => {
      ${close}
      window.__abeleTest.openDialog('agents', { agentsState: 'waiting' })
      await new Promise(r => setTimeout(r, 200))
      const button = document.querySelector('.abele-list-row__main')
      let clicks = 0
      button.addEventListener('click', () => clicks++)
      const contents = require('@electron/remote').getCurrentWindow().webContents
      for (const key of ['Enter', ' ']) {
        button.focus()
        await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key === 'Enter' ? '\\r' : ' ', code: key === 'Enter' ? 'Enter' : 'Space', windowsVirtualKeyCode: key === 'Enter' ? 13 : 32 })
        await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === 'Enter' ? 'Enter' : 'Space', windowsVirtualKeyCode: key === 'Enter' ? 13 : 32 })
      }
      return JSON.stringify({ clicks, focused: document.activeElement === button })
    })()`)
      expect(JSON.parse(result)).toEqual({ clicks: 2, focused: true })
      expect(evalJson("!!document.querySelector('.abele-agents')")).toBe(true)
    }
  )
})
