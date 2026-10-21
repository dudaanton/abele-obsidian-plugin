<template>
  <div class="abele-node-questionnaire" role="group" :aria-busy="busy">
    <ChatQuestionCard
      v-if="question"
      :key="prompt.prompt_id + ':' + index"
      :question="question.question"
      :options="question.options ?? []"
      :index="index"
      :count="prompt.questions?.length ?? 0"
      :disabled="disabled || busy"
      :allow-custom="input ? false : question.allow_custom"
      :multi="multi"
      :selected="selected"
      @answer="choose"
      @skip="!disabled && !busy && emit('answer', null)"
      @own="own = true"
    >
      <template v-if="own || input || multi">
        <Input
          v-if="own || input"
          v-model="custom"
          as-text-area
          :disabled="disabled || busy"
          :aria-label="question.question"
          :maxlength="4096"
        />
        <div class="abele-tool-approval__actions">
          <Button
            :text="t('streamB.answer.b2a3aa')"
            :disabled="disabled || busy || !answerReady"
            @click="
              advance(
                multi ? [...selected, ...(custom.trim() ? [custom.trim()] : [])] : custom.trim()
              )
            "
          />
        </div>
      </template>
    </ChatQuestionCard>
    <NodeErrorText v-if="error" :error="error" />
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Prompt, QuestionnaireAnswer } from '@abele/node-client'
import { t } from '@/i18n'
import ChatQuestionCard from './ChatQuestionCard.vue'
import Input from './obsidian/Input.vue'
import Button from './obsidian/Button.vue'
import NodeErrorText from './NodeErrorText.vue'
const props = defineProps<{ prompt: Prompt; disabled?: boolean; busy?: boolean; error?: string }>()
const emit = defineEmits<{ answer: [answers: QuestionnaireAnswer[] | null] }>()
const index = ref(0),
  own = ref(false),
  custom = ref(''),
  selected = ref<string[]>([])
const answers = ref<QuestionnaireAnswer[]>([])
watch(
  () => props.prompt.prompt_id,
  () => {
    index.value = 0
    answers.value = []
    reset()
  }
)
const question = computed(() => props.prompt.questions?.[index.value])
const multi = computed(() => question.value?.type === 'multi')
const input = computed(() => question.value?.type === 'input' || !question.value?.options?.length)
const answerReady = computed(
  () => !!custom.value.trim() || (multi.value && selected.value.length > 0)
)
function reset() {
  own.value = false
  custom.value = ''
  selected.value = []
}
function choose(option: string) {
  if (props.disabled || props.busy) return
  if (multi.value)
    selected.value = selected.value.includes(option)
      ? selected.value.filter((value) => value !== option)
      : [...selected.value, option]
  else advance(option)
}
function advance(answer: QuestionnaireAnswer) {
  if (props.disabled || props.busy) return
  if (Array.isArray(answer)) answer = [...new Set(answer)]
  const next = [...answers.value, answer]
  if (index.value + 1 === props.prompt.questions?.length) {
    emit('answer', next)
    return
  }
  answers.value = next
  index.value++
  reset()
}
</script>
