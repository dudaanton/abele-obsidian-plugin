<template>
  <TreeItem
    class="abele-session-row"
    :class="{ 'abele-session-row_waiting': session.state === 'waiting' }"
    :icon="GLYPH[session.kind]"
    :text="session.title"
    :label="facts"
    :active="active === session.id"
    :collapsible="!!session.children?.length"
    :collapsed="collapsed"
    fold-apart
    @toggle="collapsed = !collapsed"
    @click="emit('open', session.id)"
  >
    <template #end>
      <span class="abele-session-row__codes">
        <Icon
          v-if="session.mode === 'bypass'"
          icon="shield-off"
          size="xs"
          color="red"
          :interactive="false"
          :tooltip="MODE.bypass.label"
        />
        <span class="tree-item-flair abele-session-row__time">{{ took }}</span>
        <span class="abele-session-row__dot">
          <StatusDot
            v-if="tone"
            :tone="tone"
            :pulse="session.state === 'running'"
            :label="CHILD_STATE[session.state]"
          />
        </span>
      </span>
    </template>
    <SessionTreeRow
      v-for="child in session.children ?? []"
      :key="child.id"
      :session="child"
      :depth="depth + 1"
      :active="active"
      :now="now"
      @open="(id) => emit('open', id)"
    />
  </TreeItem>
</template>

<script setup lang="ts">
// One session in the node panel's tree, and under it the ones it started.
import { computed, ref } from 'vue'
import TreeItem from '../obsidian/TreeItem.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import Icon from '../obsidian/Icon.vue'
import { CHILD_STATE, MODE, span, type ChildSession } from './types'

const props = defineProps<{
  session: ChildSession
  depth: number
  active?: string
  now: number
}>()
const emit = defineEmits<{ open: [id: string] }>()

const GLYPH = { chat: 'message-square', agent: 'bot', worker: 'hard-hat' } as const
// Two levels in sight at once; what is deeper opens on its arrow.
const collapsed = ref(props.depth >= 1)
const tone = computed(
  () =>
    (({ running: 'accent', waiting: 'orange', failed: 'red' }) as const)[
      props.session.state as 'running' | 'waiting' | 'failed'
    ]
)
const took = computed(() =>
  props.session.state === 'done' && !props.session.ended
    ? ''
    : span((props.session.ended ?? props.now) - props.session.started)
)
const facts = computed(() =>
  [
    `${props.session.title} · ${CHILD_STATE[props.session.state]}`,
    [props.session.agent, props.session.model, props.session.cost].filter(Boolean).join(' · '),
  ]
    .filter(Boolean)
    .join('\n')
)
</script>

<style lang="scss">
.abele-session-row__codes {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-2);
}
.abele-session-row__dot {
  display: inline-flex;
  justify-content: center;
  width: var(--size-4-2);
}
.abele-session-row_waiting > .tree-item-self .abele-tree-item__text {
  font-weight: var(--font-semibold);
}
</style>
