<template>
  <!-- Where one value went through the run: each step it was seen at, in time, with the path it
       had there and, quiet, where that path or its type changed; where it was seen last when the
       run went on without it. -->
  <div class="abele-trace-trail">
    <div class="abele-trace-trail__head">
      <Icon icon="footprints" no-hover />
      <span class="abele-trace-trail__value">{{ trail.value }}</span>
      <Icon icon="x" :tooltip="t('streamC.4c5d9f6c20a1e610')" @click="emit('close')" />
    </div>
    <EmptyState v-if="!stops.length && !lost" :text="t('debug.followNoMatches')" />
    <!-- Two lines to a stop, so a long path is read whole in a narrow pane: the step, then
         where in it the value was. -->
    <div
      v-for="stop in stops"
      :key="stop.step.id + stop.path"
      class="tree-item-self is-clickable abele-trace-trail__stop"
      role="button"
      tabindex="0"
      @click="emit('open-value', stop.step.id, stop.path)"
      @keydown.enter="emit('open-value', stop.step.id, stop.path)"
    >
      <TraceStepGlyph :step="stop.step" />
      <div class="abele-trace-trail__where">
        <div class="abele-trace-trail__line">
          <span class="abele-trace-trail__label">{{ stop.step.label }}</span>
          <span class="abele-trace-trail__change" :class="{ 'is-changed': !!stop.change }">{{
            stop.change ?? since(stop.step.at)
          }}</span>
        </div>
        <div class="abele-trace-trail__path">{{ stop.path }}</div>
      </div>
    </div>
    <!-- Read as a row of its own, its words where the steps' words are. -->
    <div v-if="lost" class="tree-item-self abele-trace-trail__stop abele-trace-trail__lost">
      <span class="abele-trace-glyph" aria-hidden="true" />
      <span class="abele-trace-trail__where"
        >{{ t('streamC.feea6a0e91027022') }} {{ lost.label }}, {{ since(lost.at) }}</span
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import { computed } from 'vue'
import Icon from '../../obsidian/Icon.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import TraceStepGlyph from './TraceStepGlyph.vue'
import { since } from './format'
import type { TraceStep, TraceTrail } from './types'

const props = defineProps<{ trail: TraceTrail; steps: TraceStep[] }>()
const emit = defineEmits<{
  (e: 'open-value', step: string, path: string): void
  (e: 'close'): void
}>()

const byId = computed(() => new Map(props.steps.map((s) => [s.id, s])))
const stops = computed(() =>
  props.trail.stops.flatMap((s) => {
    const step = byId.value.get(s.step)
    return step ? [{ ...s, step }] : []
  })
)
const lost = computed(() =>
  props.trail.lostAfter ? byId.value.get(props.trail.lostAfter) : undefined
)
</script>

<style lang="scss">
.abele-trace-trail {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
}
.abele-trace-trail__head {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-2-2) var(--size-4-2) var(--size-4-2);
}
.abele-trace-trail__value {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--font-monospace);
  font-weight: var(--font-semibold);
  overflow-wrap: anywhere;
}
.abele-trace-trail__stop {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  padding-block: var(--size-4-1);

  .abele-trace-glyph {
    margin-top: var(--size-2-1);
  }
}
.abele-trace-trail__where {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
}
.abele-trace-trail__line {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-2);
}
.abele-trace-trail__label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-trace-trail__path {
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  overflow-wrap: anywhere;
}
.abele-trace-trail__change {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;

  &.is-changed {
    color: var(--text-muted);
    font-family: var(--font-monospace);
  }
}
.abele-trace-trail__lost {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
</style>
