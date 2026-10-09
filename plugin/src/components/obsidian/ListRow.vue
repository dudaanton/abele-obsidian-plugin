<template>
  <article
    class="abele-list-row search-result"
    :class="{ 'is-selected': selected }"
    :aria-busy="state === 'loading'"
  >
    <div class="abele-list-row__line">
      <div v-if="icon || $slots.leading" class="abele-list-row__leading">
        <slot name="leading"><Icon :icon="icon" no-hover /></slot>
      </div>
      <div class="abele-list-row__content">
        <button
          v-if="interactive"
          type="button"
          class="clickable-icon abele-list-row__main"
          :aria-pressed="selected"
          :aria-label="disabled && disabledReason ? `${title}: ${disabledReason}` : undefined"
          :disabled="disabled"
          @click="!disabled && emit('open')"
        >
          <span class="abele-list-row__title-text">{{ title }}</span>
        </button>
        <div v-else class="abele-list-row__title">{{ title }}</div>
        <slot name="metadata"><MetaLine v-if="facts?.length" :facts="facts" /></slot>
        <div v-if="snippet" class="abele-list-row__snippet">{{ snippet }}</div>
        <p
          v-if="state !== 'ready'"
          class="abele-list-row__state"
          :role="state === 'error' ? 'alert' : 'status'"
        >
          {{ message || stateText[state] }}
        </p>
      </div>
      <div v-if="$slots.actions" class="abele-list-row__actions"><slot name="actions" /></div>
    </div>
    <div v-if="$slots.detail" class="abele-list-row__detail"><slot name="detail" /></div>
  </article>
</template>
<script setup lang="ts">
import Icon from './Icon.vue'
import MetaLine, { type MetaFact } from './MetaLine.vue'
withDefaults(
  defineProps<{
    title: string
    icon?: string
    facts?: MetaFact[]
    snippet?: string
    interactive?: boolean
    disabled?: boolean
    disabledReason?: string
    selected?: boolean
    state?: 'ready' | 'loading' | 'missing' | 'error'
    message?: string
  }>(),
  { state: 'ready', selected: undefined }
)
const emit = defineEmits<{ open: [] }>()
const stateText = {
  ready: '',
  loading: 'Refreshing…',
  missing: 'Object unavailable',
  error: 'Could not load object',
}
</script>
<style>
.abele-list-row {
  padding: var(--size-4-2);
  min-width: 0;
  font-family: var(--font-interface);
  line-height: var(--line-height-normal);
  border-radius: var(--radius-s);
}
.abele-list-row.is-selected {
  background: var(--background-modifier-active-hover);
}
.abele-list-row__line {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-list-row__content {
  flex: 1;
  min-width: 0;
}
.abele-list-row__main,
.abele-list-row__title {
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  font-weight: var(--font-medium);
  overflow-wrap: anywhere;
  text-align: start;
}
.abele-list-row__main {
  padding: 0;
  width: 100%;
  justify-content: flex-start;
  white-space: normal;
  height: auto;
  min-height: var(--icon-size);
  display: flex;
}
.abele-list-row__title-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.abele-list-row__leading {
  display: flex;
  align-items: center;
  min-height: var(--icon-size);
}
body.is-phone .abele-list-row__leading {
  min-height: var(--abele-touch-min);
}
.abele-list-row__actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--size-4-1);
}
.abele-list-row__snippet,
.abele-list-row__state {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  margin: var(--size-4-1) 0 0;
  overflow-wrap: anywhere;
}
.abele-list-row__detail {
  min-width: 0;
  margin-top: var(--size-4-2);
}
</style>
