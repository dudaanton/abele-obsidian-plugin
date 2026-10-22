import { expect, it, vi } from 'vitest'
import type { VNode } from 'vue'
import { ref } from 'vue'
import { openNodeWorktreeDialog } from '@/node/NodePathDialogs'

const f = vi.hoisted(() => ({ render: undefined as undefined | (() => VNode), unmount: vi.fn() }))
vi.mock('@/components/obsidian/mount', () => ({
  mountKit: (_host: unknown, component: { render: () => VNode }) => {
    f.render = component.render
    return { unmount: f.unmount }
  },
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: { workspace: { containerEl: document.body } } }) },
}))
vi.mock('@/node/NodePathMutations', () => ({
  NodePathMutations: class {
    create = async () => ({ job_id: 'sample-job' })
  },
}))

it('closes a successful creation before refreshing the folder catalogue', async () => {
  let release!: () => void
  const refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const model = { capabilities: ref(['node_path_worktrees']), targets: ref([]), refresh }
  const connection = {
    client: {
      repository: {
        worktrees: async () => ({ entries: [], cursor: null }),
        refs: async () => ({ entries: [], cursor: null }),
      },
      getJob: async () => ({ state: 'succeeded' }),
    },
  }
  await openNodeWorktreeDialog(
    model as never,
    connection as never,
    { id: 'sample-root', projectId: 'sample-project' } as never
  )
  const modal = f.render!()
  const content = (modal.children as { default: () => VNode }).default()
  const dialog = (content.children as VNode[])[1]
  dialog.props!.onCreate('sample-branch', 'HEAD')
  try {
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(f.unmount).toHaveBeenCalledOnce()
  } finally {
    release()
  }
})
