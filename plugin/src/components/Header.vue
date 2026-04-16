<template>
  <div v-if="header.type === 'account'" class="abele-header-view abele-header-view--column">
    <div v-for="b in accountBalances" :key="b.currency" class="abele-header-view__balance">
      {{ b.formatted }}
      <span class="abele-header-view__currency">{{ b.currency }}</span>
    </div>
  </div>
  <div v-else-if="header.type === 'transaction'" class="abele-header-view">
    <Icon icon="copy-plus" text-right="Add next" @click="addNextTransaction" />
  </div>
  <div v-else-if="header.journal" class="abele-header-view">
    <div class="abele-header-view__icons-set">
      <Icon
        icon="chevron-first"
        :disabled="doesPrevJournalNoteExist"
        @click="goToPrevJournalNote"
      />
      <Icon v-if="doesPrevJournalNoteExist" icon="chevron-left" @click="goToPrevJournalNote" />
      <Icon
        v-else
        icon="square-chevron-left"
        :disabled="!closestPrevJournalNote"
        @click="goToClosestPrevJournalNote"
      />
    </div>
    <Icon
      ref="switchJournalButton"
      :text-right="journalNameWithCounter"
      :disabled="availableJournalsForDate.length < 2"
      icon="notebook-pen"
      @click="handleJournalButtonClick"
    />

    <div class="abele-header-view__icons-set">
      <Icon v-if="doesNextJournalNoteExist" icon="chevron-right" @click="goToNextJournalNote" />
      <Icon
        v-else
        icon="square-chevron-right"
        :disabled="!closestNextJournalNote"
        @click="goToClosestNextJournalNote"
      />
      <Icon icon="chevron-last" :disabled="doesNextJournalNoteExist" @click="goToNextJournalNote" />
    </div>
  </div>
  <div v-if="showTimerButton" class="abele-header-view">
    <Icon
      :icon="isTimerActiveForNote ? 'timer-off' : 'timer'"
      :text-right="isTimerActiveForNote ? timerElapsedText : 'Start timer'"
      @click="toggleTimer"
    />
  </div>
</template>

<script setup lang="ts">
import { Header } from '@/entities/Header'
import Icon from './obsidian/Icon.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { Choice, useMenu } from '@/composables/useMenu'
import { createTransaction } from '@/commands/createTransaction'
import { createTimeEntry, stopActiveTimeEntry } from '@/commands/createTimeEntry'
import { getFrontmatterFromCache } from '@/helpers/notesUtils'
import { pathToWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'
import { GlobalStore } from '@/stores/GlobalStore'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { AccountsList } from '@/entities/AccountsList'
import { TimeEntry } from '@/entities/TimeEntry'
import { TimeEntryList } from '@/entities/TimeEntryList'
import dayjs from 'dayjs'
import { toRaw, unref, onUnmounted } from 'vue'
import { parseDateOrNull } from '@/helpers/datesHelper'

const props = defineProps<{
  header: Header
}>()

const store = GlobalStore.getInstance()

const accountBalances = computed(() => {
  const bi = toRaw(unref(store.balanceIndex)) as BalanceIndex | null
  const al = unref(store.accountsList) as AccountsList | null
  if (!bi || !al) return []
  bi.version.value

  const account = al.accounts.get(props.header.filePath)
  if (!account) return []

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (account.currency) {
    const balance = bi.getBalanceAtDate(props.header.filePath, dayjs())
    return [{ currency: account.currency, formatted: fmt(balance) }]
  }

  const available = bi.getCurrenciesForAccount(props.header.filePath)
  const pinned = AbeleConfig.getInstance()
    .pinnedCurrencies.split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)

  const ordered = pinned.filter((c) => available.includes(c))
  for (const c of available) {
    if (!ordered.includes(c)) ordered.push(c)
  }

  return ordered.map((cur) => ({
    currency: cur,
    formatted: fmt(bi.getBalanceAtDateByCurrency(props.header.filePath, dayjs(), cur)),
  }))
})

const addNextTransaction = async () => {
  const fm = getFrontmatterFromCache(props.header.filePath)
  if (!fm) return

  createTransaction({
    date: parseDateOrNull(fm.date) || dayjs(),
    from: fm.from || undefined,
    to: fm.to || undefined,
    amount: undefined,
    currency: fm.currency || undefined,
    foreignCurrency: fm.foreignCurrency || undefined,
    category: fm.category || undefined,
    groups: Array.isArray(fm.groups) ? fm.groups : undefined,
  })
}

const prevJournalDate = computed(() => {
  const { journal, journalDate } = props.header
  if (!journal) return

  return journal.getPrevDate(journalDate)
})

const nextJournalDate = computed(() => {
  const { journal, journalDate } = props.header
  if (!journal) return

  return journal.getNextDate(journalDate)
})

const doesPrevJournalNoteExist = computed(() => {
  const { journal } = props.header
  const date = prevJournalDate.value
  if (!date || !journal) return

  return journal.isJournalNoteCreated(date)
})

