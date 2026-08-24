<template>
  <div
    class="abele-tabs"
    :class="[`abele-tabs_${level}`, { 'abele-tabs_vertical': vertical }]"
    role="tablist"
  >
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="abele-tabs__tab"
      :class="{ 'abele-tabs__tab_active': tab.id === modelValue }"
      role="tab"
      tabindex="0"
      :aria-selected="tab.id === modelValue"
      @click="emit('update:modelValue', tab.id)"
      @keydown.enter.prevent="emit('update:modelValue', tab.id)"
      @keydown.space.prevent="emit('update:modelValue', tab.id)"
    >
      <span class="abele-tabs__label">{{ tab.label }}</span>
      <Icon v-if="vertical" icon="chevron-right" no-hover class="abele-tabs__chevron" />
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'

export interface Tab {
  id: string
  label: string
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
