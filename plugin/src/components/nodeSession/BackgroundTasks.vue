<template>
  <!-- What the session keeps going between its answers, over the composer: one quiet line with
       how many, open on a press to the agents it started (the panel's rows, each opening its own
       chat) and the commands it left running, each with how long it has gone on and a way to stop
       it. The dot says the most pressing state; the line opens by itself while an agent waits for
       you or has failed. Nothing goes on, no line. -->
  <div v-if="count" class="abele-bg-tasks">
    <TreeItem
      :text="t('chat.backgroundCount', { count })"
      icon="layers"
      :label="said"
      collapsible
      :collapsed="!open"
      @click="open = !open"
    >
      <template #end>
        <span class="abele-bg-tasks__dot">
          <StatusDot :tone="tone" :pulse="tone === 'accent'" :label="said" />
        </span>
      </template>
      <div class="abele-bg-tasks__list">
        <SessionTreeRow
          v-for="session in sessions"
          :key="session.id"
          :session="session"
          :depth="0"
          :now="now"
          @open="(id) => emit('open', id)"
        />
        <TreeItem
          v-for="task in tasks"
          :key="task.id"
          class="abele-bg-tasks__task"
          :class="{ 'abele-bg-tasks__task_command': task.kind === 'command' }"
          :text="presentUiField(task, 'title')"
          :icon="KIND[task.kind].icon"
          :flair="span(now - task.since)"
          :label="
            t('chat.taskDuration', {
              kind: KIND[task.kind].said,
              title: presentUiField(task, 'title'),
              duration: span(now - task.since),
            })
          "
          inert
        >
          <template v-if="canStop" #actions>
            <Icon
              icon="x"
              size="xs"
              :tooltip="t('chat.stopTask')"
              @click.stop="emit('stop', task.id)"
            />
          </template>
        </TreeItem>
      </div>
    </TreeItem>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { presentUiField } from '@/i18n/streamBErrors'
import { computed, ref } from 'vue'
import TreeItem from '../obsidian/TreeItem.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import Icon from '../obsidian/Icon.vue'
import SessionTreeRow from './SessionTreeRow.vue'
import { span, type BackgroundTask, type ChildSession, type ChildState } from './types'

const props = withDefaults(
  defineProps<{
    tasks: BackgroundTask[]
    /** The sessions this one started through the node. */
    sessions?: ChildSession[]
    /** Opened at first: a prototype's or a test's look inside. */
    expanded?: boolean
    /** The clock the times are read against, ms. */
    now?: number
    /** A task can be stopped on its own; off while the node cannot. */
    canStop?: boolean
  }>(),
  { sessions: () => [], expanded: false, now: () => Date.now(), canStop: true }
)
const emit = defineEmits<{ stop: [id: string]; open: [id: string] }>()

const KIND = {
  command: { icon: 'square-terminal', said: t('chat.command') },
  monitor: { icon: 'eye', said: t('chat.watching') },
  agent: { icon: 'bot', said: t('chat.anAgent') },
} as const

const all = (list: ChildSession[]): ChildSession[] =>
  list.flatMap((s) => [s, ...all(s.children ?? [])])
const counted = computed(() => {
  const by: Partial<Record<ChildState, number>> = {}
  for (const s of all(props.sessions)) by[s.state] = (by[s.state] ?? 0) + 1
  return by
})
const count = computed(() => props.sessions.length + props.tasks.length)
// Waiting on you first, then a failure, then work going on.
const tone = computed(() =>
  counted.value.waiting ? 'orange' : counted.value.failed ? 'red' : 'accent'
)
const said = computed(() =>
  t('chat.backgroundSummary', {
    summary: [
      counted.value.waiting && t('chat.backgroundWaiting', { count: counted.value.waiting }),
      counted.value.failed && t('chat.backgroundFailed', { count: counted.value.failed }),
      counted.value.running && t('chat.backgroundWorking', { count: counted.value.running }),
      counted.value.done && t('chat.backgroundDone', { count: counted.value.done }),
      props.tasks.length && t('chat.backgroundRunning', { count: props.tasks.length }),
    ]
      .filter(Boolean)
      .join(' · '),
  })
)
const open = ref(props.expanded || !!(counted.value.waiting || counted.value.failed))
</script>

<style lang="scss">
.abele-bg-tasks {
  flex-shrink: 0;
  padding: 0 var(--size-4-2);
}
// A long list scrolls inside, so the talk keeps its room.
.abele-bg-tasks__list {
  max-height: 40vh;
  overflow-y: auto;
}
.abele-bg-tasks__dot {
  display: inline-flex;
  justify-content: center;
  width: var(--size-4-2);
}
// A command is shown as it was typed.
.abele-bg-tasks__task_command .abele-tree-item__text {
  font-family: var(--font-monospace);
}
</style>
