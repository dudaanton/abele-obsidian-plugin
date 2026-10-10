<template>
  <article class="tree-item abele-list-row" :aria-busy="state === 'loading'">
    <div class="tree-item-self abele-list-row__line" :class="{ 'is-active': selected }">
      <span class="abele-list-row__leading"
        ><slot name="leading"><Icon v-if="icon" :icon="icon" no-hover /></slot
      ></span>
      <div class="tree-item-inner abele-list-row__content">
        <component
          :is="mainInteractive ? 'button' : 'div'"
          :class="
            mainInteractive
              ? 'clickable-icon is-clickable abele-list-row__main'
              : 'abele-list-row__title'
          "
          :type="mainInteractive ? 'button' : undefined"
          :disabled="mainInteractive ? disabled : undefined"
          :aria-expanded="!interactive && expanded !== undefined ? expanded : undefined"
          :aria-controls="!interactive && expanded !== undefined ? detailId : undefined"
          :aria-pressed="interactive ? selected : undefined"
          :aria-label="
            mainInteractive
              ? disabled && disabledReason
                ? `${title}: ${disabledReason}`
                : title
              : undefined
          "
          @click="openMain"
        >
          <span class="abele-list-row__title-line"
            ><span class="abele-list-row__title-text">{{ stem }}</span
            ><span v-if="extension" class="abele-list-row__extension">{{ extension }}</span
            ><Icon v-if="interactive" class="abele-list-row__opener" icon="chevron-right" no-hover
          /></span>
          <MetaLine v-if="!$slots.metadata && facts?.length" :facts="facts" />
          <slot v-if="!mainInteractive" name="metadata" />
        </component>
        <slot v-if="mainInteractive" name="metadata" />
        <div v-if="snippet" class="abele-list-row__snippet">{{ snippet }}</div>
        <p
          v-if="state !== 'ready'"
          class="abele-list-row__state"
          :class="`abele-list-row__state_${state}`"
          :role="state === 'error' ? 'alert' : 'status'"
        >
          <Icon class="abele-list-row__status-icon" :icon="stateIcon[state]" no-hover />
          <span>{{ message || stateText[state] }}</span>
        </p>
        <div v-if="$slots.recovery" class="abele-list-row__recovery"><slot name="recovery" /></div>
        <div
          v-if="$slots.detail && expanded !== false"
          :id="detailId"
          class="abele-list-row__detail"
        >
          <slot name="detail" />
        </div>
        <div
          v-if="$slots.actions || expanded !== undefined"
          class="tree-item-flair-outer abele-list-row__actions"
        >
          <slot name="actions" />
          <Disclosure
            v-if="expanded !== undefined"
            compact
            control-only
            :target-id="detailId"
            :label="detailsLabel"
            :count="detailsCount"
            :model-value="expanded"
            @update:model-value="emit('update:expanded', $event)"
          />
        </div>
      </div>
    </div>
  </article>
</template>
<script setup lang="ts">
import { computed, useId } from 'vue'
import Icon from './Icon.vue'
import Disclosure from './Disclosure.vue'
import MetaLine, { type MetaFact } from './MetaLine.vue'
const props = withDefaults(
  defineProps<{
    title: string
    icon?: string
    facts?: MetaFact[]
    snippet?: string
    interactive?: boolean
    disabled?: boolean
    disabledReason?: string
    selected?: boolean
    state?: 'ready' | 'loading' | 'missing' | 'error' | 'waiting'
    message?: string
    preserveExtension?: boolean
    expanded?: boolean
    detailsLabel?: string
    detailsCount?: number
  }>(),
  { state: 'ready', selected: undefined, expanded: undefined, detailsLabel: 'Details' }
)
const emit = defineEmits<{ open: []; 'update:expanded': [expanded: boolean] }>()
const detailId = `abele-row-${useId()}`
const mainInteractive = computed(() => props.interactive || props.expanded !== undefined)
const openMain = () => {
  if (!mainInteractive.value || props.disabled) return
  if (props.interactive) emit('open')
  else emit('update:expanded', !props.expanded)
}
const extension = computed(() =>
  props.preserveExtension ? (/\.[\w-]{1,12}$/.exec(props.title)?.[0] ?? '') : ''
)
const stem = computed(() =>
  extension.value ? props.title.slice(0, -extension.value.length) : props.title
)
const stateText = {
  ready: '',
  loading: 'Refreshing…',
  missing: 'Object unavailable',
  error: 'Could not load object',
  waiting: 'Waiting for your answer',
}
const stateIcon = {
  ready: 'check',
  loading: 'loader-circle',
  missing: 'file-question',
  error: 'triangle-alert',
  waiting: 'circle-help',
}
</script>
<style>
.abele-list-row {
  min-width: 0;
  font-family: var(--font-interface);
  line-height: var(--line-height-normal);
}
.abele-list-row .abele-list-row__line {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
}
.abele-list-row .abele-list-row__content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: start;
  column-gap: var(--size-4-2);
  row-gap: var(--size-4-1);
  flex: 1;
  min-width: 0;
  overflow: visible;
  white-space: normal;
}
.abele-list-row__content > * {
  grid-column: 1 / -1;
}
.abele-list-row .abele-list-row__main,
.abele-list-row__title {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  padding: 0;
  margin: 0;
  height: auto;
  width: 100%;
  min-width: 0;
  text-align: start;
  white-space: normal;
  color: var(--text-normal);
  font: inherit;
  font-weight: var(--font-normal);
  border-radius: var(--radius-s);
}
.abele-list-row__title-line {
  display: flex;
  align-items: flex-end;
  min-width: 0;
}
.abele-list-row__title-text {
  flex: 0 1 auto;
  min-width: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.abele-list-row__extension {
  flex: 0 0 auto;
}
.abele-list-row__main.is-clickable {
  cursor: var(--cursor-link);
}
.abele-list-row__opener {
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 0;
  margin-inline-start: auto;
}
.abele-list-row__state {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-1);
}
.abele-list-row__status-icon {
  flex: 0 0 auto;
  padding: 0;
  min-height: 1lh;
}
.abele-list-row__state_error .abele-list-row__status-icon {
  color: var(--text-error);
}
.abele-list-row__state_missing .abele-list-row__status-icon,
.abele-list-row__state_waiting .abele-list-row__status-icon {
  color: var(--text-warning);
}
.abele-list-row__main > .abele-meta-line,
.abele-list-row__title > :not(.abele-list-row__title-line) {
  margin-top: var(--size-4-1);
}
.abele-list-row__title > .abele-relative-time {
  line-height: var(--line-height-normal);
}
.abele-list-row .abele-list-row__leading {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 0 0 auto;
  min-width: var(--icon-size);
  min-height: 1lh;
  height: auto;
  margin: 0;
}
.abele-list-row__leading .abele-obsidian-icon {
  min-height: 0;
  padding: 0;
}
.abele-list-row .abele-list-row__actions {
  display: flex;
  grid-column: 2;
  grid-row: 1;
  align-items: flex-start;
  gap: var(--size-2-1);
  margin: 0;
}
.abele-list-row__actions .abele-obsidian-icon {
  align-items: flex-start;
  padding-block: 0;
}
.abele-list-row__snippet,
.abele-list-row__state {
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-normal);
  color: var(--text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.abele-list-row__recovery {
  margin: 0;
}
.abele-list-row__detail {
  min-width: 0;
  margin: 0;
}
</style>
