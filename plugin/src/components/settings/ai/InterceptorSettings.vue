<template>
  <Setting :name="t('settings.ai.InterceptorSettings.interceptor.e7123168')" :desc="desc">
    <Dropdown :model-value="modelValue" :options="options" @update:model-value="choose" />
  </Setting>
  <template v-if="active">
    <!-- Your message before the agent reads it, the agent's answer before it stays in the chat. -->
    <Setting :name="t('settings.ai.InterceptorSettings.checks.de07d072')" :desc="checksDesc">
      <Dropdown
        :model-value="checks"
        :options="settingsOptions(INTERCEPTOR_CHECKS_OPTIONS)"
        @update:model-value="emit('update:checks', $event as InterceptorChecks)"
      />
    </Setting>
    <Setting
      :name="t('settings.ai.InterceptorSettings.only_messages_matching.a6b95968')"
      :desc="t('settings.ai.InterceptorSettings.a_regular_expression_bare_or.23b7cedb')"
    >
      <Input
        :model-value="patternText"
        :placeholder="patternPlaceholder"
        @update:model-value="typePattern"
      />
    </Setting>
    <p v-if="patternProblem" class="setting-item-description mod-warning">
      {{ t('settings.sentence.cdb07f66a428a0ed', { value0: String(patternProblem) }) }}
    </p>
    <Setting
      v-if="checks !== 'answer'"
      :name="t('settings.ai.InterceptorSettings.reply_only.df23f4c5')"
      :desc="t('settings.ai.InterceptorSettings.send_your_messages_unchanged_straight.58a7f839')"
    >
      <Checkbox :is-enabled="replyOnly" @toggle="emit('update:reply-only', !replyOnly)" />
    </Setting>
  </template>
  <Setting
    v-if="agentActive"
    :name="t('settings.ai.InterceptorSettings.interceptor_context.4b7f6f53')"
    :desc="t('settings.ai.InterceptorSettings.how_much_of_the_conversation.5cbc2856')"
  >
    <Dropdown
      :model-value="String(contextDepth)"
      :options="settingsOptions(INTERCEPTOR_CONTEXT_OPTIONS)"
      @update:model-value="emit('update:context-depth', Number($event))"
    />
  </Setting>
</template>

<script setup lang="ts">
import { settingsOptions } from '@/i18n/settingsLabels'
import { t } from '@/i18n'
import { computed, ref, watch } from 'vue'
import Setting from '../../obsidian/Setting.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import Input from '../../obsidian/Input.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import {
  INTERCEPTOR_CHECKS_OPTIONS,
  INTERCEPTOR_CONTEXT_OPTIONS,
  type InterceptorChecks,
} from '@/ai/agents/types'
import { patternError } from '@/ai/interceptor/pattern'

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: { value: string; display: string }[]
    desc: string
    active: boolean
    agentActive: boolean
    pattern: string
    replyOnly: boolean
    checks?: InterceptorChecks
    contextDepth: number
    patternPlaceholder?: string
  }>(),
  {
    patternPlaceholder: () => t('settings.ai.InterceptorSettings.everything.75304cf7'),
    checks: 'message',
  }
)
const emit = defineEmits<{
  'update:model-value': [value: string]
  'update:pattern': [value: string]
  'update:reply-only': [value: boolean]
  'update:checks': [value: InterceptorChecks]
  'update:context-depth': [value: number]
}>()

/** What happens to what it checks, said for the choice in force. */
const checksDesc = computed(() =>
  props.checks === 'message'
    ? t('settings.ai.InterceptorSettings.your_messages_before_the_agent.4c538aec')
    : props.checks === 'answer'
      ? t('settings.ai.InterceptorSettings.the_agent_s_answers_once.69a4059d')
      : t('settings.ai.InterceptorSettings.your_messages_before_the_agent.1b910706')
)

/** Invalid text stays visible here; neither owner loses its last valid stored pattern. */
const typedPattern = ref<string | null>(null)
const patternText = computed(() => typedPattern.value ?? props.pattern)
const patternProblem = computed(() =>
  typedPattern.value === null ? null : patternError(typedPattern.value)
)
watch(
  () => props.pattern,
  () => {
    typedPattern.value = null
  }
)
function typePattern(text: string) {
  typedPattern.value = text
  if (!patternError(text)) emit('update:pattern', text)
}
function choose(value: string) {
  typedPattern.value = null
  emit('update:model-value', value)
}
</script>
