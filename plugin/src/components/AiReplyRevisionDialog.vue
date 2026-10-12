<template>
  <!-- A change the agent proposes to a passage of its reply: who asked and when on one quiet
       line, the request as a quote, the difference; then one decision. Closing decides later. -->
  <ObsidianModal title="Change to a reply" size="tall" @close="emit('close')">
    <div class="abele-reply-revision">
      <p class="abele-reply-revision__meta">
        {{ proposal.author }} · {{ formatTimestamp(proposal.at, { diagnostic: true }).exact }}
      </p>
      <Quote :text="proposal.request" />
      <p v-if="proposal.application === 'pending'" class="abele-reply-revision__meta">
        Accepted, not applied yet. Afterwards it can be undone from the reply.
      </p>
      <Diff :text-left="proposal.old" :text-right="proposal.text" />
      <p v-if="error" role="alert" class="abele-reply-revision__error">{{ error }}</p>
    </div>
    <template #footer>
      <Button
        v-if="proposal.status === 'pending' && proposal.application !== 'pending'"
        text="Reject"
        :disabled="busy"
        @click="choose(false)"
      />
      <Button
        :text="proposal.application === 'pending' ? 'Finish applying' : 'Accept'"
        tooltip="Only this passage changes; the reply before stays one click away"
        accent
        :disabled="busy"
        @click="choose(true)"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { formatTimestamp } from '@/helpers/displayFormat'
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import Quote from './obsidian/Quote.vue'
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
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
  overflow-wrap: anywhere;
  p {
    margin: 0;
  }
  .abele-diff {
    max-width: 100%;
    overflow: auto;
  }
  &__meta {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
  &__error {
    color: var(--text-error);
  }
}
</style>
