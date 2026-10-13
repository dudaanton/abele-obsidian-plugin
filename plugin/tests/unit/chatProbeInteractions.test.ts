import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import {
  dismissNativeDialog,
  expandFirstOutlineQuestion,
  openChatSetup,
  waitForUiMatch,
} from '../helpers/chatProbeInteractions'

it('executes the browser outline-opening step for a child question', async () => {
  const source = readFileSync('tests/e2e/chatNavigation.e2e.test.ts', 'utf8')
  const start = source.indexOf('    await until(modal)')
  const end = source.indexOf('\n  }\n  const choose', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  const step = source
    .slice(start, end)
    .replace('${expandFirstOutlineQuestion.toString()}', expandFirstOutlineQuestion.toString())
  const root = document.createElement('div')
  const question = document.createElement('div')
  question.dataset.question = 'sample-child-question'
  question.className = 'is-collapsed'
  const row = document.createElement('div')
  row.className = 'tree-item-self'
  const toggle = document.createElement('div')
  toggle.className = 'collapse-icon'
  toggle.addEventListener('click', () => question.classList.remove('is-collapsed'))
  row.append(toggle)
  question.append(row)
  root.append(question)
  await runInNewContext(`(async () => {${step}\n})()`, {
    until: async () => true,
    wait: async () => {},
    modal: () => root,
  })
  expect(question.classList.contains('is-collapsed')).toBe(false)
})

it('returns the matched menu element so callers can activate it', async () => {
  const item = document.createElement('div')
  const click = vi.fn()
  item.addEventListener('click', click)
  const match = await waitForUiMatch(
    () => item,
    async () => {},
    1000
  )
  expect(match).toBe(item)
  if (match) match.click()
  expect(click).toHaveBeenCalledOnce()
})

it('opens setup through the accepted header overflow entry', async () => {
  const chat = document.createElement('div')
  const button = document.createElement('button')
  button.setAttribute('aria-label', 'More chat actions')
  const item = document.createElement('div')
  item.className = 'menu-item'
  const title = document.createElement('span')
  title.className = 'menu-item-title'
  title.textContent = 'Access, tools and chat settings'
  item.append(title)
  chat.append(button, item)
  document.body.append(chat)
  const more = vi.fn(),
    setup = vi.fn()
  chat.querySelector('button')!.addEventListener('click', more)
  chat.querySelector('.menu-item')!.addEventListener('click', setup)
  try {
    await openChatSetup(chat, async (find) => !!find())
    expect(more).toHaveBeenCalledOnce()
    expect(setup).toHaveBeenCalledOnce()
  } finally {
    chat.remove()
  }
})

it('dismisses a native dialog through Escape without assuming close-button markup', () => {
  const root = document.createElement('div')
  const listener = vi.fn()
  document.body.addEventListener('keydown', listener)
  try {
    dismissNativeDialog(root)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0]).toMatchObject({
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
    })
  } finally {
    document.body.removeEventListener('keydown', listener)
  }
})
