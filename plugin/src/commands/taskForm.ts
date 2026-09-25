/**
 * The task dialog: what opens it, what it loads and how it saves.
 *
 * A task is still a note, and a note written by hand with `type: task` is still a task. The
 * dialog is only the way in from the plugin's own add and edit buttons. Where Obsidian's note
 * editor cannot be borrowed (see `editor/embeddedEditor.ts`) those buttons do what they did
 * before the dialog existed: create the note and open it.
 */
import { createTask } from '@/commands/createTask'
import TaskFormModal from '@/components/TaskFormModal.vue'
import { isEmbeddedEditorAvailable } from '@/editor/embeddedEditor'
import { emptyTaskValues, taskValuesToCreateDTO, type TaskFormValues } from '@/helpers/entryForms'
import { mountDialog } from '@/helpers/mountDialog'
import { openFile } from '@/helpers/vaultUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { loadTaskValues } from './taskFormNote'

export interface TaskFormOptions {
  /** The task note to edit; none for a new task. */
  path?: string
  /** What a new task starts with — a day picked in the calendar. */
  defaults?: Partial<TaskFormValues>
}

/**
 * Opens the task dialog — for a new task, or for the one at `path`. Without Obsidian's editor
 * to put in it, the note itself is opened instead, as before.
 */
export async function openTaskForm(options: TaskFormOptions = {}): Promise<void> {
  const { app } = GlobalStore.getInstance()
  if (!isEmbeddedEditorAvailable(app)) {
    if (options.path) {
      await openFile(options.path)
    } else {
      await createTask(taskValuesToCreateDTO({ ...emptyTaskValues(), ...options.defaults }))
    }
    return
  }

  let initial: TaskFormValues = { ...emptyTaskValues(), ...options.defaults }
  if (options.path) {
    const loaded = await loadTaskValues(options.path)
    if (!loaded) {
      await openFile(options.path)
      return
    }
    initial = loaded
  }

  mountDialog(TaskFormModal, { path: options.path, initial })
}
