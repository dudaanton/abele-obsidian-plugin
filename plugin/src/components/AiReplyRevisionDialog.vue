<template>
  <!-- A change the agent proposes to a passage of its reply: who asked and when on one quiet
       line, the request as a quote, the difference; then one decision. Closing decides later. -->
  <ObsidianModal :title="t('streamB.changeToAReply.92bcbc')" size="tall" @close="emit('close')">
    <div class="abele-reply-revision">
      <p class="abele-reply-revision__meta">
        {{ proposal.author }} · {{ formatTimestamp(proposal.at, { diagnostic: true }).exact }}
      </p>
      <Quote :text="proposal.request" />
      <p v-if="proposal.application === 'pending'" class="abele-reply-revision__meta">
        {{ t('streamB.acceptedNotAppliedYetAfterwardsItCan.8dae12') }}
      </p>
      <Diff :text-left="proposal.old" :text-right="proposal.text" />
      <p v-if="error" role="alert" class="abele-reply-revision__error">
        {{ presentUiError(error) }}
      </p>
    </div>
    <template #footer>
      <Button
        v-if="proposal.status === 'pending' && proposal.application !== 'pending'"
        :text="t('streamB.reject.ab604a')"
        :disabled="busy"
        @click="choose(false)"
      />
      <Button
        :text="
          proposal.application === 'pending'
            ? t('streamB.finishApplying.2018d3')
            : t('streamB.accept.89713b')
        "
        :tooltip="t('streamB.onlyThisPassageChangesTheReplyBefore.8bc06d')"
        accent
        :disabled="busy"
        @click="choose(true)"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { ref } from 'vue'
import { streamBTime as formatTimestamp } from '@/i18n/streamBDate'
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
    error.value = presentUiError(cause)
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
