/**
 * The short questions asked from code that is not a component — which copy of a chat to open,
 * what to do with a discussion's chat, whether an agent may use a GitHub connection or read a
 * node's project — each a kit dialog with its text, its buttons in order and its answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { closeComponentDialogs } from '@/modal/componentDialog'
import { chooseAnchorSource } from '@/ai/openChat'
import { askWhatToRemove } from '@/reader/bookDiscussions'
import { connectionApproval } from '@/github/approveConnection'
import { repositoryReadApproval } from '@/node/repositoryReadApproval'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
afterEach(() => {
  closeComponentDialogs()
  document.body.replaceChildren()
})

const modal = () => document.querySelector<HTMLElement>('.modal.abele-modal')!
const buttons = () =>
  [...modal().querySelectorAll<HTMLButtonElement>('button')].map((b) => b.textContent?.trim())
const press = (text: string) =>
  [...modal().querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => b.textContent?.trim() === text)!
    .click()
const body = () => modal().querySelector('.abele-modal__body')!.textContent!

describe('chooseAnchorSource', () => {
  it('lists every copy and opens only the one picked', async () => {
    const answer = chooseAnchorSource(['Chats/sample-a.md', 'Archive/sample-a.md'])
    await flushPromises()
    expect(body()).toContain('Several copies of this conversation have the same identity.')
    expect(buttons()).toEqual(['Chats/sample-a.md', 'Archive/sample-a.md', 'Cancel'])
    press('Archive/sample-a.md')
    await expect(answer).resolves.toBe('Archive/sample-a.md')
  })

  it('selects none when cancelled', async () => {
    const answer = chooseAnchorSource(['Chats/sample-a.md'])
    await flushPromises()
    press('Cancel')
    await expect(answer).resolves.toBeNull()
  })
})

describe('askWhatToRemove', () => {
  const highlight = { text: 'w'.repeat(130) } as never

  it('quotes the words, cut to 120 characters, and keeps or deletes the chat', async () => {
    for (const [text, value] of [
      ['Keep the chat', 'keep'],
      ['Delete the chat too', 'delete'],
      ['Cancel', null],
    ] as const) {
      const answer = askWhatToRemove(highlight)
      await flushPromises()
      expect(modal().querySelector('.modal-title, .abele-modal__body')).not.toBeNull()
      expect(body()).toContain(`“${'w'.repeat(120)}…”`)
      expect(body()).toContain('The words stop being marked.')
      expect(buttons()).toEqual(['Keep the chat', 'Delete the chat too', 'Cancel'])
      expect(modal().querySelector('.mod-cta')?.textContent?.trim()).toBe('Keep the chat')
      expect(modal().querySelector('.mod-warning')?.textContent?.trim()).toBe('Delete the chat too')
      press(text)
      await expect(answer).resolves.toBe(value)
    }
  })
})

describe('connectionApproval', () => {
  const connection = {
    id: 'sample',
    name: 'Sample connection',
    server: '',
    account: { login: 'sample-account' },
  } as never

  it('names the connection and allows this operation only on its button', async () => {
    const answer = connectionApproval()(connection)
    await flushPromises()
    expect(body()).toContain(
      'Allow this agent operation to use Sample connection on github.com as sample-account?'
    )
    expect(buttons()).toEqual(['Cancel', 'Allow once'])
    press('Allow once')
    await expect(answer).resolves.toBe(true)
  })

  it('is refused by Cancel, by an aborted signal, and before opening for an aborted one', async () => {
    const cancelled = connectionApproval()(connection)
    await flushPromises()
    press('Cancel')
    await expect(cancelled).resolves.toBe(false)
    const controller = new AbortController()
    const aborted = connectionApproval()(connection, controller.signal)
    await flushPromises()
    controller.abort()
    await expect(aborted).resolves.toBe(false)
    expect(document.querySelector('.modal.abele-modal')).toBeNull()
    await expect(connectionApproval()(connection, controller.signal)).resolves.toBe(false)
    expect(document.querySelector('.modal.abele-modal')).toBeNull()
  })
})

describe('repositoryReadApproval', () => {
  const target = { project: 'sample-project', node: 'sample-node', installation: 'sample-1' }

  it('names the project and allows the chat only on its button', async () => {
    const answer = repositoryReadApproval()(target as never)
    await flushPromises()
    expect(body()).toContain(
      'Allow this chat to read project sample-project on node sample-node (installation sample-1)'
    )
    expect(buttons()).toEqual(['Cancel', 'Allow this chat'])
    expect(modal().querySelector('.mod-cta')?.textContent?.trim()).toBe('Allow this chat')
    press('Allow this chat')
    await expect(answer).resolves.toBe(true)
  })

  it('is refused by Cancel', async () => {
    const answer = repositoryReadApproval()(target as never)
    await flushPromises()
    press('Cancel')
    await expect(answer).resolves.toBe(false)
  })
})
