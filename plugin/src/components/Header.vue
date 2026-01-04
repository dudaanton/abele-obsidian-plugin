<template>
  <div v-if="header.journal" class="abele-header-view">
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
</template>

<script setup lang="ts">
import { Header } from '@/entities/Header'
import Icon from './obsidian/Icon.vue'
import { computed, onMounted, ref } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { Choice, useMenu } from '@/composables/useMenu'

const props = defineProps<{
  header: Header
}>()

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
