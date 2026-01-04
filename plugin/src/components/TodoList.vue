<template>
  <div class="abele-todo-list">
    <div class="abele-todo-list__header">
      <div class="abele-todo-list__header-left">
        <div class="abele-todo-list__header-text">Tasks</div>
        <ObsidianIcon v-if="showAddButton" icon="square-plus" @click="createTask()" />
      </div>
      <ObsidianIcon
        class="abele-todo-list__completed-toggle"
        :text-right="hideCompleted ? 'Show completed' : 'Hide completed'"
        @click="hideCompleted = !hideCompleted"
      />
    </div>
    <div class="abele-todo-list__tasks">
      <TaskView
        v-for="task in tasksWithoutDates"
        :key="task.id"
        :task="task"
        class="abele-todo-list__task"
      />
    </div>
    <div v-if="!tasksWithoutDates.length" class="abele-todo-list__no-tasks">No tasks to show.</div>
  </div>
</template>

<script setup lang="ts">
import { Task } from '@/entities/Task'
import TaskView from './Task.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { computed, ref } from 'vue'
import { createTask } from '@/commands/createTask'

const props = defineProps<{
  showAddButton?: boolean
  tasks: Task[]
}>()

const hideCompleted = ref(true)

const tasksWithoutDates = computed(() => {
  return hideCompleted.value ? props.tasks.filter((t) => !t.completedAt) : props.tasks
})
</script>

<style lang="scss">
.abele-todo-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--p-spacing);

  .abele-todo-list__header-text {
    font-weight: bold;
  }
}

.abele-todo-list__header-left {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
}

.abele-todo-list__tasks {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) / 2);
  padding-left: calc(var(--icon-size) / 4);
}

.abele-todo-list__no-tasks {
  font-style: italic;
  color: var(--text-muted);
}

.abele-todo-list__completed-toggle {
  font-size: var(--font-small);
}
</style>
