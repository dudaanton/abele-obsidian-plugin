<template>
  <!-- A line the session draws across the conversation, like a date divider: it compacted here
       (how much it held before and after; what it kept is in the tooltip, the retelling opens on
       a press), it is compacting now, or something it left running woke it. -->
  <div
    v-if="said"
    class="abele-session-mark"
    :class="[`abele-session-mark_${mark.kind}`, mark.level && `abele-session-mark_${mark.level}`]"
    :role="mark.kind === 'failed' || mark.level === 'error' ? 'alert' : 'note'"
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
      <Icon :icon="glyph" size="xs" :interactive="false" />
      <NodeErrorText v-if="mark.kind === 'failed' || mark.level === 'error'" :error="said" />
      <span v-else>{{ said }}</span>
    </span>
    <div class="abele-session-mark__line" />
  </div>
  <div v-if="open && summary" class="abele-session-mark__summary">
    <Markdown :text="summary" />
  </div>
</template>

<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { t } from '@/i18n'
import { presentUiField } from '@/i18n/streamBErrors'
import { computed, ref, watchEffect } from 'vue'
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
  notice: 'info',
} as const
/** A notice says how much it matters by its glyph and colour. */
const LEVEL_ICON = { info: 'info', warning: 'triangle-alert', error: 'circle-alert' } as const
const glyph = computed(() =>
  props.mark.kind === 'notice' ? LEVEL_ICON[props.mark.level ?? 'info'] : ICON[props.mark.kind]
)
const said = computed(() => {
  const { mark } = props
  if (mark.kind === 'notice') return presentUiField(mark, 'text')
  if (mark.kind === 'compacting') return t('chat.compacting')
  if (mark.kind === 'woke')
    return t('chat.woke', {
      text: mark.text == null ? t('chat.backgroundEnded') : presentUiField(mark, 'text'),
    })
  if (mark.kind === 'failed')
    return t('chat.compactFailed', { reason: mark.text ? `: ${presentUiField(mark, 'text')}` : '' })
  return mark.before && mark.after
    ? t('chat.compactedCounts', { before: tokens(mark.before), after: tokens(mark.after) })
    : t('chat.compacted')
})
const label = ref<HTMLElement>()
watchEffect(() => {
  const tip = [
    props.mark.detail,
    props.mark.focus && t('chat.keptFocus', { focus: props.mark.focus }),
    props.summary && (open.value ? t('chat.hideSummary') : t('chat.showSummary')),
  ]
    .filter(Boolean)
    .join('\n')
  if (label.value) setTooltip(label.value, tip)
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
.abele-session-mark_failed .abele-session-mark__label,
.abele-session-mark_error .abele-session-mark__label {
  color: var(--text-error);
}
.abele-session-mark_warning .abele-session-mark__label {
  color: var(--text-warning);
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
