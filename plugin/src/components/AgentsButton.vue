<template>
  <Icon
    icon="activity"
    with-bg
    :aria-label="agents.tooltip.value"
    :tooltip="agents.tooltip.value"
    :text-right="mark || undefined"
    @click="openAgents"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue'
import Icon from './obsidian/Icon.vue'
import { AgentsService } from '@/agents/AgentsService'
import { openAgents } from '@/agents/openAgents'
const props = defineProps<{ count?: number }>()
const agents = AgentsService.getInstance()
// How many conversations wait for you, as a number; the rest is in the tooltip.
const mark = computed(() =>
  (props.count ?? agents.badge.value.attention)
    ? String(props.count ?? agents.badge.value.attention)
    : ''
)
</script>
