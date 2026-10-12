// Making and unmaking subtasks: a parent is a task named among a task's groups, so each of these
// writes one link into, or out of, the `groups` property of one task note.
import { Notice, TFile } from 'obsidian'
import type { Task } from '@/entities/Task'
import { GlobalStore } from '@/stores/GlobalStore'
import { pathToWikilink } from '@/helpers/pathsHelpers'
import { buildTaskTree, namesNote, type TaskTree, type TreeNode } from '@/helpers/taskTree'
import { NodeSuggestModal } from '@/components/nodeWork/NodeSuggestModal'
import { createTask } from './createTask'

export interface TaskNode extends TreeNode {
  task: Task
}

export const nodeOf = (task: Task): TaskNode => ({
  path: task.taskPath,
  groups: task.groups,
  done: !!task.completedAt,
  task,
})

/**
 * The tree over every task the vault knows, and the node of a task in it. Tasks are matched by
 * their note, not by object: a list may hold a reactive copy of the task the store has.
 */
export function treeOf(shown: Task[], all: Task[]) {
  const nodes = new Map<string, TaskNode>()
  for (const t of [...all, ...shown]) if (!nodes.has(t.taskPath)) nodes.set(t.taskPath, nodeOf(t))
  const tree = buildTaskTree(
    shown.map((t) => nodes.get(t.taskPath)),
    [...nodes.values()]
  )
  return { tree, node: (t: Task) => nodes.get(t.taskPath) }
}

const nameOf = (task: Task) => task.title || task.taskName

async function editGroups(task: Task, change: (groups: string[]) => string[]) {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(task.taskPath)
  if (!(file instanceof TFile)) return
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    const groups = Array.isArray(fm.groups) ? (fm.groups as string[]) : []
    const next = change(groups)
    if (next.length) fm.groups = next
    else delete fm.groups
  })
}

/** A new task under the task note at this path, opened to be named. */
export async function addSubtask(parentPath: string) {
  await createTask({ oldProps: { groups: [pathToWikilink(parentPath)] } })
}

/** Done of all the subtasks of the task note at this path, or null when it has none. */
export function subtasksOfPath(path: string, all: Task[]) {
  const subs = all.filter((t) => t.taskPath !== path && t.groups.some((g) => namesNote(g, path)))
  return subs.length ? { done: subs.filter((t) => t.completedAt).length, total: subs.length } : null
}

/** Everything under a task, so it is never offered as its own parent. */
function below(tree: TaskTree<TaskNode>, top: TaskNode): Set<TaskNode> {
  const seen = new Set<TaskNode>([top])
  const walk = (n: TaskNode) => {
    for (const s of tree.subtasks.get(n) ?? []) {
      if (!seen.has(s)) {
        seen.add(s)
        walk(s)
      }
    }
  }
  walk(top)
  return seen
}

/** Picks a parent in the quick switcher; the task itself and its subtasks are not offered. */
export function makeSubtaskOf(task: Task, all: Task[]) {
  const { tree, node } = treeOf([task], all)
  const out = below(tree, node(task))
  const already = new Set(tree.parents.get(node(task)) ?? [])
  const seen = new Set<string>()
  const offered = all.filter((t) => {
    if (seen.has(t.taskPath)) return false
    seen.add(t.taskPath)
    return !out.has(node(t)) && !already.has(node(t)) && !t.taskNotFound
  })
  new NodeSuggestModal(
    GlobalStore.getInstance().app,
    offered.map((t) => ({
      id: t.taskPath,
      icon: t.completedAt ? 'circle-check' : 'circle',
      kind: t.completedAt ? 'Done' : 'Open',
      title: nameOf(t),
      note: t.taskFolder || undefined,
    })),
    'Make a subtask of…',
    (picked) => {
      const parent = offered.find((t) => t.taskPath === picked.id)
      if (!parent) return
      void editGroups(task, (groups) => [...groups, pathToWikilink(parent.taskPath)])
    },
    'No task to put it under'
  ).open()
}

/** Takes the link to one parent out of the task's groups. */
export async function detachFrom(task: Task, parent: Task) {
  await editGroups(task, (groups) => groups.filter((g) => !namesNote(g, parent.taskPath)))
  new Notice(`${nameOf(task)} is no longer a subtask of ${nameOf(parent)}`)
}
