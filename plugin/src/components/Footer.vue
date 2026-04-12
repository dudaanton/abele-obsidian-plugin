<template>
  <div v-if="footer.loaded" class="abele-footer-view">
    <TodoList v-if="todoTasks.length" :tasks="todoTasks" />
    <Timeline v-if="timelineTasks.length" :tasks="timelineTasks" title="Calendar tasks" />
    <AccountBalanceChart v-if="footer.type === 'account'" :account-path="footer.filePath" />
    <TransactionsListView
      v-if="transactions.length"
      :transactions="transactions"
      :date="footer.noteRelations.journalDate"
      :account-path="footer.type === 'account' ? footer.filePath : null"
    />
    <NotesList v-if="notes.length" :notes="notes" />
    <LogsList v-if="logs.length" :logs="logs" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Footer } from '@/entities/Footer'
import Timeline from './Timeline.vue'
import TodoList from './TodoList.vue'
import AccountBalanceChart from './AccountBalanceChart.vue'
import TransactionsListView from './TransactionsList.vue'
import NotesList from './NotesList.vue'
import LogsList from './LogsList.vue'

const props = defineProps<{
  footer: Footer
}>()

const tasks = computed(() => {
  return Array.from(props.footer.noteRelations.tasks.values()).sort(
    (a, b) => b.getSortTimestamp() - a.getSortTimestamp()
  )
})

const todoTasks = computed(() => tasks.value.filter((t) => !t.taskNotFound && !t.dates.length))
const timelineTasks = computed(() => tasks.value.filter((t) => !t.taskNotFound && t.dates.length))

const transactions = computed(() => {
  return Array.from(props.footer.noteRelations.transactions.values()).filter(
    (t) => !t.transactionNotFound
  )
})

const notes = computed(() => {
  return Array.from(props.footer.noteRelations.notes.values()).sort(
    (a, b) => b.getNoteDateOrToday().unix() - a.getNoteDateOrToday().unix()
  )
})
const logs = computed(() => {
  return Array.from(props.footer.noteRelations.logs.values()).sort(
    (a, b) => b.getLogDateOrToday().unix() - a.getLogDateOrToday().unix()
  )
})

onMounted(() => {
  props.footer.load()
})
</script>

<style lang="scss">
.abele-footer-view {
  margin-bottom: var(--p-spacing);
  margin-top: var(--p-spacing);
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) * 1.5);

  p {
    margin: 0;
  }
}
</style>
