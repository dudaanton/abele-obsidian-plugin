<template>
  <div v-if="footer.loaded" class="abele-footer-view">
    <TodoList v-if="todoTasks.length" :tasks="todoTasks" />
    <Timeline v-if="timelineTasks.length" :tasks="timelineTasks" title="Calendar tasks" />
    <NotesList v-if="notes.length" :notes="notes" />
    <LogsList v-if="logs.length" :logs="logs" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Footer } from '@/entities/Footer'
import Timeline from './Timeline.vue'
import TodoList from './TodoList.vue'
import NotesList from './NotesList.vue'
import LogsList from './LogsList.vue'

const props = defineProps<{
  footer: Footer
}>()

const tasks = computed(() => {
  return Array.from(props.footer.noteRelations.tasks.values()).sort(
    (a, b) => b.getTaskDateOrToday().unix() - a.getTaskDateOrToday().unix()
  )
})

const todoTasks = computed(() => tasks.value.filter((t) => !t.taskNotFound && !t.dates.length))
const timelineTasks = computed(() => tasks.value.filter((t) => !t.taskNotFound && t.dates.length))

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
