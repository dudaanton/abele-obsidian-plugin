<template>
  <Breadcrumbs v-if="crumbs.length > 1" class="abele-comment-trail" :items="crumbs" @select="go" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Breadcrumbs, { type Crumb } from './obsidian/Breadcrumbs.vue'
import { CommentService, type TrailStep } from '@/ai/CommentService'
import { revealAnchor } from '@/ai/openChat'
import type { ChatSession } from '@/ai/ChatSession'

/**
 * Where a comment on a message sits: the chat or note it all started from, every comment in
 * between, and this one last. Each level is a way back to it, opened at the place the level
 * below it hangs on — which is what makes asking inside an answer inside an answer something a
 * person can find their way out of.
 *
 * Only over a comment on a message. A comment on a note has one level above it and a back
 * button for it already; a trail of two there would be the same button twice.
 */
const props = defineProps<{ session: ChatSession }>()

const steps = ref<TrailStep[]>([])

const TOOLTIP: Record<TrailStep['kind'], string> = {
  note: 'Back to the note, at the passage this started from',
  chat: 'Back to the chat, at the message this was asked about',
  comment: 'Back to this side discussion, at the message the next one was asked about',
}

const crumbs = computed<Crumb[]>(() =>
  steps.value.map((step) => ({
    label: step.missing ? `${step.title} (deleted)` : step.title,
    tooltip: step.missing ? 'This has been deleted' : TOOLTIP[step.kind],
  }))
)

// Walked again whenever what it is drawn from moves: another session in the tab, the anchor
// followed to a renamed chat, or the first question arriving — that is the current level's name.
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

/** A level pressed: opened at the place the level below it hangs on. */
function go(index: number): void {
  const step = steps.value[index]
  const below = steps.value[index + 1]
  if (!step || step.missing || !below?.id || !below.anchor) return
  void revealAnchor(below.id, below.anchor)
}
</script>

<style lang="scss">
.abele-comment-trail {
  padding: 0 var(--size-4-2) var(--size-4-1);
}
</style>
