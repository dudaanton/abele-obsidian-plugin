import { ItemView, Notice, Platform, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import {
  createApp,
  h,
  shallowRef,
  watch,
  markRaw,
  type App as VueApp,
  type WatchStopHandle,
} from 'vue'
import { NodeService } from '@/node/NodeService'
import { confirmAction } from '@/modal/confirm'
import { pathPages } from '@/node/NodePathClientPort'
import { NodePathService } from '@/node/NodePathService'
import { NodePathFileModel, pathTargetKey } from '@/node/NodePathModel'
import { NodePathHistoryModel } from '@/node/NodePathHistoryModel'
import { NodeFilesModel, NodeDocumentSource, nodeResourceTarget } from '@/node/NodeFilesModel'
import { nodeChatSwitches } from '@/node/nodePathChat'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import {
  NodePathTabSchema,
  nodePathViewType,
  nodePathTabKey,
  openNodePathTab,
  revealNodeDrawer,
  type NodePathTabState,
} from '@/node/nodePathNavigation'
import { showNodePathFileMenu, chooseSessionWorktree } from '@/node/NodePathController'
import NodePathFilePane from '@/components/nodeWork/NodePathFilePane.vue'
import NodePathHistoryPane from '@/components/nodeWork/NodePathHistoryPane.vue'
import NodePathEditorPane from '@/components/nodeWork/NodePathEditorPane.vue'
import NodeChatView from '@/components/NodeChatView.vue'

/** Thin ItemView adapter; every callback is bound to this tab, not the sidebar selection. */
export class NodePathMainView extends ItemView {
  private ui?: VueApp
  private stops: WatchStopHandle[] = []
  private file?: NodePathFileModel
  private history?: NodePathHistoryModel
  private presenter?: NodeChatPresenter
  private editor?: NodeFilesModel
  private saved?: NodePathTabState
  private lifetime = 0
  private readonly error = shallowRef('')
  private readonly editorAllowed = shallowRef(false)
  constructor(
    leaf: WorkspaceLeaf,
    private readonly viewType: string
  ) {
    super(leaf)
    if (Platform.isMobile)
      this.addAction('arrow-left', 'Back to Node', () => {
        this.act(() => revealNodeDrawer(this.app.workspace, this.saved?.target.registrationId))
      })
    if (viewType === 'abele-node-file') {
      this.addAction('file-diff', 'Toggle whole file / comparison', () => {
        if (this.file) this.file.mode.value = this.file.mode.value === 'diff' ? 'file' : 'diff'
      })
      this.addAction('chevron-left', 'Previous changed file', () =>
        this.act(() => this.file?.step(-1))
      )
      this.addAction('chevron-right', 'Next changed file', () => this.act(() => this.file?.step(1)))
      this.addAction('file-code', 'Open in code editor', () => {
        const file = this.file?.document.value
        if (file)
          this.act(() =>
            openNodePathTab(
              this.app.workspace,
              { kind: 'editor', target: file.target, path: file.path },
              Platform.isMobile
            )
          )
      })
    }
    if (viewType === 'abele-node-editor')
      this.addAction('shield-check', 'Toggle external worktree editing', () =>
        this.act(() => this.toggleEditing())
      )
    if (viewType === 'abele-node-history')
      this.addAction('arrow-left', 'Back to commits', () => this.history?.back())
  }
  getViewType(): string {
    return this.viewType
  }
  getIcon(): string {
    return this.viewType === 'abele-node-chat'
      ? 'message-square'
      : this.viewType === 'abele-node-history'
        ? 'history'
        : this.viewType === 'abele-node-editor'
          ? 'file-code'
          : 'file-diff'
  }
  getDisplayText(): string {
    const state = this.saved
    return state?.kind === 'file' || state?.kind === 'editor'
      ? (state.path.split('/').pop() ?? 'File')
      : state?.kind === 'chat'
        ? state.title
        : 'Node history'
  }
  getState(): Record<string, unknown> {
    return this.saved ? { ...this.saved } : {}
  }
  async onOpen(): Promise<void> {
    this.contentEl.addClass('abele-node-content')
    if (this.saved && !this.ui) await this.bind(this.saved)
  }
  async setState(raw: unknown, result: ViewStateResult): Promise<void> {
    const parsed = NodePathTabSchema.parse(raw)
    if (nodePathViewType(parsed) !== this.viewType)
      throw new Error('The node tab kind does not match its host.')
    // Revealing an existing chat/history/editor must not destroy drafts, frozen views or scroll.
    const same =
      this.saved && parsed.kind !== 'file' && nodePathTabKey(this.saved) === nodePathTabKey(parsed)
    this.saved = parsed
    if (!same) await this.bind(parsed)
    await super.setState(raw, result)
  }
  private act(run: () => Promise<unknown> | undefined): void {
    void Promise.resolve()
      .then(run)
      .catch((error: unknown) => {
        this.error.value = error instanceof Error ? error.message : 'Node action failed'
        new Notice(this.error.value)
      })
  }
  private clearBinding(): void {
    ++this.lifetime
    this.ui?.unmount()
    this.ui = undefined
    for (const stop of this.stops) stop()
    this.stops = []
    this.file?.destroy()
    this.history?.destroy()
    this.presenter?.destroy()
    this.file = undefined
    this.history = undefined
    this.presenter = undefined
    this.editor = undefined
    this.contentEl.empty()
  }
  private async bind(state: NodePathTabState): Promise<void> {
    this.clearBinding()
    const lifetime = this.lifetime
    const node = NodeService.getInstance().nodes.value.find(
      (n) => n.id === state.target.registrationId
    )
    if (!node || node.expectedNodeId !== state.target.nodeId) {
      this.contentEl.createDiv({
        text: 'This node registration is missing or has changed. Reconnect the original node to reopen this tab.',
      })
      return
    }
    const connection = NodeService.getInstance().connection(node.id)
    const model = NodePathService.getInstance().model(node.id)
    const host = this.contentEl.createDiv({
      cls: state.kind === 'chat' ? 'abele-node-content__chat' : 'abele-node-content__pane',
    })
    const offline = () => connection.state.value !== 'connected'
    this.error.value = ''
    if (state.kind === 'file') {
      const file = (this.file = new NodePathFileModel(model, state.target))
      this.ui = createApp({
        render: () =>
          h(NodePathFilePane, {
            model: file,
            offline: offline(),
            onMenu: (event: MouseEvent, selection: string) => {
              const doc = file.document.value
              if (doc)
                showNodePathFileMenu(event, {
                  target: doc.target,
                  path: doc.path,
                  revision: doc.revision,
                  contentId: doc.contentId,
                  text: doc.text,
                  selection,
                })
            },
          }),
      })
      this.stops.push(
        watch(file.document, (doc) => {
          if (doc && this.saved?.kind === 'file') {
            this.saved = { ...this.saved, path: doc.path }
            this.app.workspace.requestSaveLayout()
            this.refreshHeader()
          }
        })
      )
      this.ui.mount(host)
      if (model.online.value || !model.hasRetained(state.target, state.path, state.stage)) {
        await connection.connect().catch(() => {})
        await NodePathService.getInstance().ready(node.id)
      }
      if (lifetime === this.lifetime) await file.open(state.path, state.stage).catch(() => {})
    } else if (state.kind === 'history') {
      const history = (this.history = new NodePathHistoryModel(model.port, state.target))
      this.ui = createApp({
        render: () =>
          h(NodePathHistoryPane, {
            model: history,
            offline: offline(),
            copy: model.copy(state.target),
            base: model.inspections.value[pathTargetKey(state.target)]?.base,
            onMenu: (event: MouseEvent, what: string, selection: string) => {
              const commit = history.commits.value.find((c) => c.hash === history.openCommit.value)
              const file = commit?.files?.find((f) => f.path === what)
              showNodePathFileMenu(event, {
                target: state.target,
                ...(file ? { path: file.path, text: file.after } : {}),
                commit: commit?.hash ?? what,
                revision: { kind: 'commit', commit: commit?.hash ?? what },
                selection,
              })
            },
          }),
      })
      this.ui.mount(host)
      await connection.connect().catch(() => {})
      await NodePathService.getInstance().ready(node.id)
      if (lifetime === this.lifetime) await history.load().catch(() => {})
    } else if (state.kind === 'editor') {
      const editor = (this.editor = new NodeFilesModel(
        connection.client,
        node.expectedNodeId,
        state.target.id,
        undefined,
        new NodeDocumentSource(connection.client, state.target.id, state.target.kind === 'worktree')
      ))
      this.editorAllowed.value = state.target.kind === 'workspace'
      const permission = async () => {
        if (state.target.kind !== 'worktree') return
        const result = await connection.client.repository.editingStatus({
          worktree_id: state.target.id,
        })
        if (lifetime === this.lifetime) this.editorAllowed.value = result.enabled
      }
      const stopEvents = connection.client.onEvent(() => {
        void permission().catch(() => {
          if (lifetime === this.lifetime) this.editorAllowed.value = false
        })
      })
      this.stops.push(stopEvents)
      this.ui = createApp({
        render: () =>
          h(NodePathEditorPane, {
            model: editor,
            offline: offline(),
            error: this.error.value,
            locked: !this.editorAllowed.value,
          }),
      })
      this.ui.mount(host)
      try {
        await connection.connect().catch(() => {})
        await editor.openFile(state.path)
        if (!offline()) await permission()
        if (lifetime === this.lifetime && editor.fileEditable.value && this.editorAllowed.value)
          await editor.beginEditing()
        if (!offline())
          await model
            .openFile(
              state.target,
              state.path,
              undefined,
              undefined,
              (document) =>
                lifetime === this.lifetime &&
                document.contentId === editor.document.value?.contentId &&
                editor.draftText.value === editor.document.value?.text
            )
            .catch(() => {})
      } catch (error) {
        if (lifetime === this.lifetime)
          this.error.value = error instanceof Error ? error.message : 'Could not open code editor'
      }
    } else {
      const presenter = (this.presenter = markRaw(
        new NodeChatPresenter(
          {
            kind: 'node-session',
            registrationId: node.id,
            nodeId: node.expectedNodeId,
            sessionId: state.sessionId,
            title: state.title,
          },
          connection
        )
      ))
      this.ui = createApp({
        render: () => {
          const target =
            model.sessions.value.find((s) => s.session.session_id === state.sessionId)?.target ??
            state.target
          const folder = model.folders.value.find((f) => f.id === target.projectId)
          const copy = model.copy(target) ?? {
            id: target.id,
            kind: 'project' as const,
            branch: folder?.name ?? 'Folder',
            path: folder?.path ?? '',
            changed: 0,
          }
          return h(NodeChatView, {
            presenter,
            worktree: copy,
            folder: folder?.name,
            canSwitchWorktree: model.capabilities.value.includes('node_path_execution'),
            canSwitchNative: model.capabilities.value.includes('node_path_native_switching'),
            currentTarget: target,
            switches: nodeChatSwitches(
              presenter.projection.value.unknown,
              target,
              state.sessionId,
              (id) =>
                model.folders.value.flatMap((f) => f.copies).find((c) => c.id === id)?.branch ??
                'Unavailable worktree'
            ),
            openNodeResource: (resource: string, bound = target) =>
              this.act(() =>
                openNodePathTab(
                  this.app.workspace,
                  { kind: 'file', target: bound, path: nodeResourceTarget(resource).path },
                  Platform.isMobile
                )
              ),
            onChooseWorktree: () => this.act(() => chooseSessionWorktree(model, state.sessionId)),
            onNewChat: () =>
              this.act(() =>
                import('@/node/NodePathController').then((m) => m.newNodePathChat(model, target))
              ),
          })
        },
      })
      this.stops.push(
        watch(model.sessions, (sessions) => {
          const current = sessions.find((s) => s.session.session_id === state.sessionId)?.target
          if (current && this.saved?.kind === 'chat') {
            this.saved = { ...this.saved, target: current }
            this.app.workspace.requestSaveLayout()
          }
        })
      )
      this.ui.mount(host)
      await presenter.load()
    }
    if (lifetime === this.lifetime) this.refreshHeader()
  }
  private async toggleEditing(): Promise<void> {
    const state = this.saved
    if (state?.kind !== 'editor' || state.target.kind !== 'worktree') return
    const connection = NodeService.getInstance().connection(state.target.registrationId)
    const rows = await pathPages((cursor) =>
      connection.client.repository.worktrees({ project_id: state.target.projectId, cursor })
    )
    const row = rows.find((r) => r.worktree_id === state.target.id)
    if (!row || row.kind !== 'external') {
      new Notice('This is not an external worktree.')
      return
    }
    const enabled = !this.editorAllowed.value
    if (
      !(await confirmAction(this.app, {
        title: enabled ? 'Allow editing in this worktree?' : 'Turn off worktree editing?',
        message: enabled
          ? `Allow current files in ${row.path_label} to be saved by confirmed node owners? This grants neither chat scope nor agent execution.`
          : 'Stop new saves in this external worktree? Local drafts and unresolved evidence are kept.',
        confirmText: enabled ? 'Allow editing' : 'Turn off editing',
      }))
    )
      return
    await connection.client.repository.editing({ worktree_id: state.target.id, enabled })
    if (this.saved === state) {
      this.editorAllowed.value = enabled
      if (enabled && this.editor?.fileEditable.value && !this.editor.editing.value)
        await this.editor.beginEditing()
    }
  }
  private refreshHeader(): void {
    ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()
    ;(this as unknown as { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText())
  }
  async onClose(): Promise<void> {
    this.clearBinding()
  }
}
