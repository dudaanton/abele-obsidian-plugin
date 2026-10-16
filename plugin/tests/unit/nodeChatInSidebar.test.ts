/**
 * A node chat opens where every chat lives: a tab of the sidebar chat, never a pane in the
 * middle; a quote given with it goes into its draft once the chat has loaded, never sent.
 */
import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { openNodeChat } from '@/node/nodePathNavigation'

const f = vi.hoisted(() => ({
  draft: undefined as unknown as { value: { text: string } },
  opened: [] as unknown[],
  reveal: vi.fn(async () => {}),
}))
vi.mock('@/ai/ChatService', () => ({
  ChatService: {
    getInstance: () => ({
      async openNodeSession(reference: unknown) {
        f.opened.push(reference)
        // Loading restores the chat's own saved draft first.
        await Promise.resolve()
        f.draft.value.text = 'Saved draft'
      },
      getNodeSession: (id: string) =>
        id === 'node:sample-registration:sample-session' ? { draft: f.draft } : null,
      revealSidebar: f.reveal,
    }),
  },
}))

it('opens a node chat as a sidebar chat tab and adds a quote to its restored draft', async () => {
  f.draft = ref({ text: '' })
  const target = {
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-worktree',
  }
  await openNodeChat(
    { kind: 'chat', target, sessionId: 'sample-session', title: 'Sample chat' },
    'Quoted sample'
  )
  expect(f.opened).toEqual([
    {
      kind: 'node-session',
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      sessionId: 'sample-session',
      title: 'Sample chat',
    },
  ])
  expect(f.draft.value.text).toBe('Saved draft\n\nQuoted sample')
  expect(f.reveal).toHaveBeenCalled()
})
