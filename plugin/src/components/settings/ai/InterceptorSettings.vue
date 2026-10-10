<template>
  <Setting name="Interceptor" :desc="desc">
    <Dropdown :model-value="modelValue" :options="options" @update:model-value="choose" />
  </Setting>
  <template v-if="active">
    <Setting
      name="Only messages matching"
      desc="A regular expression, bare or as /pattern/flags. Other messages go straight to the agent. Empty means every message."
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
      name="Reply only"
      desc="Send messages unchanged straight to the main agent. The interceptor may answer beside each message, without holding it, rewriting it or deciding tool approvals."
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
import { INTERCEPTOR_CONTEXT_OPTIONS } from '@/ai/agents/types'
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
    contextDepth: number
    patternPlaceholder?: string
  }>(),
  { patternPlaceholder: 'Every message' }
)
const emit = defineEmits<{
  'update:model-value': [value: string]
  'update:pattern': [value: string]
  'update:reply-only': [value: boolean]
  'update:context-depth': [value: number]
}>()

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