const doesNextJournalNoteExist = computed(() => {
  const { journal } = props.header
  const date = nextJournalDate.value
  if (!date || !journal) return

  return journal.isJournalNoteCreated(date)
})

const goToPrevJournalNote = () => {
  const { journal } = props.header
  const date = prevJournalDate.value
  if (!date || !journal) return

  journal.createJournalNote(date)
}

const goToNextJournalNote = () => {
  const { journal } = props.header
  const date = nextJournalDate.value
  if (!date || !journal) return

  journal.createJournalNote(date)
}

const closestPrevJournalNote = computed(() => {
  const { journal } = props.header
  const date = prevJournalDate.value
  if (!date || !journal) return

  return journal.findClosestPrevNote(date)
})

const closestNextJournalNote = computed(() => {
  const { journal } = props.header
  const date = nextJournalDate.value
  if (!date || !journal) return

  return journal.findClosestNextNote(date)
})

const goToClosestPrevJournalNote = () => {
  const { journal } = props.header
  const date = closestPrevJournalNote.value
  if (!date || !journal) return

  journal.createJournalNote(date)
}

const goToClosestNextJournalNote = () => {
  const { journal } = props.header
  const date = closestNextJournalNote.value
  if (!date || !journal) return

  journal.createJournalNote(date)
}

const availableJournalsForDate = computed(() => {
  const { journalDate } = props.header
  if (!journalDate) return []

  return AbeleConfig.getInstance().journals.filter((j) => {
    if (j.isJournalDate(journalDate)) return j
  })
})

const createdJournalsCount = computed(() => {
  const { journalDate } = props.header
  if (!journalDate) return 0

  return availableJournalsForDate.value.filter((j) => j.isJournalNoteCreated(journalDate)).length
})

const journalNameWithCounter = computed(() => {
  const { journal } = props.header
  if (!journal) return ''

  const total = availableJournalsForDate.value.length
  if (total < 2) return journal.name

  return `${journal.name} (${createdJournalsCount.value}/${total})`
})

const switchJournalButton = ref<InstanceType<typeof Icon> | null>(null)

const journalMenuChoices = computed<Choice[]>(() => {
  const { journalDate } = props.header
  return availableJournalsForDate.value.map((j) => {
    const isCreated = journalDate && j.isJournalNoteCreated(journalDate)
    return {
      title: isCreated ? `• ${j.name}` : j.name,
      event: j.id,
    }
  })
})

const handleMenuSelect = (event: string) => {
  const { journalDate } = props.header
  if (!journalDate) return

  const journal = AbeleConfig.getInstance().journals.find((j) => j.id === event)
  if (!journal) return

  journal.createJournalNote(journalDate)
}

const handleJournalButtonClick = () => {
  const { journal, journalDate } = props.header
  if (!journal || !journalDate) return

  if (availableJournalsForDate.value.length === 2) {
    const otherJournal = availableJournalsForDate.value.find((j) => j.id !== journal.id)
    if (otherJournal) {
      otherJournal.createJournalNote(journalDate)
      return
    }
  }

  journalMenu.open()
}

const journalMenu = useMenu(switchJournalButton, journalMenuChoices, handleMenuSelect)

// --- Timer ---

const showTimerButton = computed(() => {
  if (props.header.type === 'time-entry') return false
  return AbeleConfig.getInstance().isTimeTrackable(props.header.type)
})

const timeEntryList = computed(() => unref(store.timeEntryList) as TimeEntryList | null)

const activeTimeEntry = computed(
  () => (timeEntryList.value?.activeEntry ?? null) as TimeEntry | null
)

const isTimerActiveForNote = computed(() => {
  const active = activeTimeEntry.value
  if (!active) return false
  const basename = props.header.filePath.replace(/\.md$/, '').split('/').pop() || ''
  return active.groups.some((g) => {
    const linkPath = wikilinkToPath(g)
    return linkPath === basename || linkPath === props.header.filePath.replace(/\.md$/, '')
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
    const wikilink = pathToWikilink(props.header.filePath)
    createTimeEntry({ groups: [wikilink] }, false)
  }
}

onUnmounted(() => {
  stopElapsedTimer()
})

onMounted(() => {
  props.header.load()
})
</script>

<style lang="scss">
.abele-header-view {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--size-4-2);
  margin-bottom: var(--p-spacing);
  padding-bottom: var(--size-4-2);
  flex-wrap: nowrap;

  p {
    margin: 0;
  }
}

.abele-header-view__balance {
  font-size: var(--font-ui-large);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.abele-header-view__currency {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-weight: normal;
}

.abele-header-view--column {
  flex-direction: column;
}

.abele-header-view__icons-set {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
}

.abele-header-view__content {
  flex: 1;
  overflow-wrap: break-word;
  padding-top: 1px;
}

.abele-header-view__indicator {
  width: 3px;
  background-color: var(--background-modifier-error);
  border-radius: 2px;
  height: 100%;
}
</style>
