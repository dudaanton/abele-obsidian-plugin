<template>
  <RequestCard
    class="abele-tool-approval abele-node-permission"
    :waiting="prompt.state === 'pending'"
  >
    <div class="abele-tool-approval__header">
      <Icon :icon="KIND_ICON[toolKind(prompt.tool_name)]" no-hover /><span>{{ title }}</span>
    </div>
    <div v-if="location" class="abele-tool-approval__param">{{ location }}</div>
    <div v-if="summary" class="abele-tool-approval__param">
      <code>{{ summary }}</code>
    </div>
    <!-- What the call would change, as the agent showed it: open while the question waits. -->
    <Diff
      v-for="(diff, i) in diffs ?? []"
      :key="i"
      class="abele-node-permission__diff"
      :text-left="diff.old"
      :text-right="diff.new"
      :path="diff.path"
    />
    <Disclosure
      v-if="prompt.input || prompt.tool_name"
      v-model="detailOpen"
      :label="t('streamB.originalAction.67ccdf')"
    >
      <code v-if="prompt.tool_name">{{ prompt.tool_name }}</code>
      <Diff
        v-if="
          prompt.tool_name === 'Edit' &&
          typeof prompt.input?.old_string === 'string' &&
          typeof prompt.input.new_string === 'string'
        "
        :text-left="prompt.input.old_string"
        :text-right="prompt.input.new_string"
        :path="typeof prompt.input.file_path === 'string' ? prompt.input.file_path : undefined"
      />
      <pre
        class="abele-tool-approval__code"
      ><code>{{ JSON.stringify(prompt.input, null, 2) }}</code></pre>
    </Disclosure>
    <div
      v-if="prompt.state === 'pending' && answerState"
      class="abele-node-permission__note"
      role="status"
    >
      {{
        t('streamBMeta.7c3c58a4a0', {
          p0: String(
            answerState.choice === 'allow'
              ? isQuestion
                ? t('streamB.answer.b2a3aa')
                : t('streamB.approve.6007ac')
              : t('streamB.deny.05a2d7')
          ),
        })
      }}
      <template v-if="answerState.value !== undefined"> · {{ answerState.value }}</template>
      <template v-if="answerState.state === 'pending'">{{
        t('streamB.waitingForConfirmation.bc8582')
      }}</template>
      <template v-if="answerState.error"
        >{{ t('streamB.notAccepted.0f11a8') }} <NodeErrorText :error="answerState.error"
      /></template>
      <div class="abele-tool-approval__actions">
        <Button
          :text="t('streamB.stop.cae7d5')"
          :disabled="disabled"
          :tooltip="t('streamB.rejectAndStopTheAgent.7da416')"
          @click="!disabled && emit('stop')"
        />
      </div>
    </div>
    <template v-else-if="prompt.state === 'pending'">
      <div v-if="expiry" class="abele-node-permission__note">{{ expiry }}</div>
      <select
        v-if="prompt.kind === 'select'"
        v-model="value"
        :aria-label="t('streamB.questionAnswer.e9700c')"
        :disabled="disabled"
      >
        <option value="">{{ t('streamB.chooseAnAnswer.8cf0e3') }}</option>
        <option v-for="option in prompt.options" :key="option" :value="option">{{ option }}</option>
      </select>
      <Input
        v-if="prompt.kind === 'input'"
        v-model="value"
        as-text-area
        :aria-label="t('streamB.questionAnswer.e9700c')"
        :disabled="disabled"
      />
      <div class="abele-tool-approval__actions">
        <Button
          :text="t('streamB.deny.05a2d7')"
          :disabled="disabled"
          :tooltip="t('streamB.doNotAllowThisAction.90f17c')"
          @click="emit('answer', 'deny')"
        />
        <Button
          :text="
            isQuestion
              ? t('streamB.answer.b2a3aa')
              : allowLabel
                ? t('streamB.allow.e213c1')
                : t('streamB.approve.6007ac')
          "
          accent
          :disabled="disabled || !valid"
          :tooltip="t('streamB.approveExactlyThisActionOrAnswerThis.518d23')"
          @click="approve"
        />
        <Button
          class="abele-tool-approval__stop"
          :text="t('streamB.stop.cae7d5')"
          :disabled="disabled"
          :tooltip="t('streamB.rejectAndStopTheAgent.7da416')"
          @click="!disabled && emit('stop')"
        />
      </div>
    </template>
    <div v-else class="abele-node-permission__note">
      <ResultMark
        v-if="prompt.state === 'resolved'"
        :state="prompt.delivered ? 'done' : 'skipped'"
        :text="
          prompt.delivered
            ? t('streamB.decisionDeliveredToProvider.784839')
            : t('streamB.decisionSavedDeliveryNotConfirmed.75c4c8')
        "
      />
      {{ isQuestion ? t('streamB.question.289aff') : t('streamB.permission.229efc') }}
      {{ streamBLabel(prompt.state) }}{{ prompt.choice ? ': ' + streamBLabel(prompt.choice) : '' }}
      <template v-if="prompt.value !== undefined && prompt.value !== null">
        · {{ prompt.value }}</template
      >
      <template v-if="prompt.state === 'resolved'">
        ·
        {{
          prompt.delivered
            ? t('streamB.decisionDeliveredToProvider.784839')
            : t('streamB.decisionSavedDeliveryNotConfirmed.75c4c8')
        }}</template
      >
    </div>
  </RequestCard>
