<template>
  <div class="abele-call-note" role="status">{{ text }}</div>
</template>

<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<style>
.abele-call-note {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
</style>
