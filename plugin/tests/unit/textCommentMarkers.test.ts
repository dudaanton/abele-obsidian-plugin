import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { editorInfoField, editorLivePreviewField } from 'obsidian'
import {
  commentExtensions,
  commentStateField,
  setCommentInfoSource,
  setTextCommentInfoSource,
  setTextCommentClickHandler,
  setCommentClickHandler,
} from '@/editor/CommentPlugin'

const silent = { get: () => undefined, touch: () => {} }
afterEach(() => {
  setCommentInfoSource(silent)
  setTextCommentInfoSource(silent)
})
describe('mixed human and AI note markers', () => {
  it('uses the AI quote and busy state independently when a human id comes first', () => {
    setCommentInfoSource({
      get: (id) =>
        id === 'aaaaaa' ? { quote: 'words', state: 'busy', open: false, messages: 1 } : undefined,
      touch() {},
    })
    setTextCommentInfoSource({
      get: (id) =>
        id === 'bbbbbb'
          ? {
              kind: 'human',
              quote: 'long words',
              appearance: 'pink',
              state: 'error',
              open: false,
              messages: 2,
            }
          : undefined,
      touch() {},
    })
    const state = EditorState.create({
      doc: 'long words%%c:bbbbbb,aaaaaa%%',
      extensions: [
        editorInfoField.init(() => ({ file: { path: 'sample.md' } })),
        editorLivePreviewField.init(() => true),
        commentExtensions,
      ],
    })
    const ai: { from: number; to: number; busy: boolean }[] = []
    state.field(commentStateField).between(0, state.doc.length, (from, to, deco) => {
      if (deco.spec.class?.startsWith('abele-comment__quote'))
        ai.push({ from, to, busy: deco.spec.class.includes('_busy') })
    })
    expect(ai).toEqual([{ from: 5, to: 10, busy: true }])
  })
  it('keeps separate icons, counts and click targets, and paints human appearance', () => {
    const humanClick = vi.fn(),
      aiClick = vi.fn()
    setCommentClickHandler(aiClick)
    setTextCommentClickHandler(humanClick)
    setCommentInfoSource({
      get: (id) =>
        id === 'aaaaaa' ? { quote: 'words', state: 'busy', open: false, messages: 7 } : undefined,
      touch() {},
    })
    setTextCommentInfoSource({
      get: (id) =>
        id === 'bbbbbb'
          ? {
              kind: 'human',
              quote: 'words',
              appearance: 'pink',
              state: 'idle',
              open: false,
              messages: 2,
            }
          : undefined,
      touch() {},
    })
    const state = EditorState.create({
      doc: 'words%%c:aaaaaa,bbbbbb%%',
      extensions: [
        editorInfoField.init(() => ({ file: { path: 'sample.md' } })),
        editorLivePreviewField.init(() => true),
        commentExtensions,
      ],
    })
    const classes: string[] = []
    let icon: HTMLElement | undefined
    state.field(commentStateField).between(0, state.doc.length, (_from, _to, deco) => {
      if (deco.spec.class) classes.push(deco.spec.class)
      if (deco.spec.widget) icon = deco.spec.widget.toDOM()
    })
    expect(classes.join(' ')).toContain('abele-highlight--pink')
    const human = icon!.querySelector<HTMLElement>('[data-comment-kind="human"]')!
    const ai = icon!.querySelector<HTMLElement>('[data-comment-kind="ai"]')!
    expect(human.textContent).toBe('2')
    expect(ai.textContent).toBe('7')
    expect(human.getAttribute('role')).toBe('button')
    expect(human.tabIndex).toBe(0)
    human.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    ai.click()
    expect(humanClick).toHaveBeenCalledWith(['bbbbbb'])
    expect(aiClick).toHaveBeenCalledWith(['aaaaaa'])
  })
  it('keeps missing quotes accessible as unresolved human point markers', () => {
    setTextCommentInfoSource({
      get: () => ({
        kind: 'human',
        quote: 'gone',
        appearance: 'underline',
        state: 'idle',
        open: false,
        messages: 1,
      }),
      touch() {},
    })
    const state = EditorState.create({
      doc: 'changed%%c:bbbbbb%%',
      extensions: [
        editorInfoField.init(() => ({ file: { path: 'sample.md' } })),
        editorLivePreviewField.init(() => true),
        commentExtensions,
      ],
    })
    let icon: HTMLElement | undefined
    state.field(commentStateField).between(0, state.doc.length, (_a, _b, deco) => {
      if (deco.spec.widget) icon = deco.spec.widget.toDOM()
    })
    expect(icon!.querySelector('.abele-comment-marker_orphan')).not.toBeNull()
    expect(icon!.querySelector('[aria-label]')!.getAttribute('aria-label')).toContain('unresolved')
  })
})
