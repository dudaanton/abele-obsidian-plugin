<template>
  <div
    class="abele-empty-state"
    :class="[`abele-empty-state_${variant}`, { 'abele-empty-state_centered': centered }]"
    :role="variant === 'error' ? 'alert' : 'status'"
    :aria-busy="variant === 'loading'"
  >
    <!-- The subject in a soft round, and what is the matter with it as a small badge on it. -->
    <span v-if="icon" class="abele-empty-state__mark" aria-hidden="true"
      ><span ref="iconEl" class="abele-empty-state__icon" /><span
        v-if="badge"
        ref="badgeEl"
        class="abele-empty-state__badge"
    /></span>
    <div v-if="title" class="abele-empty-state__title">{{ title }}</div>
    <div class="abele-empty-state__description">
      <slot>{{ text || labels[variant] }}</slot>
    </div>
    <div v-if="$slots.action" class="abele-empty-state__action"><slot name="action" /></div>
  </div>
</template>

<script setup lang="ts">
// What stands in place of a list that has nothing to show. On its own it is one muted line, as
// Obsidian's search says "No matches"; with an icon or a title it is the larger, centred block
// Nuxt UI calls Empty and Obsidian shows for a pane with no file open.
import { computed, ref, watch } from 'vue'
import { setIcon } from 'obsidian'

const props = withDefaults(
  defineProps<{
    text?: string
    variant?: 'empty' | 'no-matches' | 'loading' | 'error'
    /** A large glyph above, by Lucide name, for a whole pane that is empty. */
    icon?: string
    /** One line above the text that says what is missing. */
    title?: string
    /** A small glyph on the large one saying what is the matter: `power-off`, `search-x`. */
    badge?: string
  }>(),
  { variant: 'empty', text: undefined, icon: undefined, title: undefined, badge: undefined }
)
const labels = {
  empty: 'No items yet',
  'no-matches': 'No matches',
  loading: 'Loading…',
  error: 'Could not load items',
}

const centered = computed(() => !!props.icon || !!props.title)
const iconEl = ref<HTMLElement>()
const badgeEl = ref<HTMLElement>()
watch(
  [badgeEl, () => props.badge],
  ([el, name]) => {
    if (!el) return
    el.empty()
    if (name) setIcon(el, name)
  },
  { immediate: true }
)
watch(
  [iconEl, () => props.icon],
  ([el, name]) => {
    if (!el) return
    el.empty()
    if (name) setIcon(el, name)
  },
  { immediate: true }
)
</script>

<style lang="scss">
.abele-empty-state {
  padding: var(--size-4-3) 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-empty-state__action {
  margin-top: var(--size-4-2);
}

// The larger block: Obsidian's own empty pane is centred, its title in the normal text colour
// over a muted line, under an icon at the host's largest step.
.abele-empty-state_centered {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-4-1);
  padding: var(--size-4-4) var(--size-4-3);
  text-align: center;

  .abele-empty-state__action {
    margin-top: var(--size-4-2);
  }
}
.abele-empty-state__mark {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--icon-xl) * 2.25);
  height: calc(var(--icon-xl) * 2.25);
  margin-bottom: var(--size-4-3);
  border-radius: 50%;
  background-color: var(--background-secondary);
}

.abele-empty-state__icon {
  display: flex;
  color: var(--text-muted);
  --icon-size: var(--icon-xl);
  --icon-stroke: var(--icon-xl-stroke-width);
}

.abele-empty-state__badge {
  position: absolute;
  inset-inline-end: 0;
  bottom: 0;
  display: flex;
  padding: var(--size-2-2);
  border-radius: 50%;
  background-color: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  color: var(--text-faint);
  --icon-size: var(--icon-xs);
  --icon-stroke: var(--icon-xs-stroke-width);
}

.abele-empty-state__title {
  color: var(--text-normal);
  max-width: 28em;
  font-size: var(--font-ui-medium);
  font-weight: var(--font-medium);
}
</style>
