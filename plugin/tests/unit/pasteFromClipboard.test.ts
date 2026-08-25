/**
 * Pasting the clipboard at the cursor.
 *
 * The clipboard is the part of this that can refuse: reading it needs the window focused and
 * permitted, and `readText()` rejects when it is not. The command is registered as an
 * `editorCallback`, so a rejection had nowhere to go — it surfaced as an unhandled rejection,
 * and the user saw nothing happen and was told nothing.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Editor } from 'obsidian'
import { pasteFromClipboard } from '@/commands/pasteFromClipboard'

let readText: () => Promise<string>

/** An editor holding one line, with a movable cursor and a record of what was written. */
function editorWith(ch: number) {
  let cursor = { line: 0, ch }
  const written: Array<{ text: string; at: { line: number; ch: number } }> = []

  const editor = {
    getCursor: () => cursor,
    setCursor: (pos: { line: number; ch: number }) => {
      cursor = pos
    },
    replaceRange: (text: string, at: { line: number; ch: number }) => {
      written.push({ text, at })
    },
  } as unknown as Editor

  return { editor, written, cursorNow: () => cursor }
}

beforeEach(() => {
  readText = () => Promise.resolve('')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { readText: () => readText() } },
  })
})

describe('pasting the clipboard at the cursor', () => {
  it('writes the clipboard text where the cursor is', async () => {
    readText = () => Promise.resolve('hello')
    const { editor, written } = editorWith(1)

    await pasteFromClipboard(editor)

    expect(written).toEqual([{ text: 'hello', at: { line: 0, ch: 1 } }])
  })

  it('leaves the cursor after what it pasted', async () => {
    readText = () => Promise.resolve('hello')
    const { editor, cursorNow } = editorWith(1)

    await pasteFromClipboard(editor)

    expect(cursorNow()).toEqual({ line: 0, ch: 6 })
  })

  it('writes nothing when the clipboard holds no text', async () => {
    readText = () => Promise.resolve('')
    const { editor, written } = editorWith(1)

    await pasteFromClipboard(editor)

    expect(written).toEqual([])
  })

  it('writes nothing when there is no editor', async () => {
    readText = () => Promise.resolve('hello')

    await expect(pasteFromClipboard(undefined as unknown as Editor)).resolves.toBeUndefined()
  })
})

describe('when the clipboard refuses to be read', () => {
  beforeEach(() => {
    readText = () => Promise.reject(new Error('Read permission denied.'))
  })

  it('settles instead of rejecting, so the command callback has nothing to swallow', async () => {
    const { editor } = editorWith(1)

    await expect(pasteFromClipboard(editor)).resolves.toBeUndefined()
  })

  it('leaves the document and the cursor untouched', async () => {
    const { editor, written, cursorNow } = editorWith(2)

    await pasteFromClipboard(editor)

    expect(written).toEqual([])
    expect(cursorNow()).toEqual({ line: 0, ch: 2 })
  })
})
