<template>
  <div
    v-if="codes.length"
    class="abele-canvas-card-codes"
    role="group"
    :aria-label="t('streamC.369ae91334e959a8')"
  >
    <Icon
      v-for="code in codes"
      :key="code.key"
      :icon="code.icon"
      :text-right="String(code.count)"
      :label="code.label"
      :tooltip="code.label"
      size="xs"
      interactive
      class="abele-canvas-card-codes__code"
      @pointerdown.stop
      @click="emit('open', code.key)"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

// What a note's footer holds, as a quiet row of codes along the foot of a card too small to show
// the lists themselves: a glyph and a count each, the words in the tooltip. A click opens the note
// in a tab beside the canvas, at that list.
import Icon from '@/components/obsidian/Icon.vue'

export type CardCode = { key: string; icon: string; count: number; label: string }

defineProps<{ codes: CardCode[] }>()
const emit = defineEmits<{ open: [key: string] }>()
</script>

<style>
.abele-canvas-card-codes {
  zoom: calc(1 / var(--abele-card-zoom, 1));
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  display: flex;
  gap: var(--size-2-2);
  padding: var(--size-2-2) var(--size-4-2);
  background-color: var(--background-primary);
  border-top: 1px solid var(--background-modifier-border);
}
.abele-canvas-card-codes__code {
  gap: var(--size-2-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
</style>
