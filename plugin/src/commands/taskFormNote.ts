/**
 * Reading a task note into the task dialog, and writing the dialog back into it.
 */
import { createTask } from '@/commands/createTask'
import { DATE_FORMAT } from '@/constants/dates'
import {
  applyFrontmatterPatch,
  joinNoteBody,
  replaceNoteBody,
  splitNoteBody,
  taskFrontmatterPatch,
  taskValuesToCreateDTO,
  type TaskFormValues,
} from '@/helpers/entryForms'
import { getNoteBody } from '@/helpers/notesUtils'
import { parseDateOrNull } from '@/helpers/datesHelper'
import { getFileByPath } from '@/helpers/vaultUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { TFile } from 'obsidian'

/** The form's values for a task note as it is on disk. */
export async function loadTaskValues(path: string): Promise<TaskFormValues | null> {
  const { app } = GlobalStore.getInstance()
  const file = getFileByPath(path)
  if (!(file instanceof TFile)) return null
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {}
  const raw = await app.vault.read(file)
  const { title, description } = splitNoteBody(getNoteBody(raw))
  const day = (value: unknown) => parseDateOrNull(value as string)?.format(DATE_FORMAT) ?? null
  const time = (value: unknown) =>
    typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim()) ? value.trim() : null
  return {
    title,
    description,
    date: day(fm.date),
    time: time(fm.dateTime),
    due: day(fm.due),
    dueTime: time(fm.dueTime),
    recurrence: typeof fm.recurrence === 'string' ? fm.recurrence : null,
  }
}

/**
 * Writes the form. A new task goes through `createTask`, the same path the old button took, so
 * it lands where it always did and is named the same way. An existing one has its text and the
 * properties the form shows rewritten and every other property left alone. Answers the path of
 * the note, or null when nothing could be written.
 */
export async function saveTaskForm(values: TaskFormValues, path?: string): Promise<string | null> {
  const { app } = GlobalStore.getInstance()
  if (!path) {
    const created = await createTask(taskValuesToCreateDTO(values), false)
    return created?.task.taskPath ?? null
  }
  const file = getFileByPath(path)
  if (!(file instanceof TFile)) return null
  await app.vault.process(file, (raw) =>
    replaceNoteBody(raw, joinNoteBody(values.title, values.description))
  )
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) =>
    applyFrontmatterPatch(fm, taskFrontmatterPatch(values))
  )
  return file.path
}
