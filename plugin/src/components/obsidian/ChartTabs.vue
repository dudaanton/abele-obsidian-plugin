<template>
  <div class="abele-chart-tabs">
    <div
      v-for="tab in tabs"
      :key="tab.key"
      class="abele-chart-tabs__tab"
      :class="{ 'abele-chart-tabs__tab--active': modelValue === tab.key }"
      @click="$emit('update:modelValue', tab.key)"
    >
      {{ tab.label }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string
  tabs: Array<{ key: string; label: string }>
}>()

defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()
</script>

<style lang="scss">
.abele-chart-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
  margin-top: calc(var(--p-spacing) * 1.5);
}

.abele-chart-tabs__tab {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  cursor: pointer;
  padding: var(--size-2-1) var(--size-4-2);
  border-radius: var(--radius-s);

  &:hover {
    color: var(--text-normal);
    background-color: var(--background-modifier-hover);
  }

  &--active {
    color: var(--text-normal);
    font-weight: var(--font-semibold);
    background-color: var(--background-modifier-hover);
  }
}
</style>
