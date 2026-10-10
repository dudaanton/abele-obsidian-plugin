<template>
  <div
    class="abele-disclosure"
    :class="{
      'abele-disclosure_compact': compact,
      'abele-disclosure_open': modelValue,
      'abele-disclosure_disabled': disabled,
    }"
  >
    <button
      type="button"
      class="clickable-icon abele-disclosure__control"
      :aria-label="accessibleLabel"
      :aria-expanded="modelValue"
      :aria-controls="contentId"
      :disabled="disabled"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span
        ref="glyph"
        class="collapse-icon abele-disclosure__icon"
        :class="{ 'is-collapsed': !modelValue }"
        aria-hidden="true"
      />
      <template v-if="!compact"
        ><span class="abele-disclosure__label"
          ><slot name="label">{{ label }}</slot></span
        ><span v-if="count !== undefined" class="abele-disclosure__count">{{
          count
        }}</span></template
      >
    </button>
    <div v-if="modelValue && !controlOnly" :id="contentId" class="abele-disclosure__content">
      <slot />
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, useId } from 'vue'
import { setIcon } from 'obsidian'
import './designKit.css'
// Obsidian's own fold: its triangle and its icon button. What Nuxt UI calls a Collapsible.
const props = defineProps<{
  /** What is folded away, in a few words; also what a screen reader hears. */
  label: string
  modelValue: boolean
  /** How many things are inside, beside the label. */
  count?: number
  /** Only the triangle, for a row that already carries its own label. */
  compact?: boolean
  /** The button alone; the content is somewhere else, named by `targetId`. */
  controlOnly?: boolean
  targetId?: string
  /** Cannot be opened or closed now. */
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [expanded: boolean] }>()
const id = useId()
const contentId = computed(() => props.targetId ?? `abele-disclosure-${id}`)
const accessibleLabel = computed(() =>
  props.count !== undefined ? `${props.label} ${props.count}` : props.label
)
const glyph = ref<HTMLElement>()
onMounted(() => {
  if (glyph.value) setIcon(glyph.value, 'right-triangle')
})
</script>
<style>
.abele-disclosure .abele-disclosure__control {
  display: inline-flex;
  align-items: flex-start;
  gap: var(--size-4-1);
  justify-content: flex-start;
  padding: 0;
  position: relative;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-normal);
  white-space: normal;
  text-align: start;
}
/* As a disabled icon is drawn in the kit: faint, and no hover box. */
.abele-disclosure .abele-disclosure__control:disabled,
.abele-disclosure .abele-disclosure__control:disabled:hover {
  color: var(--text-faint);
  background-color: transparent;
  cursor: default;
}
.abele-disclosure__count {
  color: var(--text-muted);
  font-weight: var(--font-normal);
}
.abele-disclosure__content {
  margin-inline-start: var(--size-4-4);
  margin-top: var(--size-4-1);
  min-width: 0;
  overflow-wrap: anywhere;
}
.abele-disclosure_compact .abele-disclosure__control {
  font: inherit;
}
.abele-disclosure:not(.abele-disclosure_compact) .abele-disclosure__control .collapse-icon {
  position: absolute;
  inset-inline-start: calc(-1 * var(--size-4-4));
}
.abele-disclosure__control .collapse-icon {
  display: flex;
  align-items: center;
  height: 1lh;
}
</style>
