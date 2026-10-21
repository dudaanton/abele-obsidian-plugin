<template>
  <section class="abele-node-delegation" :aria-label="t('streamB.nodeDelegation.f2834f')">
    <Setting
      :name="card.title"
      :desc="
        [nodeLabel, providerLabel(card.provider), delegationBranchLabel(card.branch), stateLabel]
          .filter(Boolean)
          .join(' · ')
      "
    >
      <Button
        v-if="card.sessionId"
        :text="t('streamB.openChildChat.8ed00f')"
        plain
        icon="message-square"
        @click="emit('open')"
      />
    </Setting>
    <p
      v-if="card.state === 'stopped' && card.reason === 'time_limit'"
      class="abele-node-delegation__metadata"
    >
      {{
        t(card.pendingHumanPrompts ? 'node.delegation.pausedPrompt' : 'node.delegation.pausedLimit')
      }}
    </p>
    <Button
      v-if="card.pendingHumanPrompts && !card.prompts?.length"
      data-pending-prompts
      plain
      wrap
      icon="message-circle-question"
      :text="t('streamBMeta.1f8e74f453', { p0: String(card.pendingHumanPrompts) })"
      @click="emit('open')"
    />
    <template v-for="prompt in card.prompts ?? []" :key="prompt.prompt_id">
      <NodeQuestionnaire
        v-if="prompt.kind === 'questionnaire'"
        :prompt="prompt"
        :disabled="disabled"
        @answer="(answers) => emit('questionnaire', prompt, answers)"
      />
      <AiToolApproval
        v-else
        :message="promptMessage(prompt)"
        :node-prompt="prompt"
        :disabled="disabled"
        :answer-state="card.answers?.[prompt.prompt_id]"
        :diffs="card.promptDiffs?.[prompt.prompt_id]"
        @answer="(choice, value) => emit('answer', prompt, choice, value)"
        @stop="emit('stop', prompt)"
      />
    </template>
    <details class="abele-node-delegation__details" :open="!finished || !!card.pendingHumanPrompts">
      <summary>{{ t('node.delegation.activity') }}</summary>
      <p
        v-for="warning in card.warnings ?? []"
        :key="warning"
        class="abele-node-delegation__metadata"
      >
        {{ warning }}
      </p>
      <p v-if="card.activity?.tool" class="abele-node-delegation__metadata">
        {{ card.activity.tool }}
      </p>
      <p v-if="activityPreview" class="abele-node-delegation__report">
        {{ activityPreview }}
      </p>
      <ul v-if="card.activity?.files.length">
        <li v-for="file in card.activity.files" :key="file">
          <code>{{ file }}</code>
        </li>
      </ul>
      <template v-for="report in card.reports" :key="report.seq">
        <details v-if="report.kind === 'progress'">
          <summary>{{ t('streamB.progress.466482') }}</summary>
          <p class="abele-node-delegation__report">{{ delegationReportText(report.text) }}</p>
        </details>
        <div v-else :data-mailbox-seq="report.seq">
          <strong>{{
            report.kind === 'result'
              ? t('streamB.result.6e7d50')
              : t('streamB.workerQuestionInformational.12931f')
          }}</strong>
          <p class="abele-node-delegation__report">{{ delegationReportText(report.text) }}</p>
        </div>
      </template>
    </details>
  </section>
</template>
<script setup lang="ts">
import AiToolApproval from './AiToolApproval.vue'
import type { Prompt, QuestionnaireAnswer } from '@abele/node-client'
import NodeQuestionnaire from './NodeQuestionnaire.vue'
import { obsidianPromptCall } from '@/node/obsidianPresentation'
import type { ChatMessage } from '@/ai/types'
import { t } from '@/i18n'
import { computed } from 'vue'
import type { DelegationCard } from '@/node/delegation'
import { delegationBranchLabel, delegationReportText } from '@/node/delegation'
import { providerLabel } from '@/node/providers'
import Setting from './obsidian/Setting.vue'
import Button from './obsidian/Button.vue'
const props = defineProps<{ card: DelegationCard; nodeLabel: string; disabled?: boolean }>()
const activityPreview = computed(() => {
  const text = props.card.activity?.message ?? ''
  const characters = Array.from(text)
  return characters.length > 320 ? `…${characters.slice(-320).join('')}` : text
})
const finished = computed(() =>
  ['completed', 'failed', 'cancelled', 'unknown', 'stopped', 'grant revoked'].includes(
    props.card.state
  )
)
const stateLabel = computed(() => {
  const state = props.card.state
  if (state === 'stopped') return t('node.delegation.paused')
  if (state === 'completed') return t('node.delegation.done')
  if (state === 'failed') return t('streamB.failed.031a8f')
  if (state === 'cancelled') return t('streamBMeta.8b47045eb7')
  if (state === 'grant revoked') return t('streamB.revoked.f6f738')
  if (state === 'running') return t('node.delegation.working')
  if (state === 'unknown' || state === 'outcome unknown') return t('node.delegation.unknown')
  return state
})
const promptMessage = (prompt: Prompt): ChatMessage =>
  obsidianPromptCall(prompt) ??
  ({
    id: prompt.prompt_id,
    role: 'tool-call',
    content: '',
    toolName: prompt.tool_name,
    toolParams: prompt.input,
  } as ChatMessage)
const emit = defineEmits<{
  questionnaire: [prompt: Prompt, answers: QuestionnaireAnswer[] | null]
  open: []
  answer: [prompt: Prompt, choice: 'allow' | 'deny', value?: string]
  stop: [prompt: Prompt]
}>()
</script>
<style scoped>
.abele-node-delegation {
  min-width: 0;
  padding: var(--size-4-2);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  margin-block: var(--size-4-2);
  overflow-wrap: anywhere;
}
.abele-node-delegation__report {
  white-space: pre-wrap;
}
.abele-node-delegation__metadata {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
</style>
