import { computed, ref, unref, watch, onUnmounted, Ref, ComputedRef } from 'vue'
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { TimeEntry } from '@/entities/TimeEntry'
import { TimeEntryList } from '@/entities/TimeEntryList'
import { AbeleConfig } from '@/services/AbeleConfig'
import { createTimeEntry, stopActiveTimeEntry } from '@/commands/createTimeEntry'
import { pathToWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'

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

  const activeTimeEntry = computed(
    () => (timeEntryList.value?.activeEntry ?? null) as unknown as TimeEntry | null
  )

  const isTimerActiveForNote = computed(() => {
    const active = activeTimeEntry.value
    if (!active) return false
    const basename = filePath.value.replace(/\.md$/, '').split('/').pop() || ''
    const pathNoExt = filePath.value.replace(/\.md$/, '')
    return active.groups.some((g) => {
      const linkPath = wikilinkToPath(g)
      return linkPath === basename || linkPath === pathNoExt
    })
  })

  const timerElapsed = ref(0)
  let timerInterval: ReturnType<typeof setInterval> | null = null

  const updateElapsed = () => {
    const active = activeTimeEntry.value
    if (active?.start && isTimerActiveForNote.value) {
      timerElapsed.value = dayjs().diff(active.start, 'second')
    } else {
      timerElapsed.value = 0
    }
  }

  const startElapsedTimer = () => {
    stopElapsedTimer()
    updateElapsed()
    timerInterval = setInterval(updateElapsed, 1000)
  }

  const stopElapsedTimer = () => {
    if (timerInterval) {
      clearInterval(timerInterval)
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

  const toggleTimer = () => {
    if (isTimerActiveForNote.value) {
      stopActiveTimeEntry()
    } else {
      const wikilink = pathToWikilink(filePath.value)
      createTimeEntry({ groups: [wikilink] }, false)
    }
  }

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
