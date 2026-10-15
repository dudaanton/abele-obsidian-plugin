<template>
  <Setting name="Interceptor" :desc="desc">
    <Dropdown :model-value="modelValue" :options="options" @update:model-value="choose" />
  </Setting>
  <template v-if="active">
    <!-- Your message before the agent reads it, the agent's answer before it stays in the chat. -->
    <Setting name="Checks" :desc="checksDesc">
      <Dropdown
        :model-value="checks"
        :options="INTERCEPTOR_CHECKS_OPTIONS"
        @update:model-value="emit('update:checks', $event as InterceptorChecks)"
      />
    </Setting>
    <Setting
      name="Only messages matching"
      desc="A regular expression, bare or as /pattern/flags, tried on whatever is checked. The rest pass unchecked. Empty means everything."
    >
      <Input
        :model-value="patternText"
        :placeholder="patternPlaceholder"
        @update:model-value="typePattern"
      />
    </Setting>
    <p v-if="patternProblem" class="setting-item-description mod-warning">
      Not saved: {{ patternProblem }}
    </p>
    <Setting
      v-if="checks !== 'answer'"
      name="Reply only"
      desc="Send your messages unchanged straight to the main agent. The interceptor may answer beside each message, without holding it, rewriting it or deciding tool approvals."
    >
      <Checkbox :is-enabled="replyOnly" @toggle="emit('update:reply-only', !replyOnly)" />
    </Setting>
  </template>
  <Setting
    v-if="agentActive"
    name="Interceptor context"
    desc="How much of the conversation the interceptor sees."
  >
    <Dropdown
      :model-value="String(contextDepth)"
      :options="INTERCEPTOR_CONTEXT_OPTIONS"
      @update:model-value="emit('update:context-depth', Number($event))"
    />
  </Setting>
</template>

<script setup lang="ts">
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
  { patternPlaceholder: 'Everything', checks: 'message' }
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
    ? 'Your messages, before the agent reads them.'
    : props.checks === 'answer'
      ? "The agent's answers, once it has finished. A new text from the interceptor takes the answer's place; the original stays a press away."
      : "Your messages before the agent reads them, and its answers once it has finished. A new text from the interceptor takes the answer's place."
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
