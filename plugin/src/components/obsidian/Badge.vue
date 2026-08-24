<template>
  <span class="abele-badge" :class="{ 'abele-badge_accent': accent }">{{ text }}</span>
</template>

<script setup lang="ts">
defineProps<{
  text: string
  accent?: boolean
}>()
</script>

<style lang="scss">
.abele-badge {
  flex: 0 0 auto;
  padding: 0 var(--size-2-2);
  border-radius: var(--radius-s);
  background-color: var(--background-modifier-hover);
  color: var(--text-muted);
  font-size: var(--font-smallest);
  white-space: nowrap;
}

.abele-badge_accent {
  background-color: var(--interactive-accent);
  color: var(--text-on-accent);
}
</style>
