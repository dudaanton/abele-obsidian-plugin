<template>
  <div
    class="abele-tabs"
    :class="[`abele-tabs_${level}`, { 'abele-tabs_vertical': vertical }]"
    role="tablist"
  >
    <div
      v-for="tab in tabs"
      :key="tab.id"
      :ref="(el) => applyTooltip(el, tab.tooltip)"
      class="abele-tabs__tab"
      :class="{ 'abele-tabs__tab_active': tab.id === modelValue }"
      role="tab"
      tabindex="0"
      :aria-selected="tab.id === modelValue"
      @click="emit('update:modelValue', tab.id)"
      @keydown.enter.prevent="emit('update:modelValue', tab.id)"
      @keydown.space.prevent="emit('update:modelValue', tab.id)"
    >
      <Icon v-if="tab.icon" :icon="tab.icon" no-hover class="abele-tabs__icon" />
      <span class="abele-tabs__label">{{ tab.label }}</span>
      <Icon v-if="vertical" icon="chevron-right" no-hover class="abele-tabs__chevron" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from './Icon.vue'

export interface Tab {
  id: string
  label: string
  /** A glyph before the label, for a strip whose labels are too short to explain themselves. */
  icon?: string
  /** What this tab is, in a few words, for the same reason. */
  tooltip?: string
}

/**
 * Obsidian's own tooltip rather than the browser's `title`, as everywhere else in the kit.
 * A function ref because there is one element per tab and they come and go with the list.
 */
function applyTooltip(
  el: Element | ComponentPublicInstance | null,
  tooltip: string | undefined
): void {
  if (el instanceof HTMLElement) setTooltip(el, tooltip ?? '')
}

withDefaults(
  defineProps<{
    tabs: Tab[]
    modelValue: string
    /** `primary` for a screen's own navigation, `secondary` for a strip nested inside one. */
    level?: 'primary' | 'secondary'
    /** A list you descend into, for a phone. */
    vertical?: boolean
  }>(),
  { level: 'primary', vertical: false }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()
</script>

<style lang="scss">
/**
 * A tab is a `div`, not a `button`: Obsidian's `button:not(.clickable-icon)` outranks any
 * single class of ours, so a `button` here would always render as a default grey button.
 */
.abele-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
}

.abele-tabs__tab {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  padding: var(--size-4-1) var(--size-4-3);
  border-radius: var(--radius-s);
  color: var(--text-muted);
  cursor: var(--cursor-link);
  user-select: none;
  min-width: 0;

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }
}

/* At the size of the label it stands beside: the kit's default 18px would outweigh a digit. */
.abele-tabs__icon {
  flex: 0 0 auto;
  --icon-size: var(--icon-xs);
  height: auto;
  padding: 0;
}

.abele-tabs__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-tabs_primary .abele-tabs__tab_active {
  &,
  &:hover {
    background-color: var(--interactive-accent);
    color: var(--text-on-accent);
  }
}

.abele-tabs_secondary {
  .abele-tabs__tab {
    font-size: var(--font-ui-small);
  }

  .abele-tabs__tab_active {
    &,
    &:hover {
      background-color: var(--background-modifier-hover);
      color: var(--text-normal);
      font-weight: var(--font-medium);
    }
  }
}

.abele-tabs_vertical {
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 0;

  .abele-tabs__tab {
    justify-content: space-between;
    padding: var(--size-4-2) var(--size-4-3);
    border-radius: 0;
    color: var(--text-normal);
  }

  .abele-tabs__tab_active {
    &,
    &:hover {
      background-color: var(--background-modifier-hover);
      color: var(--text-normal);
    }
  }
}

.abele-tabs__chevron {
  flex: 0 0 auto;
}
</style>
