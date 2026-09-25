<template>
  <div class="abele-todo-list">
    <div class="abele-todo-list__header">
      <div class="abele-todo-list__header-left">
        <div class="abele-todo-list__header-text">Tasks</div>
        <ObsidianIcon v-if="showAddButton" icon="square-plus" @click="openTaskForm()" />
      </div>
      <div class="abele-todo-list__header-right">
        <ObsidianIcon
          class="abele-todo-list__search-toggle"
          icon="search"
          :active="search.open.value"
          :tooltip="
            search.open.value ? 'Close the search' : 'Search tasks by title and description'
          "
          @click="search.toggle"
        />
        <ObsidianIcon
          v-if="labelOptions.length"
          class="abele-task-label-filter"
          icon="tag"
          :text-right="labelText || undefined"
          tooltip="Filter by label"
          @click="openLabelMenu"
        />
        <ObsidianIcon
          class="abele-todo-list__completed-toggle"
          :text-right="hideCompleted ? 'Show completed' : 'Hide completed'"
          @click="hideCompleted = !hideCompleted"
        />
      </div>
    </div>
    <ObsidianSearch
      v-if="search.open.value"
      v-model="search.query.value"
      class="abele-todo-list__search"
      placeholder="Search tasks…"
      autofocus
      @keydown.escape.stop.prevent="search.close"
    />
    <div ref="itemsEl" class="abele-todo-list__tasks">
      <TaskView v-for="task in visible" :key="task.id" :task="task" class="abele-todo-list__task" />
      <div v-if="hasMore" ref="sentinel" class="abele-todo-list__sentinel" />
    </div>
    <div v-if="!shown.length" class="abele-todo-list__no-tasks">
      {{ search.terms.value.length ? 'Nothing matches the search.' : 'No tasks to show.' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { Task } from '@/entities/Task'
import TaskView from './Task.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianSearch from './obsidian/Search.vue'
import { computed, ref, watch } from 'vue'
import { openTaskForm } from '@/commands/taskForm'
import { usePagedList } from '@/composables/usePagedList'
import { useLabelFilter } from '@/composables/useLabelFilter'
import { sortByPriority } from '@/helpers/taskMeta'
import { taskSearch, useListSearch } from '@/composables/useListSearch'
import { useSearchHighlight } from '@/composables/useSearchHighlight'

const props = defineProps<{
  showAddButton?: boolean
  tasks: Task[]
}>()

const hideCompleted = ref(true)

const tasksWithoutDates = computed(() => {
  return hideCompleted.value ? props.tasks.filter((t) => !t.completedAt) : props.tasks
})

const {
  options: labelOptions,
  filtered,
  selectedText: labelText,
  selected: labelSelection,
  openMenu: openLabelMenu,
} = useLabelFilter(() => tasksWithoutDates.value)

// Priority first, then whatever order the list was handed — the sort is stable, so the date
// order underneath survives within each priority.
const search = useListSearch(() => filtered.value, taskSearch)

const shown = computed(() => sortByPriority(search.results.value))

const itemsEl = ref<HTMLElement | null>(null)
useSearchHighlight(itemsEl, search.terms)

const { visible, hasMore, sentinel, reset } = usePagedList(() => shown.value)

// Revealing completed tasks interleaves them into the list rather than appending, so the
// expanded window would no longer correspond to anything the reader scrolled past. A new label
// filter is a different list altogether.
watch(hideCompleted, reset)
watch(labelSelection, reset)
watch(search.terms, reset)
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

.abele-todo-list__header-right {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
  min-width: 0;
}

.abele-task-label-filter {
  font-size: var(--font-small);
}

.abele-todo-list__header-left {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
}

.abele-todo-list__search {
  margin-bottom: var(--p-spacing);
}

.abele-todo-list__sentinel {
  height: 1px;
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
