/**
 * The chat's tab keys, pressed for real in the running app: through the devtools protocol, so
 * they go through Obsidian's own keymap exactly as a keyboard's would, and the test shows that
 * the chat — not Obsidian's hotkeys — answers them while the cursor is in the chat, and that
 * Obsidian's answer is untouched once the cursor is elsewhere.
 *
 * The unit tier (`chatTabKeys.test.ts`) proves which key does what. What only the app can show
 * is that a key reaches the chat at all: from the composer, whose field pushes a scope of its
 * own, and from the conversation, where the pane's scope answers.
 *
 * Three sample chats are opened and every tab this file opens is closed again; the chats are
 * deleted at the end and the layout put back. Requires Obsidian running with the development
 * build — see docs/Testing.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  hasTestApi,
  isObsidianRunning,
  runCli,
  setBackgroundThrottling,
  setFocusEmulation,
} from './helpers/obsidianCli'
import { withNativeInput } from './helpers/nativeInput'

const CHATS = ['sample-shortcuts-a', 'sample-shortcuts-b', 'sample-shortcuts-c'].map(
  (name) => `${name}.abchat`
)
const NOTE = 'sample-shortcuts-note.md'
const available = isObsidianRunning() && hasTestApi()
const mac = process.platform === 'darwin'

type Mod = 'Mod' | 'Ctrl' | 'Alt' | 'Shift'

const KEYS: Record<string, { code: string; vk: number; key?: string; shifted?: string }> = {
  w: { code: 'KeyW', vk: 87 },
  t: { code: 'KeyT', vk: 84 },
  c: { code: 'KeyC', vk: 67 },
  '1': { code: 'Digit1', vk: 49, shifted: '!' },
  '2': { code: 'Digit2', vk: 50, shifted: '@' },
  '9': { code: 'Digit9', vk: 57, shifted: '(' },
  ']': { code: 'BracketRight', vk: 221, shifted: '}' },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
}

/** One key, pressed with its modifiers held, as the keyboard sends it. */
const press = (mods: Mod[], name: keyof typeof KEYS) =>
  withNativeInput(async () => {
    const spec = KEYS[name]
    const real = mods.map((m) => (m === 'Mod' ? (mac ? 'Meta' : 'Ctrl') : m))
    const bits = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 } as Record<string, number>
    const modifiers = real.reduce((sum, m) => sum | bits[m], 0)
    const letter = name.length === 1 && /[a-z]/.test(name)
    const key = real.includes('Shift')
      ? letter
        ? name.toUpperCase()
        : (spec.shifted ?? name)
      : name
    const props = {
      key,
      code: spec.code,
      windowsVirtualKeyCode: spec.vk,
      nativeVirtualKeyCode: spec.vk,
      modifiers,
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
    await new Promise((resolve) => setTimeout(resolve, 400))
  })

interface State {
  paths: (string | null)[]
  active: string | null
  panes: number
  composerFocused: boolean
  activeLeafIsChat: boolean
  files: string[]
  aborted: number
  cursor: number | null
}

const state = () =>
  evalJson<State>(`(() => {
  const chats = window.__abeleTest.ChatService.getInstance()
  const pathOf = (id) => chats.getSession(id)?.currentChatFile.value?.path ?? null
  const composer = window.__abeleTest.composer()
  const view = composer && window.__abeleTest.noteFieldView(composer.field)
  return {
    paths: chats.tabOrder.value.map(pathOf),
    active: pathOf(chats.activeTabId.value),
    panes: app.workspace.getLeavesOfType('abele-ai-sidebar-view').length,
    composerFocused: !!composer?.hasFocus(),
    activeLeafIsChat: app.workspace.activeLeaf?.view?.getViewType() === 'abele-ai-sidebar-view',
    files: ${JSON.stringify(CHATS)}.filter((p) => !!app.vault.getAbstractFileByPath(p)),
    aborted: window.__chatShortcuts?.aborted ?? 0,
    cursor: view ? view.state.selection.main.head : null,
  }
})()`)

