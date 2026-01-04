<template>
  <div class="abele-timeline">
    <div class="abele-timeline__header">
      <div class="abele-timeline__header-left">
        <div class="abele-timeline__header-text">{{ title ?? 'Timeline' }}</div>
        <ObsidianIcon v-if="showAddButton" icon="calendar-plus" @click="createTask()" />
      </div>
      <ObsidianIcon
        class="abele-timeline__completed-toggle"
        :text-right="hideCompleted ? 'Show completed' : 'Hide completed'"
        @click="hideCompleted = !hideCompleted"
      />
    </div>
    <div v-for="([date, dateTasks], index) in dates" :key="date" class="abele-timeline__date-block">
      <div
        class="abele-timeline__date-indicator"
        :class="{ 'abele-timeline__date-indicator_overdue': dayjs(date).isBefore(now, 'day') }"
      >
        <div class="abele-timeline__date-icon abele-timeline__date-icon_overdue">
          <ObsidianIcon icon="flame" no-hover />
        </div>
        <div class="abele-timeline__date-icon abele-timeline__date-icon_upcoming">
          <ObsidianIcon icon="calendar" no-hover />
        </div>
        <div
          class="abele-timeline__date-line"
          :class="{ 'abele-timeline__date-line_last': index === dates.length - 1 }"
        />
      </div>
      <div class="abele-timeline__block-content">
        <ObsidianMarkdown class="timeline__date" :text="getDateWikilink(date)" />
        <div class="abele-timeline__tasks">
          <TaskView
            v-for="task in dateTasks"
            :key="task.id"
            class="abele-timeline__task"
            :task="task"
            at-timeline
          />
        </div>
      </div>
    </div>
    <div v-if="!dates.length" class="abele-timeline__no-tasks">No tasks to show.</div>
  </div>
</template>

<script setup lang="ts">
import { Task } from '@/entities/Task'
import TaskView from './Task.vue'
import { computed, ref } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import dayjs from 'dayjs'
import { DATE_FORMAT, DISPLAY_DATE_FORMAT } from '@/constants/dates'
import { useDate } from '@/composables/useDate'
import { createTask } from '@/commands/createTask'

const props = defineProps<{
  showAddButton?: boolean
  tasks: Task[]
  title?: string
}>()

const { now } = useDate()

const hideCompleted = ref(true)

const dates = computed(() => {
  const datesSet = new Map<string, Task[]>()

  const tasks = hideCompleted.value
    ? props.tasks.filter((t) => !t.completedAt && !t.taskNotFound)
    : props.tasks.filter((t) => !t.taskNotFound)

  for (const task of tasks) {
    for (const date of task.dates) {
      if (!datesSet.has(date)) {
        datesSet.set(date, [])
      }
      datesSet.get(date)?.push(task)
    }
  }

  return Array.from(datesSet.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))
})

const getDateWikilink = (dateStr: string) => {
  const date = dayjs(dateStr, DATE_FORMAT)
  const diff = date.startOf('day').diff(now.value.startOf('day'), 'day')

  let suffix = ''
  if (diff === 0) suffix = '(Today)'
  if (diff === 1) suffix = '(Tomorrow)'
  if (diff === -1) suffix = '(Yesterday)'
  if (diff > 1) suffix = `(${diff} days left)`
  if (diff < -1) suffix = `(${Math.abs(diff)} days ago)`

  const dateToShow = date.format(DISPLAY_DATE_FORMAT)
  // TODO: handle user defined daily note format and location
  return `[[${dateStr}|${dateToShow} ${suffix}]]`
}
</script>

<style lang="scss">
.abele-timeline__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--p-spacing);

  .abele-timeline__header-text {
    font-weight: bold;
  }
}

.abele-timeline__header-left {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
}

.timeline__date {
  margin-left: calc(var(--checkbox-margin-inline-start) - 0.25em);
  margin-top: calc(var(--icon-size) / 4 + (var(--icon-size) - var(--font-text-size)) / 2);
  margin-bottom: calc(var(--p-spacing) / 2);
  .internal-link {
    color: var(--text-faint);
    font-size: var(--font-small);
  }
}

.abele-timeline__date-block {
  display: flex;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-2);
}

.abele-timeline__date-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-2-2);

  &_overdue {
    .abele-timeline__date-icon {
      background-color: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
      .abele-obsidian-icon {
        color: var(--background-primary);
      }
      &_upcoming {
        display: none;
      }
      &_overdue {
        display: flex;
      }
    }
    .abele-timeline__date-line {
      background-color: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
    }
  }

  &:not(.abele-timeline__date-indicator_overdue) {
    .abele-timeline__date-icon {
      &_overdue {
        display: none;
      }
    }
    .abele-timeline__date-line:not(.abele-timeline__date-line_last) {
      background-color: var(--background-secondary);
    }
  }
}

.abele-timeline__date-icon {
  width: calc(var(--icon-size) * 1.7);
  height: calc(var(--icon-size) * 1.7);
  border-radius: 50%;
  background-color: var(--background-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  .abele-obsidian-icon {
    color: var(--text-faint);
  }
}

.abele-timeline__date-line {
  width: 2px;
  height: 100%;
  border-radius: 1px;
  margin-top: var(--size-2-2);
}

.abele-timeline__block-content {
  flex: 1;
}

.abele-timeline__tasks {
  margin-top: var(--size-2-2);
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  margin-bottom: calc(var(--p-spacing) / 2);
}

.abele-timeline__no-tasks {
  font-style: italic;
  color: var(--text-muted);
}

.abele-timeline__completed-toggle {
  font-size: var(--font-small);
}
</style>