</template>
<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { streamBLabel } from '@/i18n/streamBLabels'
import { t } from '@/i18n'
import { computed, ref, watch } from 'vue'
import type { Prompt } from '@abele/node-client'
import { toolSummary, readableToolName } from '@/ai/toolLine'
import { KIND_ICON, toolKind } from '@/ai/toolRuns'
import { promptExpiry } from '@/node/presentation'
import type { PromptAnswerState } from '@/node/promptAnswers'
import { useDisplayClock } from '@/composables/useDisplayClock'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import Diff from './Diff.vue'
import Input from './obsidian/Input.vue'
import RequestCard from './obsidian/RequestCard.vue'
import Disclosure from './obsidian/Disclosure.vue'
import ResultMark from './obsidian/ResultMark.vue'
const props = defineProps<{
  prompt: Prompt
  disabled: boolean
  /** Unknown or test providers use the generic permission wording. */
  allowLabel?: boolean
  location?: string
  answerState?: PromptAnswerState
  /** The changes the call it asks about would make, when its agent showed them. */
  diffs?: { path: string; old: string; new: string }[]
}>()
const emit = defineEmits<{
  (e: 'answer', choice: 'allow' | 'deny', value?: string): void
  (e: 'stop'): void
}>()
const value = ref('')
const detailOpen = ref(false)
const title = computed(() => {
  const name = props.prompt.tool_name
  return name?.startsWith('mcp__') && (!props.prompt.title || props.prompt.title === name)
    ? readableToolName(name)
    : props.prompt.title ||
        readableToolName(name) ||
        (props.prompt.kind === 'permission' ? 'Permission request' : 'Question')
})
watch(
  () => props.prompt.prompt_id,
  () => {
    value.value = ''
    detailOpen.value = false
  }
)
const isQuestion = computed(() => ['select', 'input'].includes(props.prompt.kind))
const valid = computed(() =>
  props.prompt.kind === 'select'
    ? !!props.prompt.options?.includes(value.value)
    : value.value.length <= 32768
)
const approve = () => {
  if (props.disabled || !valid.value) return
  if (isQuestion.value) emit('answer', 'allow', value.value)
  else emit('answer', 'allow')
}
const now = useDisplayClock('minute', () => props.prompt.state === 'pending' && !props.answerState)
const expiry = computed(() => promptExpiry(props.prompt.expires_at, now.value))
const summary = computed(() =>
  toolSummary({ toolName: props.prompt.tool_name, toolParams: props.prompt.input })
)
</script>
<style lang="scss">
.abele-node-permission__diff {
  margin: var(--size-4-1) 0;
}
.abele-node-permission {
  .abele-tool-approval__actions {
    margin-top: var(--size-4-2);
    flex-wrap: nowrap;
  }
  .abele-tool-approval__actions button {
    width: auto;
  }
  .abele-tool-approval__code {
    max-height: none;
  }
  &__note {
    color: var(--text-muted);
    margin-top: var(--size-4-1);
  }
  select,
  textarea {
    max-width: 100%;
    width: 100%;
  }
}
</style>
