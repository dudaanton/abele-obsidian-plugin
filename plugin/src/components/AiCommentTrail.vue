<template>
  <Icon v-if="parent" icon="undo-2" class="abele-chat-parent-back" :tooltip="tooltip" @click="go" />
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { presentUiField } from '@/i18n/streamBErrors'
import { computed, ref, watch } from 'vue'
import Icon from './obsidian/Icon.vue'
import { CommentService, type TrailStep } from '@/ai/CommentService'
import { revealAnchor } from '@/ai/openChat'
import type { ChatSession } from '@/ai/ChatSession'

/**
 * One step back from a nested chat to its parent, at the anchored message. A comment on a
 * note already has its own way back to the passage, so it needs no parent-chat button.
 */
const props = defineProps<{ session: ChatSession }>()

const steps = ref<TrailStep[]>([])

const parent = computed(() => (steps.value.length > 1 ? steps.value[steps.value.length - 2] : null))
const tooltip = computed(() =>
  parent.value
    ? `${t('streamB.backToTheChatAtTheMessage.eea9db')}: ${presentUiField(parent.value, 'title')}`
    : ''
)

// Resolve again when the session, anchor, file or current title changes.
let generation = 0
watch(
  () => {
    const session = props.session
    return [
      session,
      session.anchor.value,
      session.currentChatFile.value,
      CommentService.nameOf(session),
    ] as const
  },
  async ([session]) => {
    const mine = ++generation
    const anchor = session.anchor.value
    if (!anchor?.message || !session.currentChatFile.value) {
      steps.value = []
      return
    }
    const trail = await CommentService.getInstance().trail(session)
    // A slower walk for the session before must not draw over this one's.
    if (mine === generation) steps.value = trail
  },
  { immediate: true }
)

/** Open the parent at the message this chat hangs on. */
function go(): void {
  const current = steps.value[steps.value.length - 1]
  if (!parent.value || !current?.id || !current.anchor) return
  void revealAnchor(current.id, current.anchor)
}
</script>
