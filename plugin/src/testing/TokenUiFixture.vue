<template>
  <Modal
    v-if="screen === 'connections' || screen === 'states' || screen === 'empty'"
    title="Sync settings"
    size="tall"
    @close="emit('close')"
    ><SyncSettings :model="ui"
  /></Modal>
  <TokenDialogs
    v-else
    :ui="ui"
    :mode="mode"
    :connection-id="ui.rows.value[0]?.id"
    :candidate="ui.candidates.value[0]"
    :question="ui.questions.value[0]"
    @close="emit('close')"
  />
</template>
<script setup lang="ts">
import { computed, onMounted, nextTick } from 'vue'
import Modal from '@/components/obsidian/Modal.vue'
import SyncSettings from '@/components/settings/SyncSettings.vue'
import TokenDialogs from '@/components/sync/TokenDialogs.vue'
import { tokenUiFixture, sampleIssuedToken } from './tokenUiFixture'
import type { TokenUi } from '@/sync/tokenUi'
const props = defineProps<{
  screen:
    | 'connections'
    | 'states'
    | 'empty'
    | 'connect'
    | 'connect-token'
    | 'connect-error'
    | 'share'
    | 'share-token'
    | 'review'
    | 'attachment'
    | 'disconnect'
}>()
const emit = defineEmits<{ close: [] }>()
const ui: TokenUi = tokenUiFixture(props.screen === 'empty')
if (props.screen === 'states') {
  const id = ui.rows.value[0].id
  ui.publish(id, {
    missingKeptCopies: ['Sample collection/Missing kept copy.md'],
    error: 'A kept-copy location must be resolved before syncing.',
  })
}
const mode = computed(() =>
  props.screen === 'connect-error'
    ? 'connect'
    : props.screen === 'share-token'
      ? 'share'
      : ['review', 'attachment', 'disconnect', 'share'].includes(props.screen)
        ? (props.screen as 'review' | 'attachment' | 'disconnect' | 'share')
        : 'connect'
)
onMounted(async () => {
  await nextTick()
  if (props.screen === 'connect-error' || props.screen === 'connect-token') {
    const modal = Array.from(document.querySelectorAll('.modal.abele-modal')).at(-1)
    const input = modal?.querySelector<HTMLInputElement>('input[type=password]')
    if (input) {
      input.value = props.screen === 'connect-token' ? sampleIssuedToken : 'broken'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await nextTick()
    if (props.screen === 'connect-error') {
      Array.from(modal?.querySelectorAll('button') ?? [])
        .find((one) => one.textContent?.trim() === 'Connect')
        ?.click()
    }
  }
  if (props.screen === 'share-token') {
    // Synthetic API only; the actual issue button still owns the rendering and request path.
    await new Promise((resolve) => window.setTimeout(resolve, 100))
    const modal = Array.from(document.querySelectorAll('.modal.abele-modal')).at(-1)
    const input = modal?.querySelector<HTMLInputElement>('input:not([type=password])')
    if (input) {
      input.value = 'Sample second device'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await nextTick()
    Array.from(modal?.querySelectorAll('button') ?? [])
      .find((one) => one.textContent?.trim() === 'Get token')
      ?.click()
  }
})
</script>
