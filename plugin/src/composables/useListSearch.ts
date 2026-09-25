import { computed, onScopeDispose, ref, toRaw, watch, type ComputedRef, type Ref } from 'vue'
import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { getNoteBody } from '@/helpers/notesUtils'
import { matchesTerms, searchTerms } from '@/helpers/listSearch'
import type { Task } from '@/entities/Task'
import type { Log } from '@/entities/Log'

/** How long typing has to pause before the list is filtered again. */
export const SEARCH_DELAY_MS = 200

/** Notes read at once while the search text is gathered, so a large list never floods the disk. */
const READ_BATCH = 50

export interface ListSearchOptions<T> {
  /** The note an entry lives in; its body is what the search reads. */
  pathOf: (item: T) => string
  /**
   * The text an entry is searched by. `body` is the note without its properties, or `null`
   * while it has not been read yet — the entry then answers from what it holds in memory.
   */
  textOf: (item: T, body: string | null) => string
  delay?: number
}

export interface ListSearch<T> {
  /** Whether the field is showing. */
  open: Ref<boolean>
  /** What is typed, as it is typed. */
  query: Ref<string>
  /** The words the list is filtered by: the query once typing has paused, none while closed. */
  terms: ComputedRef<string[]>
  /** The entries that match — the whole source while nothing is searched for. */
  results: ComputedRef<T[]>
  toggle: () => void
  close: () => void
}

interface Indexed {
  mtime: number
  text: string
}

/**
 * Narrows a list to the entries whose title or text holds every word typed.
 *
 * The lists it serves page — twenty entries mounted at a time — and an entry reads its note only
 * once it is on screen, so neither what is rendered nor what the entries hold covers the list.
 * The search therefore reads every note in the source itself, once, when the field opens, and
 * keeps the text keyed by the note's modification time: typing filters that in memory, and only
 * a note that changed since is read again. Reads go through Obsidian's `cachedRead`, which a
 * note already open or recently read answers from memory.
 */
export function useListSearch<T extends object>(
  source: () => readonly T[],
  options: ListSearchOptions<T>
): ListSearch<T> {
  const open = ref(false)
  const query = ref('')
  // Its own timer rather than a debounced ref: closing has to clear the words at once, or a
  // field reopened straight away would come back filtering by the old query.
  const settled = ref('')
  let timer: number | undefined
  watch(query, (value) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => (settled.value = value), options.delay ?? SEARCH_DELAY_MS)
  })
  onScopeDispose(() => window.clearTimeout(timer))
  const terms = computed(() => (open.value ? searchTerms(settled.value) : []))

  const index = new WeakMap<object, Indexed>()
  /** Bumped when a batch of notes has been read, so the results are worked out again. */
  const revision = ref(0)

  const textOf = (item: T): string => {
    const hit = index.get(toRaw(item))
    return hit ? hit.text : options.textOf(item, null).toLowerCase()
  }

  const results = computed<T[]>(() => {
    const all = source()
    const words = terms.value
    if (!words.length) return [...all]
    void revision.value
    return all.filter((item) => matchesTerms(textOf(item), words))
  })

  let run = 0
  const gather = async (): Promise<void> => {
    const current = ++run
    const { app } = GlobalStore.getInstance()
    const stale: Array<[T, TFile]> = []
    for (const item of source()) {
      const file = app.vault.getAbstractFileByPath(options.pathOf(item))
      if (!(file instanceof TFile)) continue
      if (index.get(toRaw(item))?.mtime !== file.stat.mtime) stale.push([item, file])
    }

    for (let at = 0; at < stale.length; at += READ_BATCH) {
      const batch = stale.slice(at, at + READ_BATCH)
      const bodies = await Promise.all(
        batch.map(([, file]) => app.vault.cachedRead(file).catch((): null => null))
      )
      // A newer pass has started — the list or the notes changed; its reads replace these.
      if (current !== run) return
      batch.forEach(([item, file], i) => {
        const raw = bodies[i]
        if (raw === null || raw === undefined) return
        const text = options.textOf(item, getNoteBody(raw)).toLowerCase()
        index.set(toRaw(item), { mtime: file.stat.mtime, text })
      })
      revision.value++
    }
  }

  // Gathered on opening, so the first word typed is answered at once, and looked over again on
  // every new query and every change to the list: comparing modification times is cheap, and it
  // is what brings a note edited while the field was open back into the search.
  watch(
    [open, terms, () => source()],
    () => {
      if (open.value) void gather()
    },
    { immediate: true }
  )

  const close = (): void => {
    open.value = false
    query.value = ''
    window.clearTimeout(timer)
    settled.value = ''
    run++
  }

  const toggle = (): void => {
    if (open.value) close()
    else open.value = true
  }

  return { open, query, terms, results, toggle, close }
}

/** A task is found by its note's name, its title and its description — the whole body. */
export const taskSearch: ListSearchOptions<Task> = {
  pathOf: (task) => task.taskPath,
  textOf: (task, body) => `${task.taskName}\n${body ?? `${task.title}\n${task.description}`}`,
}

/** A log is found by its name and by what it says about the note whose list it is in. */
export const logSearch: ListSearchOptions<Log> = {
  pathOf: (log) => log.filePath,
  textOf: (log, body) =>
    `${log.name}\n${body === null ? (log.content ?? '') : log.relatedText(body)}`,
}
