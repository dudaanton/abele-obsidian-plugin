import { expect, it, vi } from 'vitest'
import { openNodeChat, openNodePathTab } from '@/node/nodePathNavigation'

const f = vi.hoisted(() => ({
  available: true,
  draft: { value: { text: '' } },
  open: vi.fn(),
  refresh: vi.fn(async () => {}),
  reveal: vi.fn(async () => {}),
}))
vi.mock('@/ai/ChatService', () => ({
  ChatService: {
    getInstance: () => ({
      openNodeSession: f.open,
      getNodeSession: () => (f.available ? { draft: f.draft, refresh: f.refresh } : null),
      revealSidebar: f.reveal,
    }),
  },
}))
it('closes the phone file drawer before revealing a newly created chat', async () => {
  const collapse = vi.fn()
  f.open.mockImplementationOnce(async () => {})
  await openNodePathTab(
    { leftSplit: { collapse } } as never,
    {
      kind: 'chat',
      sessionId: 'sample-new-chat',
      title: 'New chat',
      target: {
        registrationId: 'sample-registration',
        nodeId: 'sample-node',
        projectId: 'sample-project',
        kind: 'worktree',
        id: 'sample-tree',
      },
    },
    true
  )
  expect(collapse).toHaveBeenCalledOnce()
  expect(collapse.mock.invocationCallOrder[0]).toBeLessThan(f.open.mock.invocationCallOrder[0])
})

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

it('retains the quote when folder reveal delays creation of the session presenter', async () => {
  f.available = false
  f.draft.value.text = 'Saved draft'
  f.open.mockImplementationOnce(async () => {
    await Promise.resolve()
    f.available = true
  })
  await openNodeChat(
    {
      kind: 'chat',
      sessionId: 'sample-delayed',
      title: 'Sample',
      target: {
        registrationId: 'sample-registration',
        nodeId: 'sample-node',
        projectId: 'sample-project',
        kind: 'worktree',
        id: 'sample-tree',
      },
    },
    'Selected code'
  )
  expect(f.draft.value.text).toBe('Saved draft\n\nSelected code')
})
