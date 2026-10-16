import {
  ItemView,
  type Menu,
  Notice,
  Platform,
  Scope,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian'
import { h, shallowRef, watch, type WatchStopHandle } from 'vue'
import { NodeService } from '@/node/NodeService'
import { DebuggerService } from '@/debugger/DebuggerService'
import { NodePathService } from '@/node/NodePathService'
import { NodePathFileModel, pathTargetKey } from '@/node/NodePathModel'
import { NodePathHistoryModel } from '@/node/NodePathHistoryModel'
import { NodeFilesModel, NodeDocumentSource } from '@/node/NodeFilesModel'
import { NodePathFileEditing } from '@/node/NodePathFileEditing'
import { NodeFileTabActions } from './nodeFileTabActions'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import {
  NodePathTabSchema,
  NODE_FILE_VIEW,
  editedFileTab,
  nodePathViewType,
  nodePathTabKey,
  openNodeChat,
  revealNodeDrawer,
  type NodePathTabState,
} from '@/node/nodePathNavigation'
import { showNodePathFileMenu, newNodePathChat } from '@/node/NodePathController'
import { nodePathOwnerActions, freezeNodePathContext } from '@/node/NodePathOwnerActions'
import { insertCodeSelection } from '@/views/codeSelectionHost'
import { selectionQuote, type FileSelection } from '@/components/nodeWork/fileSelection'
import NodePathFilePane from '@/components/nodeWork/NodePathFilePane.vue'
import NodePathHistoryPane from '@/components/nodeWork/NodePathHistoryPane.vue'
import NodePathEditorPane from '@/components/nodeWork/NodePathEditorPane.vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'

/** Thin ItemView adapter; every callback is bound to this tab, not the sidebar selection. */
export class NodePathMainView extends ItemView {
  private ui?: KitMount
  private stops: WatchStopHandle[] = []
  private file?: NodePathFileModel
  private history?: NodePathHistoryModel
  private presenter?: NodeChatPresenter
  private chatLoad?: Promise<void>
  private editing?: NodePathFileEditing
  /** The file tab's header actions and editing, kept apart from the binding. */
  private readonly fileTab = new NodeFileTabActions({
    addAction: (icon, title, run) => this.addAction(icon, title, run),
    app: () => this.app,
    file: () => this.file,
    editing: () => this.editing,
    saved: () => this.saved,
    act: (run) => this.act(run),
  })
  private saved?: NodePathTabState
  private lifetime = 0
  private readonly error = shallowRef('')
  constructor(
    leaf: WorkspaceLeaf,
    private readonly viewType: string
  ) {
    super(leaf)
    // On a phone the title row keeps the file's name: one glyph beside it, the rest in the view's
    // own menu (onPaneMenu), and the way back to the node is the drawer's button on the left.
    if (Platform.isMobile && !Platform.isPhone)
      this.addAction('arrow-left', 'Back to node', () => this.backToNode())
    if (viewType === 'abele-node-file') this.fileTab.render()
    if (viewType === 'abele-node-history')
      this.addAction('arrow-left', 'Back to commits', () => this.history?.back())
  }
  private backToNode(): void {
    this.act(() => revealNodeDrawer(this.app.workspace, this.saved?.target.registrationId))
  }
  private step(by: 1 | -1): void {
    this.act(() => this.file?.step(by))
  }
  onPaneMenu(menu: Menu, source: string): void {
    if (Platform.isPhone && source === 'more-options') {
      if (this.viewType === 'abele-node-file') {
        this.fileTab.paneMenu(menu)
      }
      menu.addItem((i) =>
        i
          .setTitle('Back to node')
          .setIcon('server')
          .setSection('action')
          .onClick(() => this.backToNode())
      )
    }
    super.onPaneMenu(menu, source)
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
    // ⌘ S saves while editing, as Obsidian's own save command does in a note.
    this.scope = new Scope((this.app as { scope?: Scope }).scope)
    this.scope.register(['Mod'], 's', () => {
      if (!this.editing?.active.value) return true
      this.act(() => this.editing?.save())
      return false
    })
    if (this.saved && !this.ui) this.startBinding(this.saved)
  }
  async setState(raw: unknown, result: ViewStateResult): Promise<void> {
    const parsed = NodePathTabSchema.parse(raw)
    if (nodePathViewType(parsed) !== this.viewType)
      throw new Error('The node tab kind does not match its host.')
    if (parsed.kind === 'editor') {
      // An editor tab from an earlier version becomes the file's own tab, editing. The leaf is
      // switched once Obsidian has finished admitting this state: switching it from inside its
      // own setState is overridden by the admission still under way.
      this.saved = parsed
      await super.setState(raw, result)
      window.setTimeout(() => {
        void Promise.resolve()
          .then(() =>
            this.leaf.setViewState({
              type: NODE_FILE_VIEW,
              active: true,
              state: editedFileTab(parsed),
            })
          )
          .catch((error: unknown) => console.debug('[Abele node] editor tab not reopened', error))
      }, 0)
      return
    }
    // Revealing an existing chat/history/editor must not destroy drafts, frozen views or scroll.
    const same =
      this.ui &&
      this.saved &&
      parsed.kind !== 'file' &&
      nodePathTabKey(this.saved) === nodePathTabKey(parsed)
    this.saved = parsed
    if (!same) this.startBinding(parsed)
    // The same history tab, asked for another commit from the panel: it opens that one.
    else if (parsed.kind === 'history' && parsed.commit && this.history)
      this.act(() => this.history?.open(parsed.commit!))
    await super.setState(raw, result)
  }
  /** The margin of the file shown: the one this tab was opened for, or any file a running
   * program took from this folder, however the tab came to show it. */
  private debugOf(state: Extract<NodePathTabState, { kind: 'file' }>, file: NodePathFileModel) {
    const doc = file.document.value
    if (!doc) return undefined
    const debug =
      state.debug && doc.path === state.path
        ? state.debug
        : DebuggerService.instance.debugFor(state.target, doc.path)
    return debug
      ? { ...debug, registrationId: state.target.registrationId, path: doc.path, text: doc.text }
      : undefined
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
    this.chatLoad = undefined
    this.editing = undefined
    this.contentEl.empty()
  }
  /** Obsidian's deferred leaf admission must never wait for remote reads. */
  private startBinding(state: NodePathTabState): void {
    const loading = this.bind(state)
    const lifetime = this.lifetime
    void loading.catch((error: unknown) => {
      if (lifetime !== this.lifetime) return
      this.error.value = error instanceof Error ? error.message : 'Could not load node tab'
      console.debug('[Abele node] tab load failed', this.error.value)
      if (!this.ui) this.contentEl.setText(this.error.value)
    })
    this.refreshHeader()
  }
  private async bind(state: NodePathTabState): Promise<void> {
    this.clearBinding()
    // A chat tab from an earlier layout: chats live in the sidebar now, so it moves there.
    if (state.kind === 'chat') {
      await openNodeChat(state)
      this.leaf.detach()
      return
    }
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
    const host = this.contentEl.createDiv({ cls: 'abele-node-content__pane' })
    const offline = () => connection.state.value !== 'connected'
    this.error.value = ''
    if (state.kind === 'file') {
      const file = (this.file = new NodePathFileModel(model, state.target))
      const allowed = async () =>
        state.target.kind !== 'worktree' ||
        (await connection.client.repository.editingStatus({ worktree_id: state.target.id })).enabled
      const editing = (this.editing = new NodePathFileEditing(
        state.target,
        () =>
          new NodeFilesModel(
            connection.client,
            node.expectedNodeId,
            state.target.id,
            undefined,
            new NodeDocumentSource(
              connection.client,
              state.target.id,
              state.target.kind === 'worktree',
              () => connection.state.value === 'connected' && connection.client.connected
            )
          ),
        allowed
      ))
      // The owner may open or close the worktree to saves elsewhere; the lock follows.
      this.stops.push(
        connection.client.onEvent(() => {
          if (editing.active.value)
            void allowed()
              .then((enabled) => editing.unlock(enabled))
              .catch(() => {})
        })
      )
      this.stops.push(
        watch([editing.active, editing.dirty, editing.locked], ([active]) => {
          this.fileTab.render()
          if (this.saved?.kind === 'file' && !!this.saved.edit !== active) {
            const { edit: _edit, ...rest } = this.saved
            this.saved = active ? { ...rest, edit: true } : rest
            this.app.workspace.requestSaveLayout()
          }
        })
      )
      this.fileTab.render()
      const root = {
        render: () =>
          editing.active.value && editing.editor.value
            ? h(NodePathEditorPane, {
                model: editing.editor.value as NodeFilesModel,
                offline: offline(),
                error: this.error.value,
                locked: editing.locked.value,
              })
            : h(NodePathFilePane, {
                model: file,
                offline: offline(),
                debug: this.debugOf(state, file),
                onAsk: (selection: FileSelection) => {
                  const doc = file.document.value
                  if (doc)
                    this.act(() =>
                      newNodePathChat(
                        model,
                        Object.freeze({ ...doc.target }),
                        selectionQuote(doc.path, selection)
                      )
                    )
                },
                onAdd: (selection: FileSelection) => {
                  const doc = file.document.value
                  const owner = nodePathOwnerActions()
                  if (doc && owner) {
                    const context = freezeNodePathContext({
                      target: doc.target,
                      path: doc.path,
                      revision: doc.revision,
                      contentId: doc.contentId,
                      text: doc.text,
                      selection: selection.text,
                      lines: {
                        start: Math.min(selection.from, selection.to),
                        end: Math.max(selection.from, selection.to),
                      },
                      side: selection.side,
                    })
                    this.act(() => owner.add(context))
                  }
                },
                onNote: (selection: FileSelection) => {
                  const doc = file.document.value
                  if (doc) insertCodeSelection(this.app, doc.path, selection)
                },
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
      }
      this.stops.push(
        watch(file.document, (doc) => {
          if (doc && this.saved?.kind === 'file') {
            this.saved = { ...this.saved, path: doc.path }
            this.app.workspace.requestSaveLayout()
            this.refreshHeader()
          }
        })
      )
      this.ui = mountKit(host, root)
      file.busy.value = true
      if (model.online.value || !model.hasRetained(state.target, state.path, state.stage))
        await connection.connect().catch(() => {})
      if (lifetime === this.lifetime) {
        await file.open(state.path, state.stage).catch(() => {})
        if (state.debug) file.mode.value = 'file'
      }
      if (lifetime === this.lifetime && state.edit)
        await editing.start(state.path).catch((error: unknown) => {
          this.error.value = error instanceof Error ? error.message : 'Could not start editing'
        })
    } else if (state.kind === 'history') {
      const history = (this.history = new NodePathHistoryModel(model.port, state.target))
      const root = {
        render: () =>
          h(NodePathHistoryPane, {
            model: history,
            offline: offline(),
            copy: model.copy(state.target),
            base: model.inspections.value[pathTargetKey(state.target)]?.base,
            onAsk: (path: string, selection: FileSelection) => {
              const quote = selectionQuote(`${path} at ${history.openCommit.value}`, selection)
              this.act(() => newNodePathChat(model, Object.freeze({ ...state.target }), quote))
            },
            onAdd: (path: string, selection: FileSelection) => {
              const owner = nodePathOwnerActions()
              const commit = history.openCommit.value
              if (owner && commit) {
                const context = freezeNodePathContext({
                  target: state.target,
                  path,
                  commit,
                  revision: { kind: 'commit', commit },
                  selection: selection.text,
                  lines: {
                    start: Math.min(selection.from, selection.to),
                    end: Math.max(selection.from, selection.to),
                  },
                  side: selection.side,
                })
                this.act(() => owner.add(context))
              }
            },
            onNote: (path: string, selection: FileSelection) => {
              insertCodeSelection(this.app, `${path} at ${history.openCommit.value}`, selection)
            },
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
      }
      this.ui = mountKit(host, root)
      history.busy.value = true
      await connection.connect().catch(() => {})
      if (lifetime === this.lifetime) await history.load().catch(() => {})
      if (lifetime === this.lifetime && state.commit)
        await history.open(state.commit).catch(() => {})
    } else if (state.kind === 'editor') {
      return
    }
    if (lifetime === this.lifetime) this.refreshHeader()
  }
  private refreshHeader(): void {
    ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()
    ;(this as unknown as { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText())
  }
  async onClose(): Promise<void> {
    this.clearBinding()
  }
}
