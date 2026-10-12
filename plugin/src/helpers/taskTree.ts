/**
 * Subtasks without anything new in a note: a task is a subtask of every task named among its
 * groups. A list shows each subtask under its parent rather than beside it; a parent that is not
 * in the list leaves its subtask at the top, named in a quiet line. Groups can be written into a
 * circle by hand; the tasks in one stand flat, each told so, and close nothing on their own.
 *
 * Nothing here reaches for Obsidian: a task is its path and what its groups say.
 */

export interface TreeNode {
  /** The note's path, `Tasks/Mount the station.md`. */
  path: string
  /** Its groups as written: wikilinks, paths or names. */
  groups: readonly string[]
  done: boolean
}

export interface TaskTree<T extends TreeNode> {
  /** What a list shows at its top, in the order it was given. */
  roots: T[]
  /** A task's subtasks among those shown, in the given order. */
  children: Map<T, T[]>
  /** A task's subtasks among all tasks, whether or not the list shows them. */
  subtasks: Map<T, T[]>
  /** The parents of a task among all tasks, outside any circle. */
  parents: Map<T, T[]>
  /** A task caught in a circle of groups, with the others in that circle. */
  circular: Map<T, T[]>
}

/** `[[Tasks/Mount|Mount]]`, `Tasks/Mount.md` and `Mount` all name the same note. */
function key(link: string): string {
  return link
    .trim()
    .replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    .replace(/\.md$/i, '')
    .trim()
    .toLowerCase()
}
const base = (k: string) => k.split('/').pop()

/** Whether a group as written names this note: by its path, or by its name alone. */
export function namesNote(link: string, path: string): boolean {
  const k = key(link)
  const p = key(path)
  return k === p || (!k.includes('/') && k === base(p))
}

/**
 * The tree of `shown` within `all`: `all` decides who is whose subtask and how many there are,
 * `shown` (a filtered, sorted list) what is drawn and in which order.
 */
export function buildTaskTree<T extends TreeNode>(
  shown: readonly T[],
  all: readonly T[]
): TaskTree<T> {
  const byPath = new Map<string, T>()
  const byName = new Map<string, T[]>()
  for (const t of all) {
    const k = key(t.path)
    byPath.set(k, t)
    byName.set(base(k), [...(byName.get(base(k)) ?? []), t])
  }
  /** A group names a task by its path, or by a name only one task has. */
  const resolve = (link: string): T | undefined => {
    const k = key(link)
    const named = byName.get(base(k))
    return byPath.get(k) ?? (k.includes('/') || named?.length !== 1 ? undefined : named[0])
  }

  const raw = new Map<T, T[]>()
  for (const t of all) {
    const ps = [...new Set(t.groups.map(resolve).filter((p): p is T => !!p))]
    raw.set(t, ps)
  }

  // Circles: the strongly connected parts of the parent graph larger than one task, and a task
  // in its own groups. Tarjan, without recursion, so a long chain cannot overflow the stack.
  const circular = new Map<T, T[]>()
  const index = new Map<T, number>()
  const low = new Map<T, number>()
  const stack: T[] = []
  const onStack = new Set<T>()
  let next = 0
  for (const start of all) {
    if (index.has(start)) continue
    const work: { node: T; edge: number }[] = [{ node: start, edge: 0 }]
    index.set(start, next)
    low.set(start, next++)
    stack.push(start)
    onStack.add(start)
    while (work.length) {
      const frame = work[work.length - 1]
      const edges = raw.get(frame.node)
      if (frame.edge < edges.length) {
        const to = edges[frame.edge++]
        if (!index.has(to)) {
          index.set(to, next)
          low.set(to, next++)
          stack.push(to)
          onStack.add(to)
          work.push({ node: to, edge: 0 })
        } else if (onStack.has(to))
          low.set(frame.node, Math.min(low.get(frame.node), index.get(to)))
        continue
      }
      work.pop()
      if (work.length) {
        const up = work[work.length - 1].node
        low.set(up, Math.min(low.get(up), low.get(frame.node)))
      }
      if (low.get(frame.node) !== index.get(frame.node)) continue
      const part: T[] = []
      let t: T
      do {
        t = stack.pop()!
        onStack.delete(t)
        part.push(t)
      } while (t !== frame.node)
      const self = part.length === 1 && raw.get(part[0]).includes(part[0])
      if (part.length > 1 || self)
        for (const m of part) circular.set(m, part.length > 1 ? part.filter((o) => o !== m) : [m])
    }
  }

  // A circle is shown flat: links inside one are not followed.
  const parents = new Map<T, T[]>()
  const subtasks = new Map<T, T[]>()
  for (const t of all) {
    const ps = raw.get(t).filter((p) => !circular.get(t)?.includes(p))
    parents.set(t, ps)
    for (const p of ps) subtasks.set(p, [...(subtasks.get(p) ?? []), t])
  }

  const visible = new Set(shown)
  const children = new Map<T, T[]>()
  const roots: T[] = []
  for (const t of shown) {
    const under = parents.get(t)?.filter((p) => visible.has(p)) ?? []
    if (!under.length) roots.push(t)
    for (const p of under) children.set(p, [...(children.get(p) ?? []), t])
  }
  return { roots, children, subtasks, parents, circular }
}

/** Done of all, for a parent's code: `2/5`. */
export function progressOf<T extends TreeNode>(tree: TaskTree<T>, task: T) {
  const all = tree.subtasks.get(task) ?? []
  return all.length ? { done: all.filter((t) => t.done).length, total: all.length } : null
}

/**
 * The parents a tick closes: each one whose subtasks are now all done, and on up, never through
 * a circle. Unticking opens again the ones that were closed this way.
 */
export function parentsClosedBy<T extends TreeNode>(
  tree: TaskTree<T>,
  task: T,
  isDone: (t: T) => boolean
): T[] {
  const closed: T[] = []
  const walk = (t: T) => {
    if (tree.circular.has(t)) return
    for (const p of tree.parents.get(t) ?? []) {
      if (tree.circular.has(p) || isDone(p) || closed.includes(p)) continue
      const subs = tree.subtasks.get(p) ?? []
      if (subs.every((s) => !tree.circular.has(s) && (isDone(s) || closed.includes(s)))) {
        closed.push(p)
        walk(p)
      }
    }
  }
  walk(task)
  return closed
}

/** Reopen only ancestors whose current completion was automatic, never through a circle. */
export function parentsReopenedBy<T extends TreeNode>(
  tree: TaskTree<T>,
  task: T,
  isDone: (t: T) => boolean,
  isAutomatic: (t: T) => boolean
): T[] {
  const opened: T[] = []
  const walk = (t: T) => {
    if (tree.circular.has(t)) return
    for (const p of tree.parents.get(t) ?? []) {
      if (tree.circular.has(p) || !isDone(p) || !isAutomatic(p) || opened.includes(p)) continue
      if ((tree.subtasks.get(p) ?? []).some((s) => !isDone(s) || opened.includes(s))) {
        opened.push(p)
        walk(p)
      }
    }
  }
  walk(task)
  return opened
}
