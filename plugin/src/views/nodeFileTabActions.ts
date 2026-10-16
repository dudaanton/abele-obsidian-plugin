import { Notice, Platform, type App, type Menu } from 'obsidian'
import { NodeService } from '@/node/NodeService'
import { pathPages } from '@/node/NodePathClientPort'
import type { NodePathFileModel } from '@/node/NodePathModel'
import type { NodePathFileEditing } from '@/node/NodePathFileEditing'
import type { NodePathTabState } from '@/node/nodePathNavigation'
import { confirmDialog } from '@/components/obsidian/dialogs'

export interface NodeFileTabHost {
  addAction(icon: string, title: string, run: () => void): HTMLElement
  app(): App
  file(): NodePathFileModel | undefined
  editing(): NodePathFileEditing | undefined
  saved(): NodePathTabState | undefined
  act(run: () => Promise<unknown> | undefined): void
}

/**
 * A node file tab's header: the comparison switch, the neighbouring changed files and the
 * pencil; while editing, save (lit while there is something to save), discard the edits and the
 * lit pencil that stops editing. On a phone the same, less the comparison switch, in the tab's
 * own menu.
 */
export class NodeFileTabActions {
  private shown: HTMLElement[] = []
  constructor(private readonly host: NodeFileTabHost) {}
  /** Drawn again whenever editing starts, stops, gets dirty or locked. */
  render(): void {
    for (const el of this.shown) el.remove()
    this.shown = []
    const add = (icon: string, title: string, run: () => void, lit = false) => {
      const el = this.host.addAction(icon, title, run) as HTMLElement | undefined
      if (!el) return
      el.toggleClass('is-active', lit)
      this.shown.push(el)
    }
    const editing = this.host.editing()
    if (editing?.active.value) {
      add(
        'pencil',
        editing.dirty.value
          ? 'Stop editing; the edits stay until you save or discard them'
          : 'Stop editing',
        () => this.stop(),
        true
      )
      add('undo-2', 'Discard the edits', () => this.host.act(() => editing.discard()))
      if (editing.locked.value && this.host.saved()?.target.kind === 'worktree')
        add('lock', 'Allow saving in this worktree…', () => this.host.act(() => this.unlock()))
      add(
        'save',
        editing.dirty.value ? 'Save to the node · ⌘ S' : 'Nothing to save',
        () => this.host.act(() => editing.save()),
        editing.dirty.value
      )
      return
    }
    add('file-diff', 'Toggle whole file / comparison', () => {
      const file = this.host.file()
      if (file) file.mode.value = file.mode.value === 'diff' ? 'file' : 'diff'
    })
    if (Platform.isPhone) return
    add('chevron-left', 'Previous changed file', () => this.step(-1))
    add('chevron-right', 'Next changed file', () => this.step(1))
    add('pencil', 'Edit the file', () => this.start())
  }
  paneMenu(menu: Menu): void {
    const item = (title: string, icon: string, run: () => void, disabled = false) =>
      menu.addItem((i) => {
        i.setTitle(title).setIcon(icon).setSection('action').onClick(run)
        if (disabled) i.setDisabled(true)
      })
    item('Previous changed file', 'chevron-left', () => this.step(-1))
    item('Next changed file', 'chevron-right', () => this.step(1))
    const editing = this.host.editing()
    if (editing?.active.value) {
      item('Save', 'save', () => this.host.act(() => editing.save()), !editing.dirty.value)
      item('Discard the edits', 'undo-2', () => this.host.act(() => editing.discard()))
      item('Stop editing', 'pencil-off', () => this.stop())
    } else item('Edit the file', 'pencil', () => this.start())
  }
  step(by: 1 | -1): void {
    this.host.act(() => this.host.file()?.step(by))
  }
  start(): void {
    const doc = this.host.file()?.document.value,
      editing = this.host.editing()
    if (doc && editing) this.host.act(() => editing.start(doc.path))
  }
  /** Back to the file, read again so what was saved shows; unsaved edits wait in the draft. */
  stop(): void {
    this.host.editing()?.stop()
    const file = this.host.file(),
      doc = file?.document.value,
      state = this.host.saved()
    if (doc && file && state?.kind === 'file') this.host.act(() => file.open(doc.path, state.stage))
  }
  /** Opens (or closes) an external worktree to saves, asking the owner first. */
  async unlock(): Promise<void> {
    const state = this.host.saved(),
      editing = this.host.editing()
    if (state?.kind !== 'file' || state.target.kind !== 'worktree' || !editing) return
    const connection = NodeService.getInstance().connection(state.target.registrationId)
    const rows = await pathPages((cursor) =>
      connection.client.repository.worktrees({ project_id: state.target.projectId, cursor })
    )
    const row = rows.find((r) => r.worktree_id === state.target.id)
    if (!row || row.kind !== 'external') {
      new Notice('This is not an external worktree.')
      return
    }
    const enabled = editing.locked.value
    if (
      !(await confirmDialog({
        title: enabled ? 'Allow editing in this worktree?' : 'Turn off worktree editing?',
        message: enabled
          ? `Allow current files in ${row.path_label} to be saved by confirmed node owners? This grants neither chat scope nor agent execution.`
          : 'Stop new saves in this external worktree? Local drafts and unresolved evidence are kept.',
        confirmText: enabled ? 'Allow editing' : 'Turn off editing',
      }))
    )
      return
    await connection.client.repository.editing({ worktree_id: state.target.id, enabled })
    if (this.host.editing() === editing) await editing.unlock(enabled)
  }
}
