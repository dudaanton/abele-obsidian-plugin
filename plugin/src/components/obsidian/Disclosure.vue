<template>
  <div
    class="abele-disclosure"
    :class="{
      'abele-disclosure_compact': compact,
      'abele-disclosure_open': modelValue,
      'abele-disclosure_disabled': disabled,
    }"
  >
    <!-- Only the arrow, for a row that carries its own words: an ordinary clickable icon. -->
    <Icon
      v-if="compact"
      class="abele-disclosure__control"
      :icon="modelValue ? 'chevron-down' : 'chevron-right'"
      :tooltip="accessibleLabel"
      :aria-expanded="modelValue"
      :aria-controls="contentId"
      :disabled="disabled"
      @click="emit('update:modelValue', !modelValue)"
    />
    <!-- With words: the same fold title as every list's, arrow and words lit up as one. -->
    <FoldHeading
      v-else
      class="abele-disclosure__control"
      :text="label"
      :count="count"
      collapsible
      :hang="false"
      :collapsed="!modelValue"
      :disabled="disabled"
      :aria-controls="contentId"
      @toggle="emit('update:modelValue', !modelValue)"
    >
      <template v-if="$slots.label" #text><slot name="label" /></template>
    </FoldHeading>
    <div v-if="modelValue && !controlOnly" :id="contentId" class="abele-disclosure__content">
      <slot />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, useId } from 'vue'
import FoldHeading from './FoldHeading.vue'
import Icon from './Icon.vue'
import './designKit.css'
// What Nuxt UI calls a Collapsible, made of the kit's own fold: FoldHeading with words, or a
// clickable arrow alone. No fold of its own.
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
// The arrow alone has no words: its tooltip and its name say what it folds, and how many.
const accessibleLabel = computed(() =>
  props.count !== undefined ? `${props.label} ${props.count}` : props.label
)
</script>
<style>
/* Details folded away are told in the quiet size of a row's facts: a title's fold, a step down. */
.abele-disclosure:not(.abele-disclosure_compact) > .abele-disclosure__control {
  color: var(--abele-text-meta-color);
  font-size: var(--abele-text-meta-size);
}
/* Under the control, on the same edge as its arrow. */
.abele-disclosure__content {
  margin-top: var(--size-4-1);
  min-width: 0;
  overflow-wrap: anywhere;
}
.abele-disclosure_compact .abele-disclosure__content {
  margin-inline-start: 0;
}
</style>
