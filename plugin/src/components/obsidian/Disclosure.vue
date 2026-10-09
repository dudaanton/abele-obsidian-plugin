<template>
  <div class="abele-disclosure" :class="{ 'abele-disclosure_compact': compact }">
    <button
      type="button"
      class="clickable-icon abele-disclosure__control"
      :aria-label="accessibleLabel"
      :aria-expanded="modelValue"
      :aria-controls="contentId"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span
        ref="glyph"
        class="collapse-icon"
        :class="{ 'is-collapsed': !modelValue }"
        aria-hidden="true"
      />
      <template v-if="!compact"
        ><span>{{ label }}</span
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
const props = defineProps<{
  label: string
  modelValue: boolean
  count?: number
  compact?: boolean
  controlOnly?: boolean
  targetId?: string
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
  padding-block: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-normal);
  white-space: normal;
  text-align: start;
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
.abele-disclosure__control .collapse-icon {
  display: flex;
  align-items: center;
  height: 1lh;
}
</style>
