import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Menu, MenuItem } from 'obsidian'
import { newNodePathChat, showNodePathChatMenu } from '@/node/NodePathController'
import { selectionQuote } from '@/components/nodeWork/fileSelection'

const f = vi.hoisted(() => ({
  choose: undefined as undefined | ((item: { id: string }) => void),
  append: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
  execution: vi.fn(),
  session: vi.fn(),
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: {
        workspace: {
          getLeavesOfType: () => [
            {
              getViewState: () => ({ state: { sessionId: 'sample-session' } }),
              view: { appendChatText: f.append },
            },
          ],
        },
      },
    }),
  },
}))
vi.mock('@/node/nodePathNavigation', () => ({ openNodePathTab: f.open }))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      connection: () => ({
        state: ref('connected'),
        client: { describe: async () => ({ providers: [{ provider: 'fake', available: true }] }) },
      }),
    }),
  },
}))
vi.mock('@/components/nodeWork/NodeSuggestModal', () => ({
  NodeSuggestModal: class {
    constructor(_app: unknown, _items: unknown, _text: string, choose: typeof f.choose) {
      f.choose = choose
    }
    open() {}
  },
}))
vi.mock('@/modal/confirm', () => ({ confirmAction: async () => true }))
vi.mock('@/node/NodePathMutations', () => ({
  NodePathMutations: class {
    trust = vi.fn()
    execution = f.execution
    session = f.session
  },
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  f.choose = undefined
})
const target = {
  registrationId: 'sample-registration',
  nodeId: 'sample-node',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-tree',
}
function model() {
  return {
    registrationId: target.registrationId,
    capabilities: ref(['node_path_execution']),
    current: ref(target),
    folders: ref([]),
    copy: () => undefined,
    refresh: f.refresh,
    selectedChat: ref(''),
    sessions: ref([{ session: { session_id: 'sample-session', title: 'Sample chat' }, target }]),
  } as never
}

describe('selected node file context', () => {
  it('creates a target-bound node chat and seeds its draft, never sends a provider turn', async () => {
    f.session.mockResolvedValue({ session_id: 'sample-session', title: 'New chat' })
    const quote = selectionQuote('src/sample.ts', {
      text: '  const sample = 1',
      from: 4,
      to: 5,
      side: 'before',
    })
    expect(quote).toBe('src/sample.ts:4-5 (before)\n\n>   const sample = 1')
    await newNodePathChat(model(), target, quote)
    expect(f.append).not.toHaveBeenCalled()
    f.choose!({ id: 'fake' })
    await vi.waitFor(() => expect(f.append).toHaveBeenCalledWith(quote))
    expect(f.session).toHaveBeenCalledWith(target, 'New chat', 'fake')
    expect(f.open).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'chat', target, sessionId: 'sample-session', title: 'New chat' },
      false
    )
  })
  it('offers a bound chat menu without fabricating unsupported mutations', () => {
    const disable = vi.spyOn(MenuItem.prototype, 'setDisabled')
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    showNodePathChatMenu(model(), new MouseEvent('contextmenu'), 'sample-session')
    const menu = show.mock.instances[0] as unknown as {
      items: { title: string; handler: (() => void) | null }[]
    }
    // Only supported actions belong in the menu, not disabled placeholders.
    expect(menu.items.map((i) => i.title)).toEqual(['Open'])
    expect(menu.items[0].handler).toBeTruthy()
    expect(disable).not.toHaveBeenCalled()
  })
  it.fails(
    'BUG: chat rename and delete require session mutations not yet exposed by the node protocol',
    () => {
      const show = vi.spyOn(Menu.prototype, 'showAtPosition')
      showNodePathChatMenu(model(), new MouseEvent('contextmenu'), 'sample-session')
      const menu = show.mock.instances[0] as unknown as {
        items: { title: string; handler: (() => void) | null }[]
      }
      expect(
        ['Rename', 'Delete'].every((title) =>
          menu.items.some((item) => item.title === title && !!item.handler)
        )
      ).toBe(true)
    }
  )
})
