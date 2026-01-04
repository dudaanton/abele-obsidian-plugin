<template>
  <div class="abele-todo-sidebar">
    <TodoList :tasks="todoTasks" show-add-button />
  </div>
</template>

<script setup lang="ts">
import TodoList from './TodoList.vue'
import { computed, unref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { TasksList } from '@/entities/TasksList'

const tasks = computed(() => {
  const { tasksList: tasksListRef } = GlobalStore.getInstance()

  const tasksList = unref(tasksListRef) as TasksList

  if (!tasksList) return []

  return Array.from(tasksList.tasks.values()).sort(
    (a, b) => b.getTaskDateOrToday().unix() - a.getTaskDateOrToday().unix()
  )
})

const todoTasks = computed(() => tasks.value.filter((t) => !t.taskNotFound && !t.dates.length))
</script>

<style lang="scss">
.abele-todo-sidebar {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background-color: var(--background-primary);

  padding: calc(var(--p-spacing) * 2);
  padding-top: calc(var(--size-4-2) * 2 + var(--icon-size));
}

@media (max-width: 600px) {
  .abele-todo-sidebar {
    padding: calc(var(--size-4-4));
    padding-top: calc(var(--size-4-2) + var(--icon-size));
  }
}
</style>
