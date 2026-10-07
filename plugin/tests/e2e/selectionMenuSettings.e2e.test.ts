import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { WAIT_PRELUDE } from './helpers/wait'
import { SELECTION_MENUS_OPEN } from './helpers/selectionMenus'
import { targets } from './helpers/target'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample selection menu scripts'
let previous: Record<string, unknown>
const OPEN = `${WAIT_PRELUDE}\n${SELECTION_MENUS_OPEN}`

describe.skipIf(!available)('independent selection menus in native settings', () => {
  beforeAll(() => {
    previous = evalJson(`(() => {
      const c = window.__abeleTest.AbeleConfig.getInstance()
      return {ai: c.ai, reader: c.reader}
    })()`)
    evalAsync(`(async () => {
      const c = window.__abeleTest.AbeleConfig.getInstance()
      if (app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) throw Error('Synthetic scripts folder already exists')
      await app.vault.createFolder(${JSON.stringify(DIR)})
      await app.vault.create(${JSON.stringify(DIR + '/both.js')}, '// @name Sample shared action\\n// @book\\n// @chat-selection\\nreturn "sample"')
      await app.vault.create(${JSON.stringify(DIR + '/book.js')}, '// @name Sample book action\\n// @book\\nreturn "sample"')
      await app.vault.create(${JSON.stringify(DIR + '/chat.js')}, '// @name Sample chat action\\n// @chat-selection\\nreturn "sample"')
      c.editSettings(() => {
        c.ai = {...c.ai, scriptsEnabled: true, scriptsFolder: ${JSON.stringify(DIR)}, chatSelectionScripts: []}
        c.reader = {...c.reader, selectionScripts: []}
      })
      await c.saveSettings()
      await window.__abeleTest.ScriptService.getInstance().discover()
      return true
    })()`)
  })

  afterAll(() => {
    if (!previous) return
    evalAsync(`(async () => {
      app.setting.close()
      const c = window.__abeleTest.AbeleConfig.getInstance()
      c.editSettings(() => { c.ai = ${JSON.stringify(previous.ai)}; c.reader = ${JSON.stringify(previous.reader)} })
      await c.saveSettings()
      const folder = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (folder) await app.vault.delete(folder, true)
      await window.__abeleTest.ScriptService.getInstance().discover()
      return true
    })()`)
  })

  it('pins, labels, orders and draws the same script independently, and retains both lists after disk reload', () => {
    const customized = evalAsync<{ book: unknown[]; chat: unknown[] }>(`(async () => {
      ${OPEN}
      const document = menuDoc
      const c = window.__abeleTest.AbeleConfig.getInstance()
      const row = script => [...document.querySelectorAll('.abele-selection-scripts-settings__headed')].find(e => e.dataset.script === script)
      const add = async script => {
        row(script).querySelector('button').click()
        if (!await until(() => [...document.querySelectorAll('.abele-selection-scripts-settings__entry')].some(e => e.dataset.script === script), 5000)) throw Error('Script was not added')
      }
      const entry = script => [...document.querySelectorAll('.abele-selection-scripts-settings__entry')].find(e => e.dataset.script === script)
      const label = async text => {
        const input = entry('Sample shared action').querySelector('input')
        input.value = text; input.dispatchEvent(new Event('input', {bubbles: true}))
        await wait(700)
      }
      const icon = async name => {
        entry('Sample shared action').querySelector('[aria-label="Choose the icon it has on the bar"]').click()
        if (!await until(() => document.querySelector('.abele-icon-picker input'), 5000)) throw Error('Icon picker did not open')
        const input = document.querySelector('.abele-icon-picker input')
        input.value = name; input.dispatchEvent(new Event('input', {bubbles: true}))
        await wait(300)
        document.querySelector('.abele-icon-picker [aria-label="' + name + '"]').click()
        await until(() => !document.querySelector('.abele-icon-picker'), 5000)
      }
      await add('Sample shared action')
      await label('Book action')
      await icon('book')
      await add('Sample book action')
      entry('Sample book action').querySelector('[aria-label="Move it up the menu"]').click()
      await wait(700)
      ;[...document.querySelectorAll('.abele-settings__selection-menus .abele-tabs__tab')].find(t => t.textContent.trim() === 'Chats').click()
      await until(() => document.querySelector('[data-surface="chat"]'), 5000)
      if (document.querySelector('.abele-selection-scripts-settings').textContent.includes('Sample book action')) throw Error('Book header leaked into chat')
      await add('Sample shared action')
      await label('Chat action')
      await icon('message-square')
      await add('Sample chat action')
      await wait(700)
      app.setting.close()
      await c.reloadSettings()
      return {book: c.reader.selectionScripts, chat: c.ai.chatSelectionScripts}
    })()`)
    expect(customized.book).toEqual([
      { script: 'Sample book action', name: '', icon: '' },
      { script: 'Sample shared action', name: 'Book action', icon: 'book' },
    ])
    expect(customized.chat).toEqual([
      { script: 'Sample shared action', name: 'Chat action', icon: 'message-square' },
      { script: 'Sample chat action', name: '', icon: '' },
    ])
    const reopened = evalAsync<string[]>(`(async () => {
      ${OPEN}
      const document = menuDoc
      const names = [...document.querySelectorAll('.abele-selection-scripts-settings__entry input')].map(e => e.value)
      ;[...document.querySelectorAll('.abele-settings__selection-menus .abele-tabs__tab')].find(t => t.textContent.trim() === 'Chats').click()
      await until(() => document.querySelector('[data-surface="chat"]'), 5000)
      names.push(...[...document.querySelectorAll('.abele-selection-scripts-settings__entry input')].map(e => e.value))
      app.setting.close()
      return names
    })()`)
    expect(reopened).toEqual(['', 'Book action', 'Chat action', ''])
    expect(evalRaw('window.__abeleTest.ScriptService.getInstance().getAll().length')).toContain('3')
  })
})
