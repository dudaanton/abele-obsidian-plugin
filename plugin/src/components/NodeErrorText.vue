<template>
  <span class="abele-node-error-words" :title="error || undefined">{{
    nodeErrorDetails(error)
  }}</span>
</template>

<script setup lang="ts">
import { nodeErrorDetails } from '@/node/errorWords'
defineProps<{ error?: string | null }>()
</script>

<style scoped>
.abele-node-error-words {
  min-width: 0;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