/** Puts the cursor in the composer of the chat in front. */
const focusComposer = () =>
  evalLong(
    `(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const leaf = app.workspace.getLeavesOfType('abele-ai-sidebar-view')[0]
    app.workspace.setActiveLeaf(leaf, { focus: false })
    await wait(150)
    window.__abeleTest.composer().focus()
    await wait(200)
    return String(window.__abeleTest.composer().hasFocus())
  })()`,
    15_000
  )

const switchTo = (path: string) =>
  evalLong(
    `(async () => {
    const chats = window.__abeleTest.ChatService.getInstance()
    chats.switchTab(chats.getSessionByFile(${JSON.stringify(path)}).id)
    await new Promise((r) => setTimeout(r, 300))
    return 'switched'
  })()`,
    15_000
  )

describe.skipIf(!available)('the chat tab keys, pressed in the running app', () => {
  beforeAll(async () => {
    setBackgroundThrottling(false)
    setFocusEmulation(true)
    const answer = await evalLong(
      `(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const chats = window.__abeleTest.ChatService.getInstance()
      window.__chatShortcuts = {
        layout: app.workspace.getLayout(),
        tabsBefore: [...chats.tabOrder.value],
        aborted: 0,
      }
      await app.vault.create(${JSON.stringify(NOTE)}, 'A sample note to type in.')
      for (const [i, path] of ${JSON.stringify(CHATS)}.entries()) {
        const file = await app.vault.create(path, JSON.stringify({
          v: 2, k: 'meta', type: 'abele-chat', title: 'Sample shortcuts ' + i,
          providerId: '', modelId: '', created: '2020-01-01',
        }) + '\\n')
        await chats.openChatFile(file)
      }
      await chats.revealSidebar()
      await wait(500)
      return String(!!window.__abeleTest.composer())
    })()`,
      60_000
    )
    expect(answer).toBe('true')
  }, 90_000)

  afterAll(async () => {
    await evalLong(
      `(async () => {
      const state = window.__chatShortcuts
      if (!state) return 'nothing to restore'
      const chats = window.__abeleTest.ChatService.getInstance()
      for (const path of ${JSON.stringify(CHATS)}) {
        const session = chats.getSessionByFile(path)
        if (session) await chats.closeTab(session.id)
      }
      for (const id of [...chats.tabOrder.value])
        if (!state.tabsBefore.includes(id) && chats.tabOrder.value.length > 1) await chats.closeTab(id)
      await app.workspace.changeLayout(state.layout)
      for (const path of [...${JSON.stringify(CHATS)}, ${JSON.stringify(NOTE)}]) {
        const file = app.vault.getAbstractFileByPath(path)
        if (file) await app.vault.delete(file)
      }
      delete window.__chatShortcuts
      return 'restored'
    })()`,
      60_000
    )
    setFocusEmulation(false)
    setBackgroundThrottling(true)
  }, 90_000)

  it('switches tabs from the composer: Mod+Alt+arrows, Ctrl+Tab, Ctrl+Shift+Tab, Mod+Shift+]', async () => {
    await switchTo(CHATS[0])
    expect(await focusComposer()).toBe('true')
    await press(['Mod', 'Alt'], 'ArrowRight')
    expect(state().active).toBe(CHATS[1])
    await focusComposer()
    await press(['Ctrl'], 'Tab')
    expect(state().active).toBe(CHATS[2])
    await focusComposer()
    await press(['Mod', 'Alt'], 'ArrowLeft')
    expect(state().active).toBe(CHATS[1])
    await focusComposer()
    await press(['Ctrl', 'Shift'], 'Tab')
    expect(state().active).toBe(CHATS[0])
    await focusComposer()
    await press(['Mod', 'Shift'], ']')
    expect(state().active).toBe(CHATS[1])
    expect(state().panes).toBe(1)
  }, 60_000)

  it('goes to a tab by number, Mod+9 being the last', async () => {
    await focusComposer()
    const { paths } = state()
    await press(['Mod'], '9')
    expect(state().active).toBe(paths.at(-1))
    await focusComposer()
    await press(['Mod'], '1')
    expect(state().active).toBe(paths[0])
  }, 60_000)

  it('answers from the conversation too, with the cursor out of the composer', async () => {
    await switchTo(CHATS[0])
    await evalLong(
      `(async () => {
      const leaf = app.workspace.getLeavesOfType('abele-ai-sidebar-view')[0]
      document.activeElement?.blur?.()
      app.workspace.setActiveLeaf(leaf, { focus: true })
      await new Promise((r) => setTimeout(r, 300))
      return 'pane active'
    })()`,
      15_000
    )
    const before = state()
    expect(before.composerFocused).toBe(false)
    expect(before.activeLeafIsChat).toBe(true)
    await press(['Ctrl'], 'Tab')
    expect(state().active).toBe(CHATS[1])
  }, 60_000)

  it('closes the tab in front with Mod+W, keeping the chat and the pane, and Mod+Shift+T reopens it', async () => {
    await switchTo(CHATS[1])
    await focusComposer()
    await press(['Mod'], 'w')
    let now = state()
    expect(now.paths).not.toContain(CHATS[1])
    expect(now.panes).toBe(1)
    expect(now.files).toEqual(CHATS)

    await focusComposer()
    await press(['Mod', 'Shift'], 't')
    now = state()
    expect(now.paths).toContain(CHATS[1])
    expect(now.active).toBe(CHATS[1])
    expect(now.panes).toBe(1)
  }, 60_000)

  it('opens a new chat with Mod+T, the cursor in it', async () => {
    await focusComposer()
    const before = state().paths.length
    await press(['Mod'], 't')
    const now = state()
    expect(now.paths).toHaveLength(before + 1)
    expect(now.active).toBeNull()
    expect(now.composerFocused).toBe(true)
    // And Mod+W takes the new blank tab away again, not the pane.
    await press(['Mod'], 'w')
    expect(state().paths).toHaveLength(before)
    expect(state().panes).toBe(1)
  }, 60_000)

  it('leaves Alt+arrows to the composer, to move by word', async () => {
    await switchTo(CHATS[0])
    await evalLong(
      `(async () => {
      const composer = window.__abeleTest.composer()
      composer.focus()
      composer.set('several sample words')
      await new Promise((r) => setTimeout(r, 200))
      return 'typed'
    })()`,
      15_000
    )
    await press(['Alt'], 'ArrowLeft')
    const now = state()
    expect(now.active).toBe(CHATS[0])
    expect(now.cursor).toBe('several sample '.length)
    await evalLong(
      `(async () => { window.__abeleTest.composer().set(''); return 'cleared' })()`,
      15_000
    )
  }, 60_000)

  /** The chat in front's agent made to look busy, or idle; its stop is counted, not run. */
  const working = (on: boolean) =>
    evalLong(
      `(async () => {
      const session = window.__abeleTest.ChatService.getInstance().getSessionByFile(${JSON.stringify(CHATS[0])})
      session.isStreaming.value = ${on}
      await new Promise((r) => setTimeout(r, 200))
      return 'set'
    })()`,
      15_000
    )

  const stubAbort = () =>
    evalLong(
      `(async () => {
      const chats = window.__abeleTest.ChatService.getInstance()
      const session = chats.getSessionByFile(${JSON.stringify(CHATS[0])})
      window.__chatShortcuts.abort = session.abort
      session.abort = () => { window.__chatShortcuts.aborted++; session.isStreaming.value = false }
      return 'stubbed'
    })()`,
      15_000
    )

  const restoreAbort = () =>
    evalLong(
      `(async () => {
      const session = window.__abeleTest.ChatService.getInstance().getSessionByFile(${JSON.stringify(CHATS[0])})
      session.isStreaming.value = false
      session.abort = window.__chatShortcuts.abort
      window.getSelection()?.removeAllRanges()
      window.__abeleTest.composer().set('')
      return 'restored'
    })()`,
      15_000
    )

  // This case stopped the agent with Esc until the owner asked for Ctrl+C instead: the same
  // presses, the expectation turned round — Esc stops nothing now, Ctrl+C does.
  it('stops a working agent with Ctrl+C in the composer, and only then; Esc stops nothing', async () => {
    await switchTo(CHATS[0])
    await stubAbort()
    try {
      await focusComposer()
      await press(['Ctrl'], 'c')
      expect(state().aborted).toBe(0)

      await working(true)
      await focusComposer()
      await press([], 'Escape')
      expect(state().aborted).toBe(0)
      await focusComposer()
      await press(['Ctrl'], 'c')
      expect(state().aborted).toBe(1)

      // Cmd+C is copy on a Mac, never a stop.
      if (mac) {
        await working(true)
        await focusComposer()
        await press(['Mod'], 'c')
        expect(state().aborted).toBe(1)
      }
    } finally {
      await restoreAbort()
    }
  }, 60_000)

  it('copies rather than stops while text is selected in the composer', async () => {
    await switchTo(CHATS[0])
    await stubAbort()
    try {
      await working(true)
      await focusComposer()
      const selected = await evalLong(
        `(async () => {
        const composer = window.__abeleTest.composer()
        composer.set('several sample words')
        const view = window.__abeleTest.noteFieldView(composer.field)
        if (view) view.dispatch({ selection: { anchor: 0, head: 7 } })
        else composer.keyTarget.setSelectionRange(0, 7)
        composer.focus()
        await new Promise((r) => setTimeout(r, 200))
        return String(composer.hasFocus())
      })()`,
        15_000
      )
      expect(selected).toBe('true')
      await press(['Ctrl'], 'c')
      expect(state().aborted).toBe(0)
      // The selection let go, the same key stops.
      await evalLong(
        `(async () => {
        const composer = window.__abeleTest.composer()
        const view = window.__abeleTest.noteFieldView(composer.field)
        if (view) view.dispatch({ selection: { anchor: 7 } })
        else composer.keyTarget.setSelectionRange(7, 7)
        await new Promise((r) => setTimeout(r, 200))
        return 'collapsed'
      })()`,
        15_000
      )
      await press(['Ctrl'], 'c')
      expect(state().aborted).toBe(1)
    } finally {
      await restoreAbort()
    }
  }, 60_000)

  it('stops from the conversation too, and copies there while text is selected', async () => {
    await switchTo(CHATS[0])
    await stubAbort()
    /** The cursor on the conversation, out of the composer, with its words selected or not. */
    const onConversation = (select: boolean) =>
      evalLong(
        `(async () => {
        const leaf = app.workspace.getLeavesOfType('abele-ai-sidebar-view')[0]
        document.activeElement?.blur?.()
        app.workspace.setActiveLeaf(leaf, { focus: true })
        await new Promise((r) => setTimeout(r, 300))
        const selection = window.getSelection()
        selection.removeAllRanges()
        if (${select}) {
          const label = leaf.view.containerEl.querySelector('.abele-chat-tabs__label')
          const range = document.createRange()
          range.selectNodeContents(label)
          selection.addRange(range)
        }
        return String(!window.__abeleTest.composer().hasFocus() && app.workspace.activeLeaf === leaf)
      })()`,
        15_000
      )
    try {
      await working(true)
      expect(await onConversation(true)).toBe('true')
      await press(['Ctrl'], 'c')
      expect(state().aborted).toBe(0)
      expect(await onConversation(false)).toBe('true')
      await press(['Ctrl'], 'c')
      expect(state().aborted).toBe(1)
    } finally {
      await restoreAbort()
    }
  }, 60_000)

  it('leaves the keys to Obsidian once the cursor is in a note', async () => {
    await switchTo(CHATS[0])
    const answer = await evalLong(
      `(async () => {
      const leaf = app.workspace.getLeaf('tab')
      await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))
      app.workspace.setActiveLeaf(leaf, { focus: true })
      leaf.view.editor?.focus()
      await new Promise((r) => setTimeout(r, 300))
      window.__chatShortcuts.noteLeaf = leaf
      return app.workspace.activeLeaf === leaf ? 'note' : 'elsewhere'
    })()`,
      15_000
    )
    expect(answer).toBe('note')
    await press(['Mod', 'Alt'], 'ArrowRight')
    expect(state().active).toBe(CHATS[0])
    // Obsidian's own Mod+W closes the note's tab, as it always has.
    await press(['Mod'], 'w')
    expect(
      evalJson<boolean>(
        `app.workspace.getLeavesOfType('markdown').some((l) => l.view.file?.path === ${JSON.stringify(NOTE)})`
      )
    ).toBe(false)
    expect(state().panes).toBe(1)
    expect(state().paths).toContain(CHATS[0])
  }, 60_000)
})
