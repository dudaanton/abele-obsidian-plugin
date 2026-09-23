import { computed, ref, watch } from 'vue'
import { Menu } from 'obsidian'
import { labelKey } from '@/helpers/taskMeta'

/** What the filter is set to: every task, only tasks without a label, or one label by key. */
export type LabelSelection = { kind: 'all' } | { kind: 'none' } | { kind: 'label'; key: string }

export interface LabelOption {
  key: string
  /** The first spelling met in the list, which is the one shown. */
  label: string
  count: number
}

/**
 * Narrows a task list to one label.
 *
 * The labels on offer are collected from the list it is given — the tasks already in memory
 * for this sidebar or footer — so opening the menu never reads the vault. A label that stops
 * appearing in the list (its last task was completed, or relabelled) drops the filter back to
 * everything rather than leaving an empty list behind a choice nobody can see any more.
 */
export function useLabelFilter<T extends { labels: string[] }>(source: () => readonly T[]) {
  const selected = ref<LabelSelection>({ kind: 'all' })

  const options = computed<LabelOption[]>(() => {
    const byKey = new Map<string, LabelOption>()
    for (const task of source()) {
      for (const label of task.labels) {
        const key = labelKey(label)
        const option = byKey.get(key)
        if (option) option.count++
        else byKey.set(key, { key, label, count: 1 })
      }
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label))
  })

  const unlabelledCount = computed(() => source().filter((t) => t.labels.length === 0).length)

  watch(options, (next) => {
    const current = selected.value
    if (current.kind === 'label' && !next.some((o) => o.key === current.key)) {
      selected.value = { kind: 'all' }
    }
  })

  const filtered = computed<T[]>(() => {
    const current = selected.value
    const all = source()
    if (current.kind === 'all') return [...all]
    if (current.kind === 'none') return all.filter((t) => t.labels.length === 0)
    return all.filter((t) => t.labels.some((label) => labelKey(label) === current.key))
  })

  /** Shown beside the filter's icon; empty while everything is shown. */
  const selectedText = computed(() => {
    const current = selected.value
    if (current.kind === 'none') return 'No label'
    if (current.kind === 'label') return options.value.find((o) => o.key === current.key)?.label
    return ''
  })

  const isSelected = (selection: LabelSelection): boolean => {
    const current = selected.value
    if (current.kind !== selection.kind) return false
    return current.kind !== 'label' || current.key === (selection as { key: string }).key
  }

  const select = (selection: LabelSelection): void => {
    selected.value = selection
  }

  /** Obsidian's own menu, with a tick on whatever is chosen now. */
  const openMenu = (event: MouseEvent): Menu => {
    const menu = new Menu()
    const add = (title: string, selection: LabelSelection) =>
      menu.addItem((item) => {
        item.setTitle(title).onClick(() => select(selection))
        if (isSelected(selection)) item.setIcon('check')
      })

    add('All labels', { kind: 'all' })
    menu.addSeparator()
    for (const option of options.value) {
      add(`${option.label} (${option.count})`, { kind: 'label', key: option.key })
    }
    if (unlabelledCount.value > 0) {
      menu.addSeparator()
      add(`No label (${unlabelledCount.value})`, { kind: 'none' })
    }
    menu.showAtMouseEvent(event)
    return menu
  }

  return { options, selected, filtered, selectedText, select, openMenu }
}
