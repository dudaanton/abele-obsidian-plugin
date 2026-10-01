<template>
  <ObsidianModal title="Review reply revision" @close="emit('close')">
    <div class="abele-reply-revision">
      <p>{{ proposal.author }} · {{ new Date(proposal.at).toLocaleString() }}</p>
      <blockquote>{{ proposal.request }}</blockquote>
      <p>Only this passage will change. The original stays available in the parent reply.</p>
      <p>Before → proposed replacement</p>
      <Diff :text-left="proposal.old" :text-right="proposal.text" />
      <p v-if="error" role="alert" class="abele-reply-revision__error">{{ error }}</p>
    </div>
    <template #footer>
      <Button text="Accept" :disabled="busy" @click="choose(true)" />
      <Button text="Reject" :disabled="busy" @click="choose(false)" />
      <Button text="Later" :disabled="busy" @click="emit('close')" />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import Diff from './Diff.vue'
import type { ReplyProposal } from '@/ai/replyAnnotations'

const props = defineProps<{
  proposal: ReplyProposal
  decide: (accepted: boolean) => Promise<void>
}>()
const emit = defineEmits<{ (e: 'close'): void }>()
const busy = ref(false)
const error = ref('')
async function choose(accepted: boolean) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await props.decide(accepted)
    emit('close')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
</script>

<style lang="scss">
.abele-reply-revision {
  min-width: 0;
  overflow-wrap: anywhere;
  .abele-diff {
    max-width: 100%;
    overflow: auto;
  }
  &__error {
    color: var(--text-error);
  }
}
</style>
