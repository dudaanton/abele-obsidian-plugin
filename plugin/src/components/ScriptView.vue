<template>
  <div class="abele-script-view" :data-id="model.id">
    <EmptyState
      v-if="model.status.kind === 'starting'"
      :text="`Starting ${model.status.script}…`"
    />
    <EmptyState v-else-if="model.status.kind === 'failed'" :text="model.status.message" />
    <div v-else class="abele-script-view__title">{{ model.view?.title }}</div>
  </div>
</template>

<script setup lang="ts">
import EmptyState from './obsidian/EmptyState.vue'
import type { ScriptViewModel } from '@/views/ScriptView'
defineProps<{ model: ScriptViewModel }>()
</script>
