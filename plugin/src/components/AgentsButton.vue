<template>
  <Icon
    icon="activity"
    with-bg
    role="button"
    tabindex="0"
    :aria-label="agents.tooltip.value"
    :tooltip="agents.tooltip.value"
    :text-right="mark || undefined"
    @click="openAgents"
    @keydown.enter.prevent="openAgents"
    @keydown.space.prevent="openAgents"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue'
import Icon from './obsidian/Icon.vue'
import { AgentsService } from '@/agents/AgentsService'
import { openAgents } from '@/agents/openAgents'
const agents = AgentsService.getInstance()
const mark = computed(() =>
  `${agents.badge.value.mark}${agents.badge.value.incomplete ? ' ?' : ''}`.trim()
)
</script>
