<template>
  <component
    :is="card.run.state === 'pending_approval' ? 'section' : RequestCard"
    class="abele-node-manager-run"
  >
    <template v-if="card.run.state !== 'pending_approval'">
      <div v-if="justification" class="abele-node-manager-run__request">
        <Icon icon="square-terminal" size="xs" :interactive="false" />
        <Button
          quiet
          wrap
          :text="justification"
          :tooltip="justification"
          :title="justification"
          class="abele-command-justification"
          :class="{ 'is-expanded': justificationOpen }"
          data-command-justification
          :aria-expanded="justificationOpen"
          @click="justificationOpen = !justificationOpen"
        />
      </div>
      <code data-manager-command>{{
        card.argv ? commandLine(card.argv) : card.command || card.title
      }}</code>
      <div v-if="card.folder" class="abele-node-manager-run__folder">
        <Icon icon="folder" size="xs" :interactive="false" />
        <span class="abele-command-folder" :title="card.folder">{{
          card.folderLabel || commandFolder(card.folder)
        }}</span>
      </div>
    </template>
    <NodeErrorLine
      v-if="failure"
      data-manager-state
      original
      :error="failure"
      :text="failed ? resultLabel : undefined"
      :registration-id="registrationId"
      :operation="card.title"
      :disabled="disabled"
      :refresh="refresh"
      :retry="retry"
    >
      <template v-if="failed" #evidence>
        <pre>{{ originalEvidence }}</pre>
      </template>
    </NodeErrorLine>
    <div
      v-else-if="card.run.state !== 'pending_approval' || card.run.reason"
      class="abele-node-manager-run__status"
      data-manager-state
    >
      <StatusDot
        :tone="
          failed
            ? 'red'
            : card.run.state === 'running'
              ? 'accent'
              : ['exited', 'applied'].includes(card.run.state)
                ? 'green'
                : 'faint'
        "
        :label="resultLabel"
        :pulse="card.run.state === 'running'"
      />
      <MetaLine :facts="[{ key: '0', value: resultLabel }]" />
    </div>
    <!-- Asked although the chat said without asking: the node's own switch, the same as on the
         Access tab, as a command to copy. -->
    <NodeBypassHelp v-if="card.run.reason?.includes('node_bypass_disabled')" />
    <Disclosure
      v-if="failed && !failure"
      v-model="originalOpen"
      :label="t('streamB.originalAction.67ccdf')"
    >
      <pre>{{ originalEvidence }}</pre>
    </Disclosure>
    <AiToolApproval
      v-for="prompt in card.prompts"
      :key="prompt.prompt_id"
      :message="message(prompt)"
      :node-prompt="prompt"
      :folder-label="card.folderLabel"
      :disabled="disabled"
      :answer-state="card.answers[prompt.prompt_id]"
      @answer="(choice, value) => emit('answer', prompt, choice, value)"
      @stop="emit('cancel')"
    />
    <div
      v-if="['pending_approval', 'running'].includes(card.run.state) && !card.prompts.length"
      class="abele-node-manager-run__actions"
      data-manager-stop
    >
      <Button :text="t('streamB.stop.cae7d5')" :disabled="disabled" @click="emit('cancel')" />
    </div>
    <ul v-if="card.run.conflicting_files?.length">
      <li v-for="path in card.run.conflicting_files" :key="path">
        <code>{{ path }}</code>
      </li>
    </ul>
    <Disclosure
      v-if="
        card.run.stdout || card.run.stderr || card.run.stdout_truncated || card.run.stderr_truncated
      "
      v-model="outputOpen"
      :label="t('node.manager.output')"
      data-manager-output
    >
      <p v-if="card.run.stdout_truncated || card.run.stderr_truncated">
        {{ t('node.manager.truncated') }}
      </p>
      <pre
        ref="output"
        class="abele-node-manager-run__output"
        role="log"
        aria-live="off"
        :aria-label="t('node.manager.output')"
        >{{ [card.run.stdout, card.run.stderr].filter(Boolean).join('\n') }}</pre
      >
    </Disclosure>
  </component>
