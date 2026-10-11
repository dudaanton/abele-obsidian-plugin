<template>
  <span class="abele-change-codes">
    <span class="abele-change-codes__dot"
      ><StatusDot
        v-if="change.unseen"
        tone="accent"
        :label="`Changed since you looked · ${change.when ?? ''}`"
    /></span>
    <Icon
      :icon="changeGlyphs[change.kind].icon"
      :color="changeGlyphs[change.kind].color"
      size="xs"
      :tooltip="changeLabel(change)"
      :interactive="false"
    />
  </span>
</template>

<script setup lang="ts">
// What happened to a file, at the end of its row: the coloured square for the kind of change,
// and before it an accent dot while the change is one you have not looked at.
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import { changeGlyphs, changeLabel } from './codes'
import type { FileChange } from './types'

defineProps<{ change: FileChange }>()
</script>

<style lang="scss">
.abele-change-codes__glyph {
  display: inline-flex;
  justify-content: center;
  width: var(--icon-xs);
}
.abele-change-codes__dot {
  display: inline-flex;
  justify-content: center;
  width: var(--size-4-2);
}
.abele-change-codes {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);

  .abele-obsidian-icon {
    padding: 0;
  }
}
</style>
