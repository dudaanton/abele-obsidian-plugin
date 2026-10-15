import { afterEach, describe, expect, it } from 'vitest'
import { keyboardReady } from '../e2e/helpers/keyboardReady'

/** The phone's typing into an input: the first `deaf` calls are lost, as on a keyboard not ready. */
const keyboardInto = (input: HTMLInputElement, deaf: number) => {
  const calls: string[] = []
  const type = async (text: string) => {
    calls.push(text)
    if (calls.length <= deaf) return
    for (const ch of text) {
      const at = input.selectionStart ?? input.value.length
      const to = input.selectionEnd ?? at
      if (ch === '\b') {
        const from = at === to ? Math.max(0, at - 1) : at
        input.value = input.value.slice(0, from) + input.value.slice(to)
        input.setSelectionRange(from, from)
      } else {
        input.value = input.value.slice(0, at) + ch + input.value.slice(to)
        input.setSelectionRange(at + 1, at + 1)
      }
    }
  }
  return { calls, type }
}

const field = (value: string) => {
  const input = document.createElement('input')
  input.value = value
  document.body.append(input)
  input.focus()
  input.setSelectionRange(value.length, value.length)
  document.body.style.setProperty('--keyboard-height', '300px')
  return input
}

afterEach(() => {
  document.body.replaceChildren()
  document.body.removeAttribute('style')
})

describe('keyboardReady', () => {
  it('probes until the keyboard takes input, then leaves the field as it was', async () => {
    const input = field('Sample')
    const { calls, type } = keyboardInto(input, 2)
    await keyboardReady(type, 10_000, (n) => void type('\b'.repeat(n)))
    expect(input.value).toBe('Sample')
    expect(calls).toEqual(['x', 'x', 'x', 'x', '\b\b'])
    await type(' diagram')
    expect(input.value).toBe('Sample diagram')
  }, 15_000)

  it('leaves a selection for the text to replace, probing nothing', async () => {
    const input = field('old name')
    input.setSelectionRange(0, 3)
    const { calls, type } = keyboardInto(input, 0)
    await keyboardReady(type, 5_000, (n) => void type('\b'.repeat(n)))
    expect(calls).toEqual([])
    expect([input.value, input.selectionStart, input.selectionEnd]).toEqual(['old name', 0, 3])
  })

  it('wants two probes in a row: one lost after a delivered one starts the count again', async () => {
    const input = field('')
    const calls: string[] = []
    const type = async (text: string) => {
      calls.push(text)
      if (calls.length === 2) return
      input.value += text
    }
    await keyboardReady(type, 10_000, (n) => void (input.value = input.value.slice(0, -n)))
    expect(calls).toEqual(['x', 'x', 'x', 'x'])
    expect(input.value).toBe('')
  }, 15_000)

  it('reads an editor field without its placeholder', async () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    const placeholder = () => {
      const span = document.createElement('span')
      span.className = 'cm-placeholder'
      span.textContent = 'Write a reply'
      editor.replaceChildren(span)
    }
    placeholder()
    document.body.append(editor)
    editor.focus()
    document.body.style.setProperty('--keyboard-height', '300px')
    const calls: string[] = []
    const type = async (text: string) => {
      calls.push(text)
      for (const ch of text) {
        const now = editor.querySelector('.cm-placeholder') ? '' : (editor.textContent ?? '')
        editor.textContent = ch === '\b' ? now.slice(0, -1) : now + ch
        if (!editor.textContent) placeholder()
      }
    }
    await keyboardReady(type, 5_000, (n) => void type('\b'.repeat(n)))
    expect(calls).toEqual(['x', 'x', '\b\b'])
    expect(editor.querySelector('.cm-placeholder')).not.toBeNull()
  })

  it('fails with what it saw when nothing is focused', async () => {
    const type = async () => {}
    await expect(keyboardReady(type, 400)).rejects.toThrow(/No focused field/)
  })

  it('fails instead of letting a deaf keyboard swallow the text', async () => {
    const input = field('')
    const { type } = keyboardInto(input, Infinity)
    await expect(keyboardReady(type, 2_000, () => {})).rejects.toThrow(/took no input/)
  })

  it('runs from its own source alone, as the page receives it', async () => {
    const input = field('')
    const { type } = keyboardInto(input, 1)
    const injected = new Function(`return ${keyboardReady.toString()}`)() as typeof keyboardReady
    await injected(type, 5_000, (n) => void type('\b'.repeat(n)))
    expect(input.value).toBe('')
  })
})
