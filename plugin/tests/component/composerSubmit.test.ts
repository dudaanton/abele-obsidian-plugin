import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import AiChatInput from '@/components/AiChatInput.vue'
import { embeddedViews, resetEmbeddedEditorCache } from '@/editor/embeddedEditor'
import { useVault } from '../helpers/testEnv'

// Obsidian's scope handler runs on window capture, before the component's listener.
vi.mock('obsidian', async (original) => {
  const api = await original<Record<string, unknown>>()
  return {
    ...api,
    Scope: class Scope {
      bindings: { modifiers: string[]; key: string; handler: () => unknown }[] = []
      constructor(public parent?: Scope) {}
      register(modifiers: string[], key: string, handler: () => unknown) {
        const binding = { modifiers, key, handler }
        this.bindings.push(binding)
        return binding
      }
      unregister(binding: Scope['bindings'][number]) {
        this.bindings = this.bindings.filter((b) => b !== binding)
      }
      handle(event: KeyboardEvent): unknown {
        const binding = this.bindings.find(
          (b) =>
            b.key === event.key && b.modifiers.includes('Mod') && (event.metaKey || event.ctrlKey)
        )
        // An explicit binding returning undefined stops the parent chain, not the DOM event.
        if (binding) return binding.handler()
        return this.parent?.handle(event)
      }
    },
  }
})

import { Scope } from 'obsidian'

type TestScope = Scope & { handle(event: KeyboardEvent): unknown }
let cleanup: () => void

beforeEach(() => {
  resetEmbeddedEditorCache()
  document.body.replaceChildren()
})

afterEach(() => {
  cleanup?.()
  resetEmbeddedEditorCache()
  vi.unstubAllGlobals()
})

function setup(busy = false, suggesting = false) {
  const app = useVault([])
  const follow = vi.fn()
  const root = new Scope() as TestScope
  root.register(['Mod'], 'Enter', () => {
    follow()
    return false
  })
  const suggestionScope = new Scope(root) as TestScope
  let active = root
  const appKeymap = {
    pushScope: (scope: TestScope) => {
      active = scope
    },
    popScope: () => {
      active = root
    },
  }
  const obsidianCapture = (event: KeyboardEvent) => {
    if (active.handle(event) === false) event.preventDefault()
  }
  window.addEventListener('keydown', obsidianCapture, true)
  Object.assign(app, {
    scope: root,
    keymap: appKeymap,
    workspace: {
      on: () => ({}),
      offref: () => {},
      editorSuggest: { suggests: [{ scope: suggestionScope }] },
    },
  })

  class NoteEditor {
    scope = new Scope(root)
    editorEl: HTMLElement
    editor: { cm: EditorView; focus: () => void }
    constructor(
      _app: unknown,
      host: HTMLElement,
      public owner: unknown
    ) {
      this.editorEl = host
      const cm = new EditorView({
        parent: host,
        state: EditorState.create({
          extensions: [
            this.buildLocalExtensions(),
            EditorView.updateListener.of((update) => this.onUpdate(update, update.docChanged)),
          ],
        }),
      })
      this.editor = { cm, focus: () => cm.focus() }
    }
    buildLocalExtensions() {
      return [keymap.of(defaultKeymap)]
    }
    onUpdate(_update: unknown, _changed: boolean) {}
    set(value: string) {
      this.editor.cm.dispatch({
        changes: { from: 0, to: this.editor.cm.state.doc.length, insert: value },
      })
    }
    get() {
      return this.editor.cm.state.doc.toString()
    }
    destroy() {
      this.editor.cm.destroy()
    }
  }
  class EmbedEditor extends NoteEditor {}
  Object.assign(app, {
    embedRegistry: {
      embedByExtension: {
        md: () => ({
          showEditor() {},
          editMode: Object.create(EmbedEditor.prototype),
          unload() {},
        }),
      },
    },
  })
  vi.stubGlobal('activeWindow', { createDiv: () => document.createElement('div') })
  const wrapper = mount(AiChatInput, {
    attachTo: document.body,
    shallow: true,
    props: {
      isStreaming: false,
      isBusy: busy,
      canContinue: false,
      tokenDisplay: '',
      scopeLabel: '',
    },
  })
  cleanup = () => {
    wrapper.unmount()
    window.removeEventListener('keydown', obsidianCapture, true)
  }
  const composer = wrapper.vm as unknown as { setText(value: string): void; focus(): void }
  composer.setText('See [[sample-note]]')
  composer.focus()
  const field = wrapper.get('.abele-chat-input__field').element as HTMLElement
  const view = embeddedViews.get(field)
  expect(view).toBeDefined()
  view!.dispatch({ selection: { anchor: 10 } })
  if (suggesting) active = suggestionScope
  const target = view?.contentDOM ?? field
  return { wrapper, follow, target, view, suggestionScope }
}

describe('composer submit before Obsidian follows a link', () => {
  it.each(['metaKey', 'ctrlKey'] as const)(
    'sends once without following the link with %s',
    (modifier) => {
      const { wrapper, follow, target } = setup()
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        })
      )
      expect(follow).not.toHaveBeenCalled()
      expect(wrapper.emitted('send')).toEqual([['See [[sample-note]]', []]])
    }
  )

  it('does not follow a link even when sending is blocked', () => {
    const { wrapper, follow, target } = setup(true, true)
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })
    )
    expect(follow).not.toHaveBeenCalled()
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('sends without following a link when the link suggester owns the active scope', () => {
    const { wrapper, follow, target } = setup(false, true)
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })
    )
    expect(follow).not.toHaveBeenCalled()
    expect(wrapper.emitted('send')).toEqual([['See [[sample-note]]', []]])
  })

  it('removes the suggester shortcut when the composer loses focus', () => {
    const { wrapper, follow, target, suggestionScope } = setup(false, true)
    expect(suggestionScope.bindings).toHaveLength(1)
    target.blur()
    expect(suggestionScope.bindings).toHaveLength(0)
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })
    )
    expect(follow).toHaveBeenCalledOnce()
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('leaves Enter as a newline and Shift+Enter as send', () => {
    const { wrapper, target, view } = setup()
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )
    expect(wrapper.emitted('send')).toBeUndefined()
    expect(view!.state.doc.toString()).toBe('See [[samp\nle-note]]')
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    )
    expect(wrapper.emitted('send')).toEqual([['See [[samp\nle-note]]', []]])
  })
})
