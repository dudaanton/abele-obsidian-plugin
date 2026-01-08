import { Task, TaskCreateDTO } from '@/entities/Task'
import { cleanFileName, pathToWikilink } from '@/helpers/pathsHelpers'
import dayjs from 'dayjs'
import { createTaskEmbedded, getNewTaskPathFromString } from '@/helpers/tasksUtils'
import { getAvailablePath } from '@/helpers/vaultUtils'
import { Editor, Notice } from 'obsidian'

const DEFAULT_TASK_NAME = 'New Task'

export const createTask = async (
  data?: TaskCreateDTO,
  focus = true
): Promise<{ task: Task; wikilink: string }> => {
  console.log(data)
  const availablePath = await getAvailablePath(
    getNewTaskPathFromString(data?.title ?? DEFAULT_TASK_NAME)
  )
  if (!availablePath) {
    new Notice('Failed to determine available path for the new task.', 3000)
    return
  }

  const wikilink = pathToWikilink(availablePath)

  let taskModel: Task

  if (data) {
    taskModel = new Task({ ...data, createdAt: data.createdAt ?? dayjs(), id: '', wikilink })
  } else {
    taskModel = new Task({ id: '', wikilink, createdAt: dayjs() })
  }

  await taskModel.writeTaskToFile(focus)

  return { task: taskModel, wikilink }
}

export const createTaskAndInsert = async (editor: Editor) => {
  if (!editor) {
    new Notice('No active markdown editor found.', 3000)
    return
  }

  const cursor = editor.getCursor()
  const shouldCreateNewLine = cursor.ch > 0
  const selection = editor.getSelection()

  const availablePath = await getAvailablePath(
    getNewTaskPathFromString(cleanFileName(selection) || DEFAULT_TASK_NAME)
  )
  if (!availablePath) {
    new Notice('Failed to determine available path for the new task.', 3000)
    return
  }

  const wikilink = pathToWikilink(availablePath)

  const taskEmbedded = `${shouldCreateNewLine ? '\n' : ''}${createTaskEmbedded(wikilink)}\n`

  if (selection) {
    editor.replaceSelection(taskEmbedded)
  } else {
    // If no selection, just insert the linkPath at the cursor position
    editor.replaceRange(taskEmbedded, cursor)
  }

  // setting cursor to the beginning of the next line
  editor.setSelection({ line: cursor.line + (shouldCreateNewLine ? 2 : 1), ch: 0 })

  const taskModel = new Task({ id: '', wikilink, createdAt: dayjs() })
  if (selection) {
    taskModel.title = selection.split('\n')[0] || DEFAULT_TASK_NAME
    taskModel.description = selection.split('\n').slice(1).join('\n') || ''
    taskModel.content = selection
  }

  return taskModel.writeTaskToFile(true)
}
