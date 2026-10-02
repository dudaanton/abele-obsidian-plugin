import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
  setBackgroundThrottling,
  setFocusEmulation,
} from './helpers/obsidianCli'

import { withNativeInput } from './helpers/nativeInput'

const CHAT = 'sample-composer-submit.abchat'
const NOTE = 'sample-composer-link.md'
const DRAFT = 'See [[sample-composer-link]]'
const available = isObsidianRunning() && hasTestApi()

const setup = async () => {
  const answer = await evalLong(
    `(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const chats = window.__abeleTest.ChatService.getInstance()
    const state = window.__composerSubmit = { layout: app.workspace.getLayout(), sent: [], opened: [] }
    const note = await app.vault.create(${JSON.stringify(NOTE)}, 'A sample link target.')
    const file = await app.vault.create(${JSON.stringify(CHAT)}, JSON.stringify({
      v: 2, k: 'meta', type: 'abele-chat', title: 'Sample composer',
      providerId: '', modelId: '', created: '2020-01-01',
    }) + '\\n')
    await chats.openChatFile(file)
    await chats.revealSidebar()
    state.session = chats.getSessionByFile(${JSON.stringify(CHAT)})
    state.session.sendMessage = async (message) => { state.sent.push(message) }
    state.openLinkText = app.workspace.openLinkText
    app.workspace.openLinkText = function (...args) {
      state.opened.push(args[0])
      return state.openLinkText.apply(this, args)
    }
    await wait(500)
    const composer = window.__abeleTest.composer()
    if (!composer) throw new Error('No composer on screen')
    composer.set(${JSON.stringify(DRAFT)})
    composer.focus()
    const view = window.__abeleTest.noteFieldView(composer.field)
    if (!view) throw new Error('Composer did not borrow the note editor')
    view.dispatch({ selection: { anchor: 15 } })
    app.workspace.editorSuggest.close?.()
    await wait(250)
    return JSON.stringify({ focused: composer.hasFocus(), cursor: view.state.selection.main.head })
  })()`,
    30_000
  )
  expect(JSON.parse(answer)).toEqual({ focused: true, cursor: 15 })
}

const cleanup = async () => {
  await evalLong(
    `(async () => {
    const state = window.__composerSubmit
    if (!state) return 'nothing to restore'
    if (state.openLinkText) app.workspace.openLinkText = state.openLinkText
    const chats = window.__abeleTest.ChatService.getInstance()
    window.__abeleTest.composer()?.set('')
    if (state.session) await chats.deleteChat(state.session.id)
    await app.workspace.changeLayout(state.layout)
    for (const path of ${JSON.stringify([CHAT, NOTE])}) {
      const file = app.vault.getAbstractFileByPath(path)
      if (file) await app.vault.delete(file)
    }
    delete window.__composerSubmit
    return 'restored'
  })()`,
    30_000
  )
}

const result = () =>
  evalJson<{ sent: string[]; opened: string[]; text: string }>(`({
  sent: window.__composerSubmit.sent,
  opened: window.__composerSubmit.opened,
  text: window.__abeleTest.composer()?.get(),
})`)

const key = async (shift = false) =>
  withNativeInput(async () => {
    const mod = process.platform === 'darwin' ? 4 : 2
    const props = {
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      modifiers: shift ? 8 : mod,
    }
    runCli([
      'dev:cdp',
      'method=Input.dispatchKeyEvent',
      `params=${JSON.stringify({ type: 'rawKeyDown', ...props })}`,
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
    runCli([
      'dev:cdp',
      'method=Input.dispatchKeyEvent',
      `params=${JSON.stringify({ type: 'keyUp', ...props })}`,
    ])
  })

const pause = () => new Promise((resolve) => setTimeout(resolve, 500))

describe.skipIf(!available)('composer submit on a wikilink', () => {
  beforeAll(async () => {
    setBackgroundThrottling(false)
    setFocusEmulation(true)
    await setup()
  }, 60_000)

  afterAll(async () => {
    await cleanup()
    setFocusEmulation(false)
    setBackgroundThrottling(true)
  }, 60_000)

  it('native Mod+Enter sends exactly once and never opens the link under the cursor', async () => {
    await key()
    await pause()
    expect(result()).toEqual({ sent: [DRAFT], opened: [], text: '' })
  })
})

describe.skipIf(!available)('composer send with a phone keyboard', () => {
  let size: [number, number]

  beforeAll(async () => {
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    await reloadApp('app.emulateMobile(true)')
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
    setBackgroundThrottling(false)
    setFocusEmulation(true)
    await setup()
    evalRaw(`(() => {
      document.documentElement.style.setProperty('--keyboard-height', '336px')
      const event = new Event('keyboardWillShow')
      event.keyboardHeight = 336
      window.dispatchEvent(event)
      return 'keyboard shown'
    })()`)
  }, 180_000)

  afterAll(async () => {
    evalRaw(`(() => {
      document.documentElement.style.removeProperty('--keyboard-height')
      window.dispatchEvent(new Event('keyboardWillHide'))
      return 'keyboard hidden'
    })()`)
    await cleanup()
    if (size)
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
      )
    setFocusEmulation(false)
    setBackgroundThrottling(true)
    await reloadApp('app.emulateMobile(false)')
  }, 180_000)

  it('the Send button sends the wikilink without opening it and keeps the field focused', async () => {
    evalRaw(`(() => {
      const field = window.__abeleTest.composer().field
      const input = field.closest('.abele-chat-input')
      input.querySelector('.abele-chat-input__toolbar-right [data-keeps-focus]').click()
      return 'sent'
    })()`)
    await pause()
    expect(result()).toEqual({ sent: [DRAFT], opened: [], text: '' })
    expect(evalJson<boolean>('window.__abeleTest.composer().hasFocus()')).toBe(true)
  })
})
