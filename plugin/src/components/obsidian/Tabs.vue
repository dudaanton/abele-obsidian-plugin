<template>
  <div
    class="abele-tabs"
    :class="[`abele-tabs_${level}`, { 'abele-tabs_vertical': vertical }]"
    role="tablist"
  >
    <div
      v-for="(tab, index) in tabs"
      :key="tab.id"
      :ref="(el) => applyTooltip(el, tab.tooltip)"
      class="abele-tabs__tab"
      :class="{
        'abele-tabs__tab_active': tab.id === modelValue,
        'abele-tabs__tab_disabled': tab.disabled,
      }"
      role="tab"
      :tabindex="index === focusable ? 0 : -1"
      :aria-selected="tab.id === modelValue"
      :aria-disabled="tab.disabled || undefined"
      @click="choose(tab)"
      @focus="showFocusedTab"
      @keydown.enter.prevent="choose(tab)"
      @keydown.space.prevent="choose(tab)"
      @keydown="move($event, index)"
    >
      <Icon v-if="tab.icon" :icon="tab.icon" no-hover class="abele-tabs__icon" />
      <span class="abele-tabs__label">{{ tab.label }}</span>
      <span v-if="tab.badge !== undefined" class="abele-tabs__badge">{{ tab.badge }}</span>
      <Icon v-if="vertical" icon="chevron-right" no-hover class="abele-tabs__chevron" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type ComponentPublicInstance } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from './Icon.vue'

export interface Tab {
  id: string
  label: string
  /** A glyph before the label, for a strip whose labels are too short to explain themselves. */
  icon?: string
  /** What this tab is, in a few words, for the same reason. */
  tooltip?: string
  /** A count beside the label: how many things wait inside. */
  badge?: string | number
  /** Seen but not open now. */
  disabled?: boolean
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

const props = withDefaults(
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

// A narrow, horizontally scrolling strip must bring the whole tab (and its ring) into view.
function showFocusedTab(event: FocusEvent): void {
  const tab = event.currentTarget as HTMLElement
  const strip = tab.parentElement
  if (strip && strip.scrollWidth > strip.clientWidth) {
    tab.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }
}

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

function choose(tab: Tab): void {
  if (!tab.disabled) emit('update:modelValue', tab.id)
}

// One tab in the Tab order, the chosen one, as a tab list has it; the arrows walk the rest.
const focusable = computed(() => {
  const chosen = props.tabs.findIndex((t) => t.id === props.modelValue && !t.disabled)
  return chosen >= 0 ? chosen : props.tabs.findIndex((t) => !t.disabled)
})

function move(event: KeyboardEvent, from: number): void {
  const back = props.vertical ? 'ArrowUp' : 'ArrowLeft'
  const forward = props.vertical ? 'ArrowDown' : 'ArrowRight'
  const open = props.tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0)
  if (!open.length) return
  const after = open.find((i) => i > from) ?? open[0]
  const before = [...open].reverse().find((i) => i < from) ?? open[open.length - 1]
  const next =
    event.key === forward
      ? after
      : event.key === back
        ? before
        : event.key === 'Home'
          ? open[0]
          : event.key === 'End'
            ? open[open.length - 1]
            : undefined
  if (next === undefined) return
  event.preventDefault()
  const strip = (event.currentTarget as HTMLElement).parentElement
  ;(strip?.children[next] as HTMLElement | undefined)?.focus()
}
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

.abele-tabs__badge {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}

.abele-tabs .abele-tabs__tab_disabled {
  &,
  &:hover {
    background-color: transparent;
    color: var(--text-faint);
    cursor: default;
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
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
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

/**
 * On a phone every horizontal strip stays one row and scrolls sideways, with the same theme
 * styling as before. Limiting this to secondary tabs left a dialog's primary navigation
 * wrapped on two rows. Vertical settings navigation remains a list.
 */
.is-phone .abele-tabs:not(.abele-tabs_vertical) {
  flex-wrap: nowrap;
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
  // Room for a focused tab's ring, which a scrolling box would otherwise cut. Not pulled back
  // with a negative margin: the strip then stood past its dialog's edge and scrolled it.
  padding: var(--size-2-2);

  &::-webkit-scrollbar {
    display: none;
  }

  .abele-tabs__tab {
    flex: 0 0 auto;
  }

  // A scrolling row does not scroll through its own end padding: the last tab, scrolled to the
  // end, stood cut against the edge. Room made of something that scrolls.
  &::after {
    content: '';
    flex: 0 0 var(--size-2-2);
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
