<template>
  <SidebarPanel class="abele-todo-sidebar">
    <TodoList :tasks="todoTasks" show-add-button />
  </SidebarPanel>
</template>

<script setup lang="ts">
import SidebarPanel from './obsidian/SidebarPanel.vue'
import TodoList from './TodoList.vue'
import { computed, unref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { TasksList } from '@/entities/TasksList'

const tasks = computed(() => {
  const { tasksList: tasksListRef } = GlobalStore.getInstance()

  const tasksList = unref(tasksListRef) as TasksList

  if (!tasksList) return []

  return Array.from(tasksList.tasks.values()).sort(
    (a, b) => b.getSortTimestamp() - a.getSortTimestamp()
  )
})

const todoTasks = computed(() => tasks.value.filter((t) => !t.taskNotFound && !t.dates.length))
</script>
