<template>
  <div v-if="interruptedRun || question || errors.length || failure" class="abele-local-attention">
    <div
      v-if="interruptedRun"
      class="abele-ai-chat__error"
      :data-attention-id="interruptedRun.id"
      tabindex="-1"
    >
      <span>Работа прервалась. Продолжение только по твоему действию.</span>
      <button @click="retry">Продолжить</button>
    </div>
    <div
      v-if="question"
      class="abele-ai-chat__error"
      :data-attention-id="question.id"
      tabindex="-1"
    >
      <span>Работа прервалась. Агент больше не ждёт ответ в прежнем запуске.</span>
      <p v-for="(item, index) in question.questions" :key="index">
        {{ item.question }} · {{ item.options.join(' · ') }}
        <span v-if="question.answers[index]"> · Ответ: {{ question.answers[index] }}</span>
      </p>
      <button @click="composeAnswer">Продолжить сообщением</button>
    </div>
    <div
      v-for="error in errors"
      :key="error.id"
      class="abele-ai-chat__error"
      :data-attention-id="error.id"
      tabindex="-1"
    >
      <span>Запуск завершился с ошибкой · {{ new Date(error.at).toLocaleString() }}</span>
      <span>{{ error.text }}</span>
      <span v-if="error.seen">Просмотрено</span>
      <button v-else @click="seen(error.id)">Просмотрено</button>
    </div>
    <p v-if="failure" role="alert">{{ failure }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
const props = defineProps<{ session: ChatSession }>()
const state = computed(() => props.session.attention?.value ?? {})
const question = computed(() =>
  state.value.question?.status === 'interrupted' ? state.value.question : null
)
const interruptedRun = computed(() =>
  state.value.run?.status === 'interrupted' && !question.value ? state.value.run : null
)
const errors = computed(() => state.value.errors ?? [])
const failure = ref('')
const seen = async (id: string) => {
  try {
    await props.session.markAttentionSeen(id)
  } catch (error) {
    failure.value = error instanceof Error ? error.message : 'Не удалось сохранить отметку'
  }
}
const composeAnswer = () => {
  const saved = question.value
  if (!saved) return
  ChatService.getInstance().pendingInput.value = {
    tabId: props.session.id,
    focus: true,
    text: `Ответ на вопрос «${saved.questions[saved.currentIndex]?.question ?? ''}»: `,
  }
}
const retry = async () => {
  try {
    await props.session.retryRequest()
  } catch (error) {
    failure.value = error instanceof Error ? error.message : 'Не удалось продолжить'
  }
}
</script>
