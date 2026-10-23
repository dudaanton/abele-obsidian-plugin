<template>
  <div
    class="abele-state-line"
    :class="{ 'abele-state-line_footer': footer }"
    :role="tone === 'faint' ? 'status' : 'alert'"
    :aria-busy="pulse || undefined"
  >
    <!-- Two columns: the dot (and the fold's arrow) in the gutter, everything else on one edge. -->
    <div class="abele-state-line__head">
      <StatusDot :tone="tone" :label="text" :pulse="pulse" />
      <span class="abele-state-line__text">{{ text }}</span>
    </div>
    <div v-if="action" class="abele-state-line__body">
      <Button :text="action" :tooltip="action" :disabled="disabled" @click="emit('action')" />
    </div>
    <div v-if="details.length || log" class="abele-state-line__body">
      <FoldHeading
        v-if="details.length || !logWithoutDetails"
        class="abele-state-line__fold"
        :text="detailsLabel || t('node.error.details')"
        collapsible
        :collapsed="!open"
        @toggle="open = !open"
      />
      <div v-if="open || (logWithoutDetails && !details.length)" class="abele-state-line__more">
        <div v-if="details.length" class="abele-state-line__facts">
          <template v-for="fact in details" :key="fact.label">
            <span class="abele-state-line__label">{{ fact.label }}</span>
            <span class="abele-state-line__value" :class="{ 'is-code': fact.code }">{{
              fact.value
            }}</span>
          </template>
        </div>
        <slot name="evidence" />
        <div class="abele-state-line__links">
          <a v-if="log" class="abele-state-line__link" href="#" @click.prevent="emit('log')">{{
            t('node.log.title')
          }}</a>
          <a
            v-if="details.length"
            class="abele-state-line__link"
            href="#"
            @click.prevent="emit('copy')"
            >{{ t('node.error.copyDetails') }}</a
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// One line for anything that went wrong on the node: a dot that says how bad, one plain
// sentence with no code in it, at most one action that helps, and the evidence folded away.
// The same form in a file tab, at the foot of the node panel and in a chat card.
import { computed, ref, watch } from 'vue'
import { t } from '@/i18n'
import StatusDot from './StatusDot.vue'
import Button from './Button.vue'
import FoldHeading from './FoldHeading.vue'

const props = defineProps<{
  tone: 'red' | 'orange' | 'faint'
  text: string
  pulse?: boolean
  action?: string
  details?: { label: string; value: string; code?: boolean }[]
  disabled?: boolean
  detailsLabel?: string
  log?: boolean
  /** Loading progress has a direct log link rather than error evidence. */
  logWithoutDetails?: boolean
  footer?: boolean
  expanded?: boolean
}>()
const emit = defineEmits<{ action: []; log: []; copy: [] }>()
const details = computed(() => props.details ?? [])
const open = ref(!!props.expanded)
watch(
  () => props.expanded,
  (v) => (open.value = !!v)
)
</script>

<style>
.abele-state-line {
  --abele-state-gutter: calc(var(--size-4-2) + var(--size-4-2));
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}
.abele-state-line__head {
  display: grid;
  grid-template-columns: var(--abele-state-gutter) minmax(0, 1fr);
  align-items: baseline;
}
.abele-state-line__head .abele-status-dot {
  transform: translateY(-1px);
}
.abele-state-line__text {
  overflow-wrap: anywhere;
}
.abele-state-line__body {
  padding-inline-start: var(--abele-state-gutter);
  min-width: 0;
}
.abele-state-line__fold {
  font-size: var(--font-ui-small);
}
.abele-state-line__more {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin-top: var(--size-4-1);
}
.abele-state-line__facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: var(--size-4-4);
  row-gap: var(--size-2-2);
}
.abele-state-line__label {
  color: var(--text-faint);
}
.abele-state-line__value {
  overflow-wrap: anywhere;
}
.abele-state-line__value.is-code {
  font-family: var(--font-monospace);
  font-size: 0.95em;
}
.abele-state-line__links {
  display: flex;
  gap: var(--size-4-4);
}
.abele-state-line__link {
  color: var(--text-accent);
  text-decoration: none;
}
.abele-state-line__link:hover {
  color: var(--text-accent-hover);
  text-decoration: underline;
}
.is-phone .abele-state-line__link {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch-size-l);
}
.abele-state-line_footer {
  padding: var(--size-4-2) var(--size-4-3);
  border-top: var(--border-width) solid var(--background-modifier-border);
  background: var(--background-secondary);
}
</style>
