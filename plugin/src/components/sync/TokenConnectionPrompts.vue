<template>
  <HeldDeletesModal
    v-if="held"
    :key="'held-' + held.key"
    :held="held.held"
    :port="port"
    @close="port.heldPrompt.close()"
  />
  <SettingsArrivedModal
    v-else-if="settings"
    :key="'settings-' + settings.key"
    :changes="settings.changes"
    :names="settings.names"
    :question-key="settings.key"
    :port="port"
    @close="port.settingsPrompt.later($event)"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { TokenUi } from '@/sync/tokenUi'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import HeldDeletesModal from './HeldDeletesModal.vue'
import SettingsArrivedModal from './SettingsArrivedModal.vue'
const props = defineProps<{ ui: TokenUi; connectionId: string }>()
const port = TokenSettingsPort.forConnection(props.ui, props.connectionId)
const held = computed(() => port.heldPrompt.asking.value)
const settings = computed(() => port.settingsPrompt.asking.value)
</script>
