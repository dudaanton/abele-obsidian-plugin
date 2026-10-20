import { nodeErrorNotice } from './errorNotice'
import { waitForWorktreeJob } from './worktreePresentation'
import { nodeErrorWords } from './errorWords'
import { UiError, uiMessage, presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { h, shallowRef, watch } from 'vue'
import { ChannelError } from '@abele/channel-protocol'
import Modal from '@/components/obsidian/Modal.vue'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { mountKit } from '@/components/obsidian/mount'
import FolderPicker from '@/components/nodeWork/FolderPicker.vue'
import WorktreeDialog from '@/components/nodeWork/WorktreeDialog.vue'
import { NodeSuggestModal } from '@/components/nodeWork/NodeSuggestModal'
import { GlobalStore } from '@/stores/GlobalStore'
import type { NodeConnection } from './NodeService'
import { NodePathMutations } from './NodePathMutations'
import { pathPages, supportedNodePathCapabilities } from './NodePathClientPort'
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
  }
  const ui = mountKit(
    host,
    {
      render: () =>
        h(Modal, { title, phoneSheet, onClose: close }, { default: () => render(close) }),
    },
    null,
    { remove: true }
  )
  return close
}
export async function openNodeFolderPicker(
  model: NodePathModel,
  connection: NodeConnection
): Promise<void> {
  // Catalogue reads can still be pending or fail on an unrelated stale handle.
  // Ask the node itself before deciding that this feature needs an update.
  const capabilities = supportedNodePathCapabilities(await connection.client.describe())
  if (!capabilities.includes('node_path_v2'))
    throw new UiError(uiMessage('streamB.updateThisNodeToEnableExactFolder.063fba'))
  const client = connection.client,
    mutations = new NodePathMutations(client)
  type Directory = Awaited<ReturnType<typeof client.nodePath.directories>>
  const listings = shallowRef<Record<string, Directory | { error: string }>>({})
  const pending = new Set<string>()
  const actionError = shallowRef(''),
    busy = shallowRef(false)
  let closed = false
  let listingEpoch = 0
  const normalize = (path: string) => path.replace(/\/$/, '') || '/'
  const load = async (path?: string, retry = true): Promise<Directory> => {
    const epoch = listingEpoch
    const first = await client.nodePath.directories(path ? { path: normalize(path) } : {})
    const entries = [...first.entries]
    const cursors = new Set<string>()
    let cursor = first.cursor
    while (cursor) {
      if (cursors.has(cursor))
        throw new UiError(uiMessage('streamB.directoryPaginationDidNotAdvance.2bab6c'))
      cursors.add(cursor)
      let next: Directory
      try {
        next = await client.nodePath.directories({ path: first.path, cursor })
      } catch (error) {
        if (
          retry &&
          error instanceof ChannelError &&
          ['stale_cursor', 'stale_resource'].includes(error.code)
        )
          return load(first.path, false)
        throw error
      }
      if (next.incomplete)
        throw new Error(
          next.omissions.join(' · ') || t('streamB.incompleteDirectoryListing.fcb072')
        )
      entries.push(...next.entries)
      cursor = next.cursor
    }
    if (first.incomplete)
      throw new Error(first.omissions.join(' · ') || t('streamB.incompleteDirectoryListing.fcb072'))
    const value = { ...first, entries }
    if (!closed && epoch === listingEpoch)
      listings.value = {
        ...listings.value,
        [normalize(first.path)]: value,
        ...(path ? { [normalize(path)]: value } : {}),
      }
    return value
  }
  const stopConnection = watch(
    connection.state,
    () => {
      listingEpoch++
      pending.clear()
      listings.value = {}
    },
    { flush: 'sync' }
  )
  let home: Directory
  try {
    home = await load()
  } catch (error) {
    stopConnection()
    throw error
  }
  const browse = (dir: string): { entries: NodeDirectory[] } | { error: string } => {
    const key = normalize(dir),
      cached = listings.value[key]
    if (!cached && !pending.has(key)) {
      const epoch = listingEpoch
      pending.add(key)
      void load(key)
        .catch((error: unknown) => {
          if (!closed && epoch === listingEpoch)
            listings.value = {
              ...listings.value,
              [key]: {
                error:
                  error instanceof Error
                    ? error.message
                    : t('streamB.couldNotListThisFolder.f08423'),
              },
            }
        })
        .finally(() => {
          if (epoch === listingEpoch) pending.delete(key)
        })
    }
    if (!cached) return { error: t('streamB.loadingFolders.d0aa0d') }
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
                  branch: known.copies[0]?.branch ?? t('streamB.noCommits.951903'),
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
      actionError.value = t('streamB.theNodeIsNotConnectedReconnectIt.0c7e13')
      return
    }
    busy.value = true
    actionError.value = ''
    try {
      if (create) {
        const at = path.lastIndexOf('/'),
          parent = normalize(path.slice(0, at)),
          name = path.slice(at + 1)
        const directory = listings.value[parent]
        if (!directory || 'error' in directory)
          throw new UiError(uiMessage('streamB.inspectTheParentDirectoryBeforeCreatingA.5e40b4'))
        try {
          path = await mutations.mkdir(directory.directory_id, name, parent)
        } catch (error) {
          if (error instanceof ChannelError && error.code === 'stale_resource') {
            // Do not replay the mutation. The next explicit Create uses the refreshed ID
            // and a new logical intent; the field still holds the requested child name.
            listings.value = Object.fromEntries(
              Object.entries(listings.value).filter(([key]) => key !== parent)
            )
            await load(parent)
            actionError.value = t('node.folderRefreshed')
            return
          }
          throw error
        }
      }
      let project
      try {
        project = await mutations.register(path)
      } catch (error) {
        if (create)
          actionError.value = t('streamB.theFolderWasCreatedAtButCould.d1dea3', {
            v0: String(path),
          })
        throw error
      }
      if (
        project.trust === 'untrusted' &&
        (await confirmDialog({
          title: t('node.trust.title'),
          message: t('node.trust.message', { path: project.root_path }),
          confirmText: t('node.trust.allow'),
        }))
      )
        await mutations.trust(project.project_id)
      await model.refresh()
      const target = model.targets.value.find(
        (translationItem) => translationItem.projectId === project.project_id
      )
      if (!target) throw new ChannelError('stale_resource')
      await model.select(target.id)
      if (!closed) close()
    } catch (error) {
      actionError.value = [
        actionError.value,
        error instanceof ChannelError
          ? `${nodeErrorWords(error.code)} (${error.code})`
          : error instanceof Error
            ? presentUiError(error)
            : t('streamB.folderActionFailed.7e771a'),
      ]
        .filter(Boolean)
        .join(' ')
    } finally {
      busy.value = false
    }
  }
  nodePathDialog(
    t('streamB.openFolderOnNode.71b43e'),
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
            void opened(path, false, close)
          },
          onCancel: close,
        }),
      ]),
    () => {
      closed = true
      stopConnection()
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
    throw new UiError(uiMessage('streamB.updateThisNodeToEnableNamedWorktree.4570c7'))
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
  nodePathDialog(t('streamB.newWorktree.4f210a'), (close) =>
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
            branches.map((b) => ({
              id: b,
              title: b,
              icon: 'git-branch',
              kind: t('streamB.branch.52656e'),
            })),
            t('streamB.startFromBranch.c8e69f'),
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
              const job = await waitForWorktreeJob(() =>
                connection.client.getJob(reservation.job_id)
              )
              await model.refresh()
              if (job.state !== 'succeeded')
                nodeErrorNotice(
                  job.state === 'failed' || job.state === 'needs_attention'
                    ? (job.error ?? t('streamB.worktreeCreationNeedsAttention.ca407a'))
                    : t('streamB.worktreeCreationIsInProgressRefreshThe.b895d6')
                )
              else {
                const selected = model.targets.value.find(
                  (translationItem) =>
                    model.copy(translationItem)?.branch?.replace(/^refs\/heads\//, '') === branch &&
                    translationItem.projectId === target.projectId
                )
                if (selected) await model.select(selected.id)
              }
              close()
            })
            .catch((failure: unknown) => {
              error.value =
                failure instanceof Error
                  ? failure.message
                  : t('streamB.couldNotCreateWorktree.d782d3')
            })
            .finally(() => {
              busy.value = false
            })
        },
      }),
    ])
  )
}
