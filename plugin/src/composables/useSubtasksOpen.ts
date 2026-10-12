// Which tasks show their subtasks, kept on this device across lists and restarts: a task opened in
// the sidebar is open under its note too.
import { reactive } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'

const KEY = 'abele-subtasks-open'
let open: Set<string> | null = null

function load(): Set<string> {
  if (open) return open
  const saved = GlobalStore.getInstance().app?.loadLocalStorage?.(KEY) as unknown
  open = reactive(new Set(Array.isArray(saved) ? saved.filter((p) => typeof p === 'string') : []))
  return open
}

export function useSubtasksOpen() {
  const set = load()
  return {
    isOpen: (path: string) => set.has(path),
    set(path: string, value: boolean) {
      if (value) set.add(path)
      else set.delete(path)
      GlobalStore.getInstance().app?.saveLocalStorage?.(KEY, [...set])
    },
  }
}

/** Forgets what was read. For tests. */
export function resetSubtasksOpen() {
  open = null
}
