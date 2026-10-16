<template>
  <!-- A line the session draws across the conversation, like a date divider: it compacted here
       (how much it held before and after; what it kept is in the tooltip, the retelling opens on
       a press), it is compacting now, or something it left running woke it. -->
  <div
    class="abele-session-mark"
    :class="`abele-session-mark_${mark.kind}`"
    :role="mark.kind === 'failed' ? 'alert' : 'note'"
  >
    <div class="abele-session-mark__line" />
    <span
      ref="label"
      class="abele-session-mark__label"
      :role="summary ? 'button' : undefined"
      :tabindex="summary ? 0 : undefined"
      :aria-expanded="summary ? open : undefined"
      @click="summary && (open = !open)"
      @keydown.enter.prevent="summary && (open = !open)"
    >
      <Icon :icon="ICON[mark.kind]" size="xs" :interactive="false" />
      <span>{{ said }}</span>
    </span>
    <div class="abele-session-mark__line" />
  </div>
  <div v-if="open && summary" class="abele-session-mark__summary">
    <Markdown :text="summary" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import Markdown from '../obsidian/Markdown.vue'
import { tokens, type SessionMark } from './types'

const props = defineProps<{ mark: SessionMark; summary?: string }>()
const open = ref(false)

const ICON = {
  compacting: 'loader',
  compacted: 'fold-vertical',
  woke: 'alarm-clock',
  failed: 'triangle-alert',
} as const
const said = computed(() => {
  const { mark } = props
  if (mark.kind === 'compacting') return 'Compacting…'
  if (mark.kind === 'woke') return `Woke: ${mark.text ?? 'a background task ended'}`
  if (mark.kind === 'failed') return `Compacting failed${mark.text ? `: ${mark.text}` : ''}`
  return mark.before && mark.after
    ? `Compacted · ${tokens(mark.before)} → ${tokens(mark.after)}`
    : 'Compacted'
})
const label = ref<HTMLElement>()
onMounted(() => {
  const tip = [
    props.mark.focus && `Kept in focus: ${props.mark.focus}`,
    props.summary && (open.value ? 'Hide the retelling' : 'Show the retelling'),
  ]
    .filter(Boolean)
    .join('\n')
  if (label.value && tip) setTooltip(label.value, tip)
})
</script>

<style lang="scss">
.abele-session-mark {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin: var(--size-4-3) 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-session-mark__line {
  flex: 1 1 auto;
  border-top: var(--border-width) solid var(--background-modifier-border);
}
.abele-session-mark__label {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);
  overflow-wrap: anywhere;

  .abele-obsidian-icon {
    padding: 0;
  }
  &[role='button'] {
    cursor: var(--cursor);

    &:hover {
      color: var(--text-normal);
    }
  }
}
.abele-session-mark_failed .abele-session-mark__label {
  color: var(--text-error);
}
.abele-session-mark_compacting .abele-obsidian-icon__icon {
  animation: abele-session-mark-spin 1.2s linear infinite;
}
.abele-session-mark__summary {
  margin: 0 0 var(--size-4-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
@keyframes abele-session-mark-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
