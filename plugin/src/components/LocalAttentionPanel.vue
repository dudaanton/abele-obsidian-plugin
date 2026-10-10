<template>
  <div v-if="interruptedRun || question || errors.length || failure" class="abele-local-attention">
    <div
      v-if="interruptedRun"
      class="abele-ai-chat__error"
      :data-attention-id="interruptedRun.id"
      tabindex="-1"
    >
      <span>Work was interrupted. Continue when you are ready.</span>
      <button @click="retry">Continue</button>
    </div>
    <div
      v-if="question"
      class="abele-ai-chat__error"
      :data-attention-id="question.id"
      tabindex="-1"
    >
      <span>Work was interrupted. The agent is no longer waiting in the original run.</span>
      <p v-for="(item, index) in question.questions" :key="index">
        {{ item.question }} · {{ item.options.join(' · ') }}
        <span v-if="question.answers[index]"> · Answer: {{ question.answers[index] }}</span>
      </p>
      <button @click="composeAnswer">Continue with a message</button>
    </div>
    <div
      v-for="error in errors"
      :key="error.id"
      class="abele-ai-chat__error"
      :data-attention-id="error.id"
      tabindex="-1"
    >
      <span>Run failed · {{ new Date(error.at).toLocaleString() }}</span>
      <span>{{ error.text }}</span>
      <span v-if="error.seen">Seen</span>
      <button v-else @click="seen(error.id)">Mark as seen</button>
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
    failure.value = error instanceof Error ? error.message : 'Could not save the acknowledgement'
  }
}
const composeAnswer = () => {
  const saved = question.value
  if (!saved) return
  ChatService.getInstance().pendingInput.value = {
    tabId: props.session.id,
    focus: true,
    text: `Answer to "${saved.questions[saved.currentIndex]?.question ?? ''}": `,
  }
}
const retry = async () => {
  try {
    await props.session.retryRequest()
  } catch (error) {
    failure.value = error instanceof Error ? error.message : 'Could not continue'
  }
}
</script>
