<template>
  <section class="abele-node-delegation" :aria-label="t('streamB.nodeDelegation.f2834f')">
    <Setting :name="card.title">
      <template #desc
        ><span class="abele-node-delegation__meta"
          ><span><Icon icon="server" no-hover /> {{ nodeLabel }}</span>
          <span><Icon icon="bot" no-hover /> {{ providerLabel(card.provider) }}</span>
          <span v-if="card.branch"
            ><Icon icon="git-branch" no-hover /> {{ delegationBranchLabel(card.branch) }}</span
          >
          <span class="abele-node-delegation__status">
            <StatusDot :tone="statusTone" :label="stateLabel" :pulse="card.state === 'running'" />
            {{ stateLabel
            }}<NodeToolPermissions
              :policy="card.toolPermissions"
              :node-label="nodeLabel"
              :provider="card.provider"
              mode-only /></span></span
      ></template>
      <Icon
        v-if="card.sessionId"
        icon="message-square"
        :tooltip="t('streamB.openChildChat.8ed00f')"
        @click="emit('open')"
      />
    </Setting>
    <p
      v-if="card.reason === OWNER_STOP_REASON"
      data-delegation-reason
      class="abele-node-delegation__metadata"
    >
      {{ t('node.delegation.ownerStopped') }}
    </p>
    <p
      v-if="card.state === 'unknown' && card.reason === 'pi_worker_lost'"
      data-delegation-reason
      class="abele-node-delegation__metadata"
    >
      {{ t('streamB.delegationWorkerLost') }}
    </p>
    <NodeCodexNetworkRefusal
      v-if="isCodexNetworkRefusal(card.reason)"
      :node-id="card.nodeId"
      :project-id="card.projectId"
    />
    <NodeToolPermissions
      v-else-if="permissionExplanation"
      quiet-reason
      :policy="card.toolPermissions"
      hide-mode
      :reason="card.reason"
      :node-id="card.nodeId"
      :node-label="nodeLabel"
      :provider="card.provider"
    />
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
    <Disclosure
      v-model="activityOpen"
      class="abele-node-delegation__details"
      :label="t('node.delegation.activity')"
    >
      <p v-if="isCodexNetworkRefusal(card.reason)" class="abele-node-delegation__metadata">
        {{ card.reason }}
      </p>
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
      <div v-if="card.activity?.files.length">
        <div
          v-for="file in card.activity.files"
          :key="file"
          class="abele-node-delegation__metadata"
        >
          {{ file }}
        </div>
      </div>
      <template v-for="report in card.reports" :key="report.seq">
        <Disclosure
          v-if="report.kind === 'progress'"
          :label="t('streamB.progress.466482')"
          :model-value="!!expandedReports[report.seq]"
          @update:model-value="expandedReports[report.seq] = $event"
        >
          <p class="abele-node-delegation__report">{{ delegationReportText(report.text) }}</p>
        </Disclosure>
        <div v-else :data-mailbox-seq="report.seq">
          <strong>{{
            report.kind === 'result'
              ? t('streamB.result.6e7d50')
              : t('streamB.workerQuestionInformational.12931f')
          }}</strong>
          <p class="abele-node-delegation__report">{{ delegationReportText(report.text) }}</p>
        </div>
      </template>
    </Disclosure>
  </section>
</template>
<script setup lang="ts">
import AiToolApproval from './AiToolApproval.vue'
import NodeToolPermissions from './NodeToolPermissions.vue'
import NodeCodexNetworkRefusal from './NodeCodexNetworkRefusal.vue'
import { isCodexNetworkRefusal } from '@/node/codexNetwork'
import type { Prompt, QuestionnaireAnswer } from '@abele/node-client'
import NodeQuestionnaire from './NodeQuestionnaire.vue'
import { obsidianPromptCall } from '@/node/obsidianPresentation'
import type { ChatMessage } from '@/ai/types'
import { t } from '@/i18n'
import { computed, ref, watch } from 'vue'
import type { DelegationCard } from '@/node/delegation'
import { OWNER_STOP_REASON, delegationBranchLabel, delegationReportText } from '@/node/delegation'
import { providerLabel } from '@/node/providers'
import { permissionRefusal } from '@/node/toolPermissions'
import Setting from './obsidian/Setting.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import Disclosure from './obsidian/Disclosure.vue'
import StatusDot from './obsidian/StatusDot.vue'
const props = defineProps<{ card: DelegationCard; nodeLabel: string; disabled?: boolean }>()
const activityPreview = computed(() => {
  const text = props.card.activity?.message ?? ''
  const characters = Array.from(text)
  return characters.length > 320
    ? `… ${characters
        .slice(-320)
        .join('')
        .replace(/^\S*\s/, '')}`
    : text
})
const finished = computed(() =>
  [
    'completed',
    'failed',
    'unsupported',
    'cancelled',
    'unknown',
    'stopped',
    'grant revoked',
  ].includes(props.card.state)
)
const activityOpen = ref(!finished.value || !!props.card.pendingHumanPrompts)
watch(
  () => [finished.value, props.card.pendingHumanPrompts],
  () => {
    activityOpen.value = !finished.value || !!props.card.pendingHumanPrompts
  }
)
const expandedReports = ref<Record<number, boolean>>({})
const permissionExplanation = computed(
  () =>
    permissionRefusal(props.card.reason) || permissionRefusal(props.card.toolPermissions?.reason)
)
const stateLabel = computed(() => {
  const state = props.card.state
  if (props.card.reason === OWNER_STOP_REASON) return t('chat.stopped')
  if (state === 'stopped') return t('node.delegation.paused')
  if (state === 'completed') return t('node.delegation.done')
  if (state === 'unknown' && props.card.reason === 'pi_worker_lost')
    return t('streamB.delegationLost')
  if (['failed', 'unsupported'].includes(state) && permissionExplanation.value)
    return t('streamB.delegationRefused')
  if (state === 'failed' || state === 'unsupported') return t('streamB.failed.031a8f')
  if (state === 'cancelled') return t('streamBMeta.8b47045eb7')
  if (state === 'grant revoked') return t('streamB.revoked.f6f738')
  if (state === 'running') return t('node.delegation.working')
  if (state === 'unknown' || state === 'outcome unknown') return t('node.delegation.unknown')
  return state
})
const statusTone = computed(() => {
  if (props.card.reason === OWNER_STOP_REASON || props.card.state === 'cancelled') return 'faint'
  if (props.card.state === 'completed') return 'green'
  if (['failed', 'unsupported'].includes(props.card.state)) return 'red'
  if (props.card.state === 'running') return 'accent'
  return 'orange'
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
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  min-width: 0;
  font-size: var(--font-ui-small);
  padding: var(--size-4-2);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  margin-block: var(--size-4-2);
  overflow-wrap: anywhere;
}
.abele-node-delegation > :deep(.setting-item.abele-obsidian-setting) {
  padding: 0;
  margin: 0;
  border: 0;
}
.abele-node-delegation__meta {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-1) var(--size-4-2);
}
.abele-node-delegation__meta > span {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);
}
.abele-node-delegation__status {
  white-space: nowrap;
}

.abele-node-delegation__report {
  white-space: pre-wrap;
  font-size: inherit;
}
.abele-node-delegation__metadata {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
</style>
