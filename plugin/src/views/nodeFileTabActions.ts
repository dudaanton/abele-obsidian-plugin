import { canEditNodeFile } from '@/node/fileEditContext'
import { t } from '@/i18n'
import { nodeActionError } from '@/node/errorWords'
import { presentUiError } from '@/i18n/streamBErrors'
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
      const el = this.host.addAction(icon, title, run)
      if (!el) return
      el.toggleClass('is-active', lit)
      this.shown.push(el)
    }
    const editing = this.host.editing()
    if (editing?.active.value) {
      add(
        'pencil',
        editing.dirty.value ? t('streamBMeta.239735d1f5') : t('streamB.stopEditing.ec8404'),
        () => this.stop(),
        true
      )
      add('undo-2', t('streamBMeta.8357152356'), () => this.host.act(() => editing.discard()))
      if (editing.locked.value && this.host.saved()?.target.kind === 'worktree')
        add('lock', t('streamBMeta.9df4bdb9e7'), () => this.host.act(() => this.unlock()))
      add(
        'save',
        editing.locked.value
          ? t('node.files.saveLocked')
          : editing.dirty.value
            ? t('streamBMeta.dc0210c641')
            : t('streamBMeta.de2bbb30c1'),
        () => this.host.act(() => editing.save()),
        editing.dirty.value
      )
      return
    }
    add('file-diff', t('streamBMeta.a6c485d8de'), () => {
      const file = this.host.file()
      if (file) file.mode.value = file.mode.value === 'diff' ? 'file' : 'diff'
    })
    if (Platform.isPhone) return
    add('chevron-left', t('streamBMeta.55f8f16499'), () => this.step(-1))
    add('chevron-right', t('streamBMeta.123245f14b'), () => this.step(1))
    if (this.canEdit()) add('pencil', t('streamBMeta.de780488d5'), () => this.start())
  }
  paneMenu(menu: Menu): void {
    const item = (title: string, icon: string, run: () => void, disabled = false) =>
      menu.addItem((i) => {
        i.setTitle(title).setIcon(icon).setSection('action').onClick(run)
        if (disabled) i.setDisabled(true)
      })
    item(t('streamBMeta.55f8f16499'), 'chevron-left', () => this.step(-1))
    item(t('streamBMeta.123245f14b'), 'chevron-right', () => this.step(1))
    const editing = this.host.editing()
    if (editing?.active.value) {
      item(
        t('streamB.save.1509f5'),
        'save',
        () => this.host.act(() => editing.save()),
        !editing.dirty.value
      )
      item(t('streamBMeta.8357152356'), 'undo-2', () => this.host.act(() => editing.discard()))
      item(t('streamB.stopEditing.ec8404'), 'pencil-off', () => this.stop())
    } else if (this.canEdit()) item(t('streamBMeta.de780488d5'), 'pencil', () => this.start())
  }
  private canEdit(): boolean {
    const state = this.host.saved()
    return canEditNodeFile(
      this.host.file()?.document.value,
      state?.kind === 'file' ? state.stage : undefined
    )
  }
  step(by: 1 | -1): void {
    this.host.act(() => this.host.file()?.step(by))
  }
  start(): void {
    const doc = this.host.file()?.document.value,
      editing = this.host.editing()
    const state = this.host.saved()
    if (doc && editing && canEditNodeFile(doc, state?.kind === 'file' ? state.stage : undefined))
      this.host.act(async () => {
        await editing.start(doc.path)
        if (editing.locked.value) await this.unlock()
      })
  }
  /** Back to the file, read again so what was saved shows; unsaved edits wait in the draft. */
  stop(): void {
    this.host.editing()?.stop()
    const file = this.host.file(),
      doc = file?.document.value,
      state = this.host.saved()
    if (doc && file && state?.kind === 'file')
      this.host.act(async () => {
        try {
          await file.open(doc.path, state.stage)
        } catch (error) {
          const failure = nodeActionError(error, 'Read')
          file.error.value = presentUiError(failure)
          throw failure
        }
      })
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
      new Notice(t('streamBMeta.97ca175fd0'))
      return
    }
    const enabled = editing.locked.value
    if (
      !(await confirmDialog({
        title: enabled
          ? t('streamB.allowEditingInThisWorktree.0b5778')
          : t('streamB.turnOffWorktreeEditing.6f96b7'),
        message: enabled
          ? t('streamBMeta.68f7375d89', { v0: row.path_label })
          : t('streamBMeta.d71ef981e2'),
        confirmText: enabled
          ? t('streamB.allowEditing.8195ed')
          : t('streamB.turnOffEditing.b065b8'),
      }))
    )
      return
    await connection.client.repository.editing({ worktree_id: state.target.id, enabled })
    if (this.host.editing() === editing) await editing.unlock(enabled)
  }
}
