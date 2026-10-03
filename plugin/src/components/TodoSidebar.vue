<template>
  <SidebarPanel class="abele-todo-sidebar">
    <TodoList :tasks="todoTasks" show-add-button />
  </SidebarPanel>
</template>

<script setup lang="ts">
import SidebarPanel from './obsidian/SidebarPanel.vue'
import TodoList from './TodoList.vue'
import { toRef, unref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { TasksList } from '@/entities/TasksList'

import { pausedWhileHidden } from '@/helpers/pausedWhileHidden'
import { providePanelActive } from '@/composables/usePanelComputed'
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const active = toRef(props, 'active')
providePanelActive(active)
const tasks = pausedWhileHidden(active, () => {
  const { tasksList: tasksListRef } = GlobalStore.getInstance()

  const tasksList = unref(tasksListRef) as TasksList

  if (!tasksList) return []

  return Array.from(tasksList.tasks.values()).sort(
    (a, b) => b.getSortTimestamp() - a.getSortTimestamp()
  )
})

const todoTasks = pausedWhileHidden(active, () =>
  tasks.value.filter((t) => !t.taskNotFound && !t.dates.length)
)
</script>
