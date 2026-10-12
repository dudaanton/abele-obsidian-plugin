import type { Task } from '@/entities/Task'
import { buildTaskTree, parentsClosedBy, parentsReopenedBy } from '@/helpers/taskTree'
import { GlobalStore } from '@/stores/GlobalStore'
import { getEditorForFile, getFileByPath } from '@/helpers/vaultUtils'
import { parseNoteContent } from '@/helpers/notesUtils'
import { TaskNoteTemplate } from '@/templates/TaskNoteTemplate'
import { DATE_FORMAT } from '@/constants/dates'

export const AUTO_COMPLETED = 'abeleAutoCompleted'

/** Persist only the completion fields; an open parent's unsaved body stays in its editor. */
export async function completeTaskParents(task: Task) {
  const { app, tasksList } = GlobalStore.getInstance()
  // The header uses a temporary entity; keep the indexed copy current before its watcher runs.
  const indexed = tasksList.value?.tasks.get(task.taskPath)
  if (indexed && indexed !== task) {
    indexed.completedAt = task.completedAt
    delete indexed.oldProps[AUTO_COMPLETED]
  }
  const all = [...(tasksList.value?.tasks.values() ?? [])].filter(
    (t) => t.taskPath !== task.taskPath
  )
  all.push(task)
  const nodes = all.map((t) => ({
    path: t.taskPath,
    groups: t.groups,
    done: !!t.completedAt,
    task: t,
  }))
  const tree = buildTaskTree(nodes, nodes)
  const current = nodes[nodes.length - 1]
  const parents = task.completedAt
    ? parentsClosedBy(tree, current, (n) => n.done)
    : parentsReopenedBy(
        tree,
        current,
        (n) => n.done,
        (n) => n.task.oldProps[AUTO_COMPLETED] === n.task.completedAt?.format(DATE_FORMAT)
      )
  for (const node of parents) {
    const parent = node.task
    const file = getFileByPath(parent.taskPath)
    if (!file) return
    const completed = task.completedAt
    let changed = false
    const update = (fm: Record<string, unknown>) => {
      // Recheck persisted provenance: the index may still describe an older completion.
      if (completed ? !!fm.completed : !fm.completed || fm[AUTO_COMPLETED] !== fm.completed) return
      changed = true
      if (completed) {
        fm.completed = completed.format(DATE_FORMAT)
        fm[AUTO_COMPLETED] = fm.completed
      } else {
        delete fm.completed
        delete fm[AUTO_COMPLETED]
      }
    }
    const editor = getEditorForFile(file)
    if (editor) {
      const note = await parseNoteContent(file, editor.getValue())
      update(note)
      if (changed)
        editor.setValue(
          new TaskNoteTemplate(app).createTemplate({
            oldProps: { ...note, content: undefined },
            content: note.content,
          })
        )
    } else {
      await app.fileManager.processFrontMatter(file, update)
    }
    if (!changed) return
    parent.completedAt = completed
    if (completed) {
      parent.oldProps.completed = completed.format(DATE_FORMAT)
      parent.oldProps[AUTO_COMPLETED] = parent.oldProps.completed
    } else {
      delete parent.oldProps.completed
      delete parent.oldProps[AUTO_COMPLETED]
    }
    console.debug('[Abele tasks] parent completion', parent.taskPath, !!completed)
  }
}
