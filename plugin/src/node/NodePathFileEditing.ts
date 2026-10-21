import { computed, markRaw, shallowRef } from 'vue'
import type { NodeFilesModel } from './NodeFilesModel'
import type { PathTarget } from './NodePathModel'

type Editor = Pick<
  NodeFilesModel,
  | 'editing'
  | 'draftText'
  | 'document'
  | 'fileEditable'
  | 'draftDirty'
  | 'openFile'
  | 'beginEditing'
  | 'saveFile'
  | 'discardDraft'
>

/**
 * Editing a node file in the tab that shows it: start, save, discard the edits, stop. The draft
 * lives on this device until it is saved or discarded, so stopping keeps it for the next start.
 * Saves go only where the node allows them; an external worktree needs the owner's approval.
 */
export class NodePathFileEditing {
  /** The tab shows the editor rather than the file. */
  readonly active = shallowRef(false)
  /** The node refuses saves here until the owner opens the worktree to them. */
  readonly locked = shallowRef(false)
  readonly editor = shallowRef<Editor>()
  readonly dirty = computed(() => !!this.editor.value?.draftDirty.value)
  private path = ''
  constructor(
    readonly target: PathTarget,
    private readonly make: () => Editor,
    private readonly allowed: () => Promise<boolean>
  ) {
    markRaw(this)
  }
  async start(path: string): Promise<void> {
    let editor = this.editor.value
    if (!editor) editor = this.editor.value = this.make()
    if (path !== this.path || (!this.active.value && !this.dirty.value)) {
      await editor.openFile(path)
      this.path = path
    }
    this.active.value = true
    this.locked.value = !(await this.allowed())
    if (!this.locked.value && editor.fileEditable.value && !editor.editing.value)
      await editor.beginEditing()
  }
  /** Leaves the editor; the edits stay until saved or discarded. */
  stop(): void {
    this.active.value = false
  }
  async refresh(): Promise<void> {
    const editor = this.editor.value
    if (!this.active.value || !editor || !this.path) return
    await editor.openFile(this.path)
    if (
      this.active.value &&
      !this.locked.value &&
      editor.fileEditable.value &&
      !editor.editing.value
    )
      await editor.beginEditing()
  }
  async save(): Promise<void> {
    const editor = this.editor.value
    if (!editor || this.locked.value || !this.dirty.value) return
    await editor.saveFile()
  }
  /** Drops the edits and goes on editing the file as it is. */
  async discard(): Promise<void> {
    const editor = this.editor.value
    if (!editor) return
    await editor.discardDraft()
    if (this.active.value && !this.locked.value && editor.fileEditable.value)
      await editor.beginEditing()
  }
  /** The owner opened (or closed) the worktree to saves from the tab's header. */
  async unlock(enabled: boolean): Promise<void> {
    this.locked.value = !enabled
    const editor = this.editor.value
    if (enabled && this.active.value && editor?.fileEditable.value && !editor.editing.value)
      await editor.beginEditing()
  }
}
