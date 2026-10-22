<template>
  <section class="abele-node-manager-run">
    <p data-manager-state class="abele-node-manager-run__state">
      <StatusDot :tone="stateTone" :label="stateLabel" :pulse="card.run.state === 'running'" />
      <span>{{ stateLabel }}</span>
    </p>
    <AiToolApproval
      v-for="prompt in card.prompts"
      :key="prompt.prompt_id"
      :message="message(prompt)"
      :node-prompt="prompt"
      :disabled="disabled"
      :answer-state="card.answers[prompt.prompt_id]"
      @answer="(choice, value) => emit('answer', prompt, choice, value)"
      @stop="emit('cancel')"
    />
    <Button
      v-if="['pending_approval', 'running'].includes(card.run.state) && !card.prompts.length"
      plain
      :text="t('streamB.stop.cae7d5')"
      :disabled="disabled"
      @click="emit('cancel')"
    />
    <ul v-if="card.run.conflicting_files?.length">
      <li v-for="path in card.run.conflicting_files" :key="path">
        <code>{{ path }}</code>
      </li>
    </ul>
    <Disclosure v-model="outputOpen" :label="t('node.manager.output')" data-manager-output>
      <p v-if="card.run.exit_code !== undefined && card.run.exit_code !== null">
        {{ t('node.manager.exitCode', { code: String(card.run.exit_code) }) }}
      </p>
      <p v-if="card.run.reason">{{ nodeErrorDetails(card.run.reason) }}</p>
      <p v-if="card.run.stdout_truncated || card.run.stderr_truncated">
        {{ t('node.manager.truncated') }}
      </p>
      <pre>{{ card.run.stdout }}</pre>
      <pre>{{ card.run.stderr }}</pre>
    </Disclosure>
  </section>
</template>
<script setup lang="ts">
import type { Prompt } from '@abele/node-client'
import type { NodeManagerController } from '@/node/NodeManagerController'
import type { ChatMessage } from '@/ai/types'
import { computed, ref, watch } from 'vue'
import { streamBLabel } from '@/i18n/streamBLabels'
import { nodeErrorDetails } from '@/node/errorWords'
import { t } from '@/i18n'
import Disclosure from './obsidian/Disclosure.vue'
import Button from './obsidian/Button.vue'
import AiToolApproval from './AiToolApproval.vue'
import StatusDot from './obsidian/StatusDot.vue'
const props = defineProps<{
  card: Awaited<ReturnType<NodeManagerController['cards']>>[number]
  disabled?: boolean
}>()
const outputOpen = ref(props.card.run.state === 'running')
watch(
  () => props.card.run.state,
  (state) => {
    outputOpen.value = state === 'running'
  }
)
const stateLabel = computed(() => {
  switch (props.card.run.state) {
    case 'pending_approval':
      return t('node.manager.pending')
    case 'exited':
      return t('node.manager.exited')
    case 'timed_out':
      return t('node.manager.timedOut')
    case 'denied':
      return t('node.manager.denied')
    case 'outcome_unknown':
      return t('node.error.unknownOutcome')
    case 'running':
      return t('node.manager.running')
    case 'cancelled':
      return t('node.manager.cancelled')
    case 'applied':
      return t('node.manager.applied')
    case 'failed':
      return t('node.manager.failed')
    default:
      return streamBLabel(props.card.run.state)
  }
})
const stateTone = computed(() => {
  const state = props.card.run.state
  if (['exited', 'applied'].includes(state)) return 'green'
  if (['failed', 'timed_out'].includes(state)) return 'red'
  if (['cancelled', 'denied'].includes(state)) return 'faint'
  if (state === 'running') return 'accent'
  return 'orange'
})
const emit = defineEmits<{
  answer: [prompt: Prompt, choice: 'allow' | 'deny', value?: string]
  cancel: []
}>()
const message = (prompt: Prompt) =>
  ({
    id: prompt.prompt_id,
    role: 'tool-call',
    content: '',
    toolName: prompt.tool_name,
    toolParams: prompt.input,
  }) as ChatMessage
</script>
<style scoped>
.abele-node-manager-run {
  min-width: 0;
  overflow-wrap: anywhere;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.abele-node-manager-run__state {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}
</style>
