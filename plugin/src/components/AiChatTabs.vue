<template>
  <div v-if="tabs.length > 1 || canCreate" class="abele-chat-tabs">
    <div ref="strip" class="abele-chat-tabs__list">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="abele-chat-tabs__chip"
        :class="{ 'abele-chat-tabs__chip--active': tab.isActive }"
        :title="tab.label || 'New chat'"
        @click="emit('select', tab.id)"
      >
        <span v-if="tab.isStreaming && !tab.isActive" class="abele-chat-tabs__dot" />
        <span class="abele-chat-tabs__label">{{ tab.label || 'New chat' }}</span>
        <Icon icon="x" class="abele-chat-tabs__close" @click.stop="emit('close', tab.id)" />
      </div>
    </div>
    <div class="abele-chat-tabs__add-wrap">
      <Icon
        icon="plus"
        class="abele-chat-tabs__add"
        :class="{ 'abele-chat-tabs__add--disabled': !canCreate }"
        @click="canCreate && emit('create')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import Icon from './obsidian/Icon.vue'

export interface TabInfo {
  id: string
  label: string
  isStreaming: boolean
  isActive: boolean
}

const props = defineProps<{
  tabs: TabInfo[]
  canCreate: boolean
}>()

const strip = ref<HTMLElement | null>(null)

/** The width of the fade the add button paints over the right end of the strip. */
const FADE_PX = 12

/**
 * Brings the active chip into the visible part of the strip.
 *
 * By the strip's own `scrollLeft`, not `scrollIntoView`: that scrolls every ancestor that can
 * move as well, and a sidebar is one of them. A new chat opens as the last chip, which on a
 * full strip is past its right edge, and it stayed there until scrolled to by hand.
 */
const revealActive = () => {
  const el = strip.value
  const chip = el?.querySelector<HTMLElement>('.abele-chat-tabs__chip--active')
  if (!el || !chip) return
  const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0
  const bounds = el.getBoundingClientRect()
  // Not laid out — a hidden sidebar, or a phone, where the strip is not shown at all.
  if (bounds.width === 0) return
  const rect = chip.getBoundingClientRect()
  const left = bounds.left + pad
  const right = bounds.right - pad - FADE_PX
  if (rect.left < left) el.scrollLeft += rect.left - left
  else if (rect.right > right) el.scrollLeft += rect.right - right
}

watch(
  () => props.tabs.find((tab) => tab.isActive)?.id,
  () => void nextTick(revealActive)
)
onMounted(revealActive)

const emit = defineEmits<{
  (e: 'select', tabId: string): void
  (e: 'close', tabId: string): void
  (e: 'create'): void
}>()
</script>

<style lang="scss">
.abele-chat-tabs {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  overflow: hidden;

  body.is-mobile & {
    display: none;
  }
}

.abele-chat-tabs__list {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  padding: var(--size-2-2) var(--size-4-2);
  // As wide as the fade the add button paints over this end, so the last chip, scrolled to,
  // stands clear of it rather than 4px under it.
  padding-right: var(--size-4-3);
  overflow-x: auto;
  flex: 1;
  min-width: 0;

  // Both spellings, and the standard one is the one that counts: Obsidian 1.12 sets
  // `scrollbar-width` on every element, and once that property is set Chromium ignores the
  // `::-webkit-scrollbar` pseudo-elements altogether — which is how a strip that had hidden
  // its scrollbar for a year grew one under the chips.
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.abele-chat-tabs__chip {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  padding: var(--size-2-1) var(--size-2-3);
  border-radius: var(--radius-s);
  cursor: pointer;
  white-space: nowrap;
  font-size: var(--font-smaller);
  color: var(--text-muted);
  background-color: var(--background-secondary);
  max-width: 150px;
  flex-shrink: 0;

  &:hover {
    background-color: var(--background-modifier-hover);
  }

  &--active {
    color: var(--text-normal);
    background-color: var(--background-modifier-hover);
  }
}

.abele-chat-tabs__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--interactive-accent);
  flex-shrink: 0;
  animation: abele-pulse 1.5s ease-in-out infinite;
}

@keyframes abele-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.abele-chat-tabs__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.abele-chat-tabs__close {
  flex-shrink: 0;
  opacity: 0.4;

  svg {
    width: 10px;
    height: 10px;
  }

  .abele-chat-tabs__chip:hover & {
    opacity: 0.7;
  }
}

.abele-chat-tabs__add-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 var(--size-4-2);
  margin-left: calc(-1 * var(--size-4-3));
  background: linear-gradient(to right, transparent, var(--background-primary) 8px);
  padding-left: var(--size-4-3);
}

.abele-chat-tabs__add {
  cursor: pointer;
  color: var(--text-muted);

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(.abele-chat-tabs__add--disabled) {
    color: var(--text-normal);
  }

  &--disabled {
    opacity: 0.3;
    cursor: default;
  }
}
</style>
