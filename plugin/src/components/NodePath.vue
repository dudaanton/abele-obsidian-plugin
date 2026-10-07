<template>
  <details class="abele-node-path">
    <summary :title="path">{{ label || shortNodePath(path) }}</summary>
    <code>{{ path }}</code>
  </details>
</template>
<script setup lang="ts">
import { shortNodePath } from '@/node/presentation'
defineProps<{ path: string; label?: string }>()
</script>
<style lang="scss">
.abele-node-path {
  min-width: 0;
  margin-block: var(--size-4-1);
}
.abele-node-path code {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: var(--size-4-1);
}
</style>