</template>
<script setup lang="ts">
import type { Prompt } from '@abele/node-client'
import type { NodeManagerController } from '@/node/NodeManagerController'
import type { ChatMessage } from '@/ai/types'
import { computed, ref, watch, nextTick } from 'vue'
import { streamBLabel } from '@/i18n/streamBLabels'
import { nodeErrorWords } from '@/node/errorWords'
import NodeErrorLine from './nodeWork/NodeErrorLine.vue'
import { t } from '@/i18n'
import Disclosure from './obsidian/Disclosure.vue'
import Button from './obsidian/Button.vue'
import AiToolApproval from './AiToolApproval.vue'
import RequestCard from './obsidian/RequestCard.vue'
import MetaLine from './obsidian/MetaLine.vue'
import Icon from './obsidian/Icon.vue'
import StatusDot from './obsidian/StatusDot.vue'
import NodeBypassHelp from './NodeBypassHelp.vue'
import { commandLine, commandFolder } from '@/node/commandPresentation'
import { displayCommandJustification } from '@/node/commandJustification'
const props = defineProps<{
  card: Awaited<ReturnType<NodeManagerController['cards']>>[number]
  disabled?: boolean
  registrationId?: string
  refresh?: () => Promise<unknown>
  retry?: () => Promise<unknown>
}>()
const failure = computed(() =>
  ['failed', 'timed_out', 'outcome_unknown', 'denied'].includes(props.card.run.state)
    ? (props.card.run.state === 'outcome_unknown'
        ? `outcome_unknown: ${props.card.run.reason ?? ''}`
        : props.card.run.reason) ||
      (props.card.run.state === 'denied' ? 'permission_denied' : props.card.run.state)
    : ''
)
const justification = computed(() => displayCommandJustification(props.card.justification ?? ''))
const justificationOpen = ref(false)
const originalOpen = ref(false)
const oldNode = computed(
  () =>
    props.card.run.reason === t('node.manager.contextUpdate') ||
    props.card.run.reason?.includes('command_context_v1')
)
const originalEvidence = computed(() =>
  JSON.stringify(
    {
      command: props.card.command,
      argv: props.card.argv,
      folder: props.card.folder,
      reason: props.card.run.reason,
      required_capability: oldNode.value ? 'command_context_v1' : undefined,
    },
    null,
    2
  )
)
const failed = computed(
  () =>
    ['failed', 'timed_out'].includes(props.card.run.state) || (props.card.run.exit_code ?? 0) !== 0
)
const resultLabel = computed(() => {
  const run = props.card.run
  if (oldNode.value) return t('node.manager.contextUpdate')
  if (run.reason?.includes('node_bypass_disabled')) return t('node.manager.bypassDisabled')
  if (run.reason && failed.value) {
    if (/unsafe_path|not_found/.test(run.reason) && /cwd/.test(run.reason))
      return t('node.manager.folderMissing')
    if (run.session_id === 'unsubmitted-command' && !/^[a-z_]+:/.test(run.reason)) return run.reason
    return run.reason.match(/^[a-z_]+:\s*(.+)$/)?.[1] ?? nodeErrorWords(run.reason).split(' (')[0]
  }
  const label = failed.value ? t('kit.failed') : stateLabel.value
  return run.exit_code !== undefined && run.exit_code !== null
    ? t('node.manager.resultExit', { state: label, code: String(run.exit_code) })
    : label
})
const output = ref<HTMLElement>()
const outputOpen = ref(props.card.run.state === 'running')
watch(
  () => props.card.run.state,
  (state) => {
    outputOpen.value = state === 'running'
  }
)
watch(
  [() => props.card.run.stdout, () => props.card.run.stderr, outputOpen],
  async () => {
    await nextTick()
    if (output.value) output.value.scrollTop = output.value.scrollHeight
  },
  { immediate: true }
)
const stateLabel = computed(() => {
  switch (props.card.run.state) {
    case 'pending_approval':
      return t('node.manager.pending')
    case 'running':
      return t('streamB.running.f4ccae')
    case 'exited':
      return t('node.manager.exited')
    case 'timed_out':
      return t('node.manager.timedOut')
    case 'denied':
      return t('node.manager.denied')
    case 'outcome_unknown':
      return t('node.error.unknownOutcome')
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
    toolParams: { ...prompt.input, justification: props.card.justification },
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
.abele-node-manager-run__request,
.abele-node-manager-run__folder {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}
.abele-node-manager-run__request {
  align-items: flex-start;
}
.abele-node-manager-run__folder {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-node-manager-run__justification {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-weight: var(--font-normal);
}
</style>

<style scoped>
.abele-node-manager-run__status {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-2);
}
</style>

<style scoped>
.abele-node-manager-run__actions {
  display: flex;
  justify-content: flex-start;
}
.abele-node-manager-run__output {
  line-height: var(--line-height-normal);
  max-height: 12lh;
  margin: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
</style>
