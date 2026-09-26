import { computed, ref, unref, watch, onUnmounted, Ref, ComputedRef } from 'vue'
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { TimeEntry } from '@/entities/TimeEntry'
import { TimeEntryList } from '@/entities/TimeEntryList'
import { AbeleConfig } from '@/services/AbeleConfig'
import { createTimeEntry, stopActiveTimeEntry } from '@/commands/createTimeEntry'
import { pathToWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'

/** Whether one of the running time entries is for this note — has it among its groups. */
export function timerActiveFor(filePath: string, entries: readonly TimeEntry[]): boolean {
  return !!entryFor(filePath, entries)
}

function entryFor(filePath: string, entries: readonly TimeEntry[]): TimeEntry | undefined {
  const basename = filePath.replace(/\.md$/, '').split('/').pop() || ''
  const pathNoExt = filePath.replace(/\.md$/, '')
  return entries.find((entry) =>
    entry.groups.some((g) => {
      const linkPath = wikilinkToPath(g)
      return linkPath === basename || linkPath === pathNoExt
    })
  )
}

/** Starts a timer for this note, or stops the running one. */
export function toggleTimerFor(filePath: string, active: boolean): void {
  if (active) {
    void stopActiveTimeEntry()
  } else {
    void createTimeEntry({ groups: [pathToWikilink(filePath)] }, false)
  }
}

/**
 * Provides state and handlers for a Start/Stop Timer button bound to the given file path.
 * The button is "active" when the global active time entry has this file in its groups.
 */
export function useTimerButton(
  filePath: Ref<string> | ComputedRef<string>,
  noteType: Ref<string | null> | ComputedRef<string | null>
) {
  const store = GlobalStore.getInstance()

  const showTimerButton = computed(() => {
    if (noteType.value === 'time-entry') return false
    return AbeleConfig.getInstance().isTimeTrackable(noteType.value)
  })

  const timeEntryList = computed(() => unref(store.timeEntryList) as TimeEntryList | null)

  const activeEntries = computed(
    () => (timeEntryList.value?.activeEntries ?? []) as unknown as TimeEntry[]
  )

  const isTimerActiveForNote = computed(() => timerActiveFor(filePath.value, activeEntries.value))

  const timerElapsed = ref(0)
  let timerInterval: number | null = null

  const updateElapsed = () => {
    if (!isTimerActiveForNote.value) {
      timerElapsed.value = 0
      return
    }
    const match = entryFor(filePath.value, activeEntries.value)
    if (match?.start) {
      timerElapsed.value = dayjs().diff(match.start, 'second')
    } else {
      timerElapsed.value = 0
    }
  }

  const startElapsedTimer = () => {
    stopElapsedTimer()
    updateElapsed()
    timerInterval = window.setInterval(updateElapsed, 1000)
  }

  const stopElapsedTimer = () => {
    if (timerInterval) {
      window.clearInterval(timerInterval)
      timerInterval = null
    }
  }

  const timerElapsedText = computed(() => {
    const secs = timerElapsed.value
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(h)}:${pad(m)}:${pad(s)}`
  })

  watch(
    isTimerActiveForNote,
    (active) => {
      if (active) startElapsedTimer()
      else stopElapsedTimer()
    },
    { immediate: true }
  )

  const toggleTimer = () => toggleTimerFor(filePath.value, isTimerActiveForNote.value)

  onUnmounted(() => {
    stopElapsedTimer()
  })

  return {
    showTimerButton,
    isTimerActiveForNote,
    timerElapsedText,
    toggleTimer,
  }
}
