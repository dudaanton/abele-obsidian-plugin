import { afterEach, describe, expect, it } from 'vitest'
import { compile } from 'sass-embedded'
import { resolve } from 'node:path'

const css = compile(resolve(__dirname, '../../src/styles/chatMessage/body.scss')).css

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

function conversation(rows: string[]) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  const list = document.createElement('div')
  list.className = 'abele-ai-chat__messages'
  list.style.cssText = '--size-4-3: 12px; --size-4-4: 16px; --size-4-8: 32px; --size-2-2: 4px'
  for (const row of rows) {
    const message = document.createElement('div')
    if (row === 'run') {
      message.className = 'abele-chat-run'
      message.textContent = 'Working'
    } else {
      const role = row === 'question' ? 'user' : 'assistant'
      message.className = `abele-chat-msg abele-chat-msg_${role}`
      const body = document.createElement('div')
      body.className = 'abele-chat-msg__body'
      if (row !== 'empty') {
        const paragraph = document.createElement('p')
        paragraph.textContent = row
        body.append(paragraph)
      }
      message.append(body)
    }
    list.append(message)
  }
  document.body.append(list)
  return [...list.children] as HTMLElement[]
}

const margin = (row: HTMLElement) => getComputedStyle(row).marginTop

describe('chat conversation spacing', () => {
  it('keeps a question close to its first run or answer', () => {
    expect(margin(conversation(['question', 'run'])[1])).toBe('0px')
    expect(margin(conversation(['question', 'answer'])[1])).toBe('0px')
  })

  it('joins runs directly and across empty assistant rows', () => {
    const rows = conversation(['run', 'run', 'empty', 'run'])
    expect(rows.slice(1).map(margin)).toEqual(['0px', '0px', '0px'])
  })

  it('preserves the close step from a run to answer text', () => {
    expect(margin(conversation(['run', 'answer'])[1])).toBe('4px')
  })

  it('leaves one theme step before the next question', () => {
    for (const previous of ['answer', 'run', 'question', 'empty']) {
      expect(margin(conversation([previous, 'question'])[1])).toBe('16px')
    }
  })

  it('keeps the first streamed words anchored after a question', () => {
    const rows = conversation(['question', 'empty'])
    expect(margin(rows[1])).toBe('0px')
    const paragraph = document.createElement('p')
    paragraph.textContent = 'First words'
    rows[1].firstElementChild!.append(paragraph)
    expect(margin(rows[1])).toBe('0px')
  })
})
