import { createApp, h, shallowRef } from 'vue'
import { Notice } from 'obsidian'
import Modal from '@/components/obsidian/Modal.vue'
import FolderPicker from '@/components/nodeWork/FolderPicker.vue'
import WorktreeDialog from '@/components/nodeWork/WorktreeDialog.vue'
import { NodeSuggestModal } from '@/components/nodeWork/NodeSuggestModal'
import { GlobalStore } from '@/stores/GlobalStore'
import type { NodeConnection } from './NodeService'
import { NodePathMutations } from './NodePathMutations'
import { pathPages } from './NodePathClientPort'
import type { NodePathModel, PathTarget } from './NodePathModel'
import type { NodeDirectory } from '@/components/nodeWork/types'

export function nodePathDialog(
  title: string,
  render: (close: () => void) => ReturnType<typeof h>,
  cleanup = () => {},
  phoneSheet = false
): () => void {
  const host = GlobalStore.getInstance().app.workspace.containerEl.ownerDocument.body.createDiv()
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    cleanup()
    ui.unmount()
    host.remove()
  }
  const ui = createApp({
    render: () => h(Modal, { title, phoneSheet, onClose: close }, { default: () => render(close) }),
  })
  ui.mount(host)
  return close
}
export async function openNodeFolderPicker(
  model: NodePathModel,
  connection: NodeConnection
): Promise<void> {
  if (!model.capabilities.value.includes('node_path_v2'))
    throw new Error('Update this node to enable exact folder selection.')
  const client = connection.client,
    mutations = new NodePathMutations(client)
  type Directory = Awaited<ReturnType<typeof client.nodePath.directories>>
  const listings = shallowRef<Record<string, Directory | { error: string }>>({})
  const pending = new Set<string>()
  const actionError = shallowRef(''),
    busy = shallowRef(false)
  let closed = false
  const normalize = (path: string) => path.replace(/\/$/, '') || '/'
  const load = async (path?: string): Promise<Directory> => {
    const first = await client.nodePath.directories(path ? { path: normalize(path) } : {})
    const entries = [...first.entries]
    const cursors = new Set<string>()
    let cursor = first.cursor
    while (cursor) {
      if (cursors.has(cursor)) throw new Error('Directory pagination did not advance')
      cursors.add(cursor)
      const next = await client.nodePath.directories({ path: first.path, cursor })
      if (next.incomplete)
        throw new Error(next.omissions.join(' · ') || 'Incomplete directory listing')
      entries.push(...next.entries)
      cursor = next.cursor
    }
    if (first.incomplete)
      throw new Error(first.omissions.join(' · ') || 'Incomplete directory listing')
    const value = { ...first, entries }
    if (!closed) listings.value = { ...listings.value, [normalize(first.path)]: value }
    return value
  }
  const home = await load()
  const browse = (dir: string): { entries: NodeDirectory[] } | { error: string } => {
    const key = normalize(dir),
      cached = listings.value[key]
    if (!cached && !pending.has(key)) {
      pending.add(key)
      void load(key)
        .catch((error: unknown) => {
          if (!closed)
            listings.value = {
              ...listings.value,
              [key]: {
                error: error instanceof Error ? error.message : 'Could not list this folder',
              },
            }
        })
        .finally(() => pending.delete(key))
    }
    if (!cached) return { error: 'Loading folders…' }
    if ('error' in cached) return cached
    return {
      entries: cached.entries.map((entry) => {
        const known = model.folders.value.find((f) => f.path === entry.path)
        return {
          ...entry,
          open: !!known,
          inspected: !!known,
          ...(known?.git
            ? {
                git: {
                  branch: known.copies[0]?.branch ?? 'No commits',
                  copies: known.copies.length,
                },
              }
            : {}),
        }
      }),
    }
  }
  const opened = async (path: string, create: boolean, close: () => void) => {
    if (busy.value) return
    // Said, not swallowed: a press of Open that does nothing reads as a broken button.
    if (connection.state.value !== 'connected') {
      actionError.value = 'The node is not connected. Reconnect it, then open the folder.'
      return
    }
    busy.value = true
    try {
      if (create) {
        const at = path.lastIndexOf('/'),
          parent = normalize(path.slice(0, at)),
          name = path.slice(at + 1)
        const directory = listings.value[parent]
        if (!directory || 'error' in directory)
          throw new Error('Inspect the parent directory before creating a folder.')
        path = await mutations.mkdir(directory.directory_id, name, parent)
      }
      let project
      try {
        project = await mutations.register(path)
      } catch (error) {
        if (create)
          actionError.value = `The folder was created at ${path}, but could not be opened. It was not deleted.`
        throw error
      }
      await model.refresh()
      const target = model.targets.value.find((t) => t.projectId === project.project_id)
      if (target) await model.select(target.id)
      if (!closed) close()
    } catch (error) {
      actionError.value = [
        actionError.value,
        error instanceof Error ? error.message : 'Folder action failed',
      ]
        .filter(Boolean)
        .join(' ')
    } finally {
      busy.value = false
    }
  }
  nodePathDialog(
    'Open folder on node',
    (close) =>
      h('div', { class: 'abele-folder-picker-dialog', 'aria-busy': busy.value }, [
        actionError.value ? h('div', { role: 'alert' }, actionError.value) : null,
        h(FolderPicker, {
          browse,
          start: home.path + '/',
          onOpen: (path: string) => {
            void opened(path, false, close)
          },
          onCreate: (path: string) => {
            void opened(path, true, close)
          },
          onShow: (path: string) => {
            const folder = model.folders.value.find((f) => f.path === path)
            const id = folder?.copies[0]?.id ?? folder?.id
            if (id)
              void model
                .select(id)
                .then(close)
                .catch((e) => model.report(e))
          },
          onCancel: close,
        }),
      ]),
    () => {
      closed = true
    },
    true
  )
}
export async function openNodeWorktreeDialog(
  model: NodePathModel,
  connection: NodeConnection,
  target: PathTarget
): Promise<void> {
  if (!model.capabilities.value.includes('node_path_worktrees'))
    throw new Error('Update this node to enable named worktree creation.')
  const [rows, refs] = await Promise.all([
    pathPages((cursor) =>
      connection.client.repository.worktrees({
        project_id: target.projectId,
        include_selection: true,
        cursor,
      })
    ),
    pathPages((cursor) => connection.client.repository.refs({ worktree_id: target.id, cursor })),
  ])
  const branches = refs.map((r) => r.name.replace(/^refs\/heads\//, ''))
  const taken = rows
    .map((r) => r.branch?.replace(/^refs\/heads\//, ''))
    .filter((b): b is string => !!b)
  const base = shallowRef('HEAD'),
    error = shallowRef(''),
    busy = shallowRef(false)
  const mutations = new NodePathMutations(connection.client)
  nodePathDialog('New worktree', (close) =>
    h('div', { 'aria-busy': busy.value }, [
      error.value ? h('div', { role: 'alert' }, error.value) : null,
      h(WorktreeDialog, {
        branches,
        taken,
        base: base.value,
        onCancel: close,
        onChooseBase: () =>
          new NodeSuggestModal(
            GlobalStore.getInstance().app,
            branches.map((b) => ({ id: b, title: b, icon: 'git-branch', kind: 'Branch' })),
            'Start from branch',
            (item) => {
              base.value = item.id
            }
          ).open(),
        onCreate: (branch: string, from: string) => {
          if (busy.value) return
          busy.value = true
          void mutations
            .create(target.projectId, branch, from)
            .then(async (reservation) => {
              const job = await connection.client.getJob(reservation.job_id)
              await model.refresh()
              if (job.state !== 'succeeded')
                new Notice(
                  job.state === 'failed' || job.state === 'needs_attention'
                    ? (job.error ?? 'Worktree creation needs attention.')
                    : 'Worktree creation is in progress. Refresh the folder to check its result.'
                )
              else {
                const selected = model.targets.value.find(
                  (t) => model.copy(t)?.branch === branch && t.projectId === target.projectId
                )
                if (selected) await model.select(selected.id)
              }
              close()
            })
            .catch((failure: unknown) => {
              error.value = failure instanceof Error ? failure.message : 'Could not create worktree'
            })
            .finally(() => {
              busy.value = false
            })
        },
      }),
    ])
  )
}
