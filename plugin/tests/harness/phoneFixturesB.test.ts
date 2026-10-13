import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'

const source = (name: string) => readFileSync(`tests/e2e/${name}.e2e.test.ts`, 'utf8')

it('gives reader and slide scripts exact-source fixture authority and restores it', () => {
  for (const name of ['bookLibraryScript', 'slidesLive']) {
    const code = source(name)
    for (const action of [
      'saveScriptFixture()',
      'enableScriptFixture(',
      'approveScriptFixture(',
      'restoreScriptFixture(',
    ])
      expect(code).toContain(action)
  }
})

it('uses the current settings, run and comment actions', () => {
  expect(source('modelTimeout')).toContain("t.textContent.trim() === 'Models'")
  expect(source('stopping')).toContain('[aria-label="Stop this run"]')
  expect(source('textComments')).toContain('[aria-label="Send (⌘↵)"]')
  expect(source('textComments')).not.toContain("button('Close')")
  expect(source('textComments')).not.toContain("querySelector('.abele-text-comments select')")
})

it('distinguishes a stopped ZIP call from a tool result', () => {
  expect(source('zip')).toContain('expect(failed.result).toBeUndefined()')
})

it('targets the composer glyph and its own native close control in the DOM', () => {
  const code = source('textComments')
  const actions = code.slice(code.indexOf('  const send ='), code.indexOf('  const note ='))
  const { send, dismiss } = new Function('document', `${actions};return {send,dismiss}`)(document)
  const root = document.createElement('div')
  const unrelatedButton = document.createElement('button')
  unrelatedButton.textContent = 'Close'
  const modal = document.createElement('div')
  modal.className = 'modal'
  const closeButton = document.createElement('button')
  closeButton.className = 'modal-close-button'
  const panel = document.createElement('div')
  panel.className = 'abele-text-comments'
  const sendButton = document.createElement('button')
  sendButton.setAttribute('aria-label', 'Send (⌘↵)')
  panel.append(sendButton)
  modal.append(closeButton, panel)
  root.append(unrelatedButton, modal)
  document.body.append(root)
  const close = vi.fn(),
    unrelated = vi.fn()
  root.querySelector('.modal-close-button')!.addEventListener('click', close)
  root.querySelector('button')!.addEventListener('click', unrelated)
  try {
    expect(send()).toBe(root.querySelector('[aria-label="Send (⌘↵)"]'))
    dismiss()
    expect(close).toHaveBeenCalledOnce()
    expect(unrelated).not.toHaveBeenCalled()
  } finally {
    root.remove()
  }
})
