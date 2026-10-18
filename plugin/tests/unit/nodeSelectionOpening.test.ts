import { expect, it, vi } from 'vitest'
import { openNodeChat } from '@/node/nodePathNavigation'

const f = vi.hoisted(() => ({
  draft: { value: { text: '' } },
  open: vi.fn(),
  refresh: vi.fn(async () => {}),
  reveal: vi.fn(async () => {}),
}))
vi.mock('@/ai/ChatService', () => ({
  ChatService: {
    getInstance: () => ({
      openNodeSession: f.open,
      getNodeSession: () => ({ draft: f.draft, refresh: f.refresh }),
      revealSidebar: f.reveal,
    }),
  },
}))

it('shows the selected code draft while the remote session is still loading', async () => {
  let loaded!: () => void
  f.refresh.mockImplementationOnce(async () => {
    await Promise.resolve()
    f.draft.value.text = 'Saved sample draft'
  })
  f.open.mockReturnValue(
    new Promise<void>((resolve) => {
      loaded = resolve
    })
  )
  const opening = openNodeChat(
    {
      kind: 'chat',
      sessionId: 'sample-session',
      title: 'Sample chat',
      target: {
        registrationId: 'sample-registration',
        nodeId: 'sample-node',
        projectId: 'sample-project',
        kind: 'worktree',
        id: 'sample-tree',
      },
    },
    'Selected sample code'
  )
  try {
    await vi.waitFor(() => expect(f.reveal).toHaveBeenCalled())
    expect(f.draft.value.text).toBe('Saved sample draft\n\nSelected sample code')
  } finally {
    loaded()
    await opening
  }
})
