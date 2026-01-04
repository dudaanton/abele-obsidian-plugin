<template>
  <div class="checkbox-container" :class="{ 'is-enabled': isEnabled }" @click="$emit('toggle')" />
</template>

<script setup lang="ts">
defineProps<{
  isEnabled: boolean
}>()

defineEmits<{
  (e: 'toggle'): void
}>()
</script>
