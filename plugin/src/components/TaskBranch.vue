<template>
  <!-- One element for the list to count and page, laid out as if it were not there. -->
  <div class="abele-task-branch-item">
    <TaskView
      :task="node.task"
      :subtasks="progress"
      :subtasks-open="open"
      :circular="circularNames"
      :parent="depth === 0 && parentNames.length ? parentNames : undefined"
      :parents="parentTasks"
      @toggle-subtasks="toggle"
    />
    <!-- Under the task, stepped in with a line at their left, as a folder's notes in the files. -->
    <div v-if="open && kids.length" class="abele-task-branch" role="group">
      <TaskBranch v-for="kid in kids" :key="kid.path" :node="kid" :tree="tree" :depth="depth + 1" />
    </div>
  </div>
</template>

<script setup lang="ts">
// A task with its subtasks under it, as far down as they go; the list decides which are shown.
import { computed, inject } from 'vue'
import { PRINT_MODE } from '@/markdown/printMode'
import TaskView from './Task.vue'
import type { TaskTree } from '@/helpers/taskTree'
import { progressOf } from '@/helpers/taskTree'
import type { TaskNode } from '@/commands/subtasks'
import { useSubtasksOpen } from '@/composables/useSubtasksOpen'

defineOptions({ name: 'TaskBranch' })

const props = withDefaults(
  defineProps<{ node: TaskNode; tree: TaskTree<TaskNode>; depth?: number; owner?: string }>(),
  { depth: 0 }
)

const name = (n: TaskNode) => n.task.title || n.task.taskName
const progress = computed(() => progressOf(props.tree, props.node))
const kids = computed(() => props.tree.children.get(props.node) ?? [])
const circularNames = computed(() => props.tree.circular.get(props.node)?.map(name))
const parentTasks = computed(() => (props.tree.parents.get(props.node) ?? []).map((n) => n.task))
/** At the top of a list, a subtask whose parent is elsewhere names it. */
const parentNames = computed(() =>
  (props.tree.parents.get(props.node) ?? []).filter((n) => n.path !== props.owner).map(name)
)

const memory = useSubtasksOpen()
const printing = inject(PRINT_MODE, false)
const open = computed(() => printing || memory.isOpen(props.node.path))
const toggle = () => memory.set(props.node.path, !open.value)
</script>

<style lang="scss">
.abele-task-branch-item {
  display: contents;
}

.abele-task-branch {
  display: flex;
  flex-direction: column;
  gap: inherit;
  margin-inline-start: calc(var(--size-4-4) + var(--size-2-2));
  padding-inline-start: var(--size-4-2);
  border-inline-start: var(--nav-indentation-guide-width, 1px) solid
    var(--nav-indentation-guide-color, var(--background-modifier-border));
}

body.is-phone .abele-task-branch {
  margin-inline-start: var(--size-4-3);
}
</style>
