<template>
  <ObsidianModal
    :title="t('streamC.fa66a4a663b325ab')"
    modal-class="abele-canvas-publication-review"
    :can-close="dismiss"
    @close="close"
  >
    <template v-if="screen === 'review'">
      <p ref="anchor">{{ status }}</p>
      <p>{{ TEXT.matching }}</p>
      <template v-for="section in sections" :key="section.kind">
        <details class="markdown-rendered">
          <summary>{{ section.title }}</summary>
          <pre :data-review="section.kind">{{ section.value }}</pre>
        </details>
        <p v-if="section.graph">{{ graphSummary(section.graph) }}</p>
        <p v-if="section.kind === 'source' && review.source.error">{{ parseError }}</p>
      </template>
      <p v-if="review.native">{{ TEXT.native }}</p>
    </template>
    <template v-else-if="screen === 'confirm'">
      <p ref="anchor">{{ TEXT.confirm }}</p>
      <p v-if="review.evidence.outcome === 'written-acknowledgment-pending'">
        {{ TEXT.written }}
      </p>
      <p>{{ TEXT.reread }}</p>
    </template>
    <p v-else ref="anchor">{{ failure }}</p>
    <template #footer>
      <template v-if="screen === 'review'">
        <Button
          key="review-keep"
          :text="t('streamC.e730e89a0b710cf9')"
          :tooltip="t('streamC.ab266caf32dd1a55')"
          @click="close"
        />
        <Button
          key="review-discard"
          :text="t('streamC.1e0a126c418ca2f9')"
          :tooltip="t('streamC.8e1ecdb071fa63d6')"
          warning
          @click="screen = 'confirm'"
        />
      </template>
      <template v-else-if="screen === 'confirm'">
        <Button
          key="confirm-cancel"
          :text="t('kit.cancel')"
          :tooltip="t('streamC.ab266caf32dd1a55')"
          @click="close"
        />
        <Button
          key="confirm-discard"
          :text="t('streamC.4c7d7301a6a119cd')"
          :tooltip="t('streamC.a7e9d453871beae4')"
          warning
          :disabled="discarding"
          @click="onDiscard"
        />
      </template>
      <Button
        v-else
        key="failed-keep"
        :text="t('streamC.e730e89a0b710cf9')"
        :tooltip="t('streamC.ab266caf32dd1a55')"
        @click="close"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import Button from '@/components/obsidian/Button.vue'
import { labelOf, type CanvasGraph } from '@/canvas/core/model'
import type { CanvasPublicationReview } from '@/canvas/obsidianStore'

/**
 * Local read-only review of a canvas change whose publication is uncertain: the review itself,
 * the question before discarding, and what is left when the discard fails. Its choice is not an
 * agent proposal or publication capability.
 *
 * `keep` is called exactly once — at the user's choice, at any way of closing, or when the
 * dialog is taken down — and `discard` only from the confirmation; the dialog closes once it
 * resolves. Opened through `CanvasPublicationReviewModal`.
 */
const props = defineProps<{
  review: CanvasPublicationReview
  /** What is known about the outcome, the review's first line. */
  status: string
  keep: () => void
  discard: () => Promise<void>
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** The dialog's `.modal` element, once on screen, for the handle that owns it. */
  (e: 'opened', modalEl: HTMLElement): void
}>()

const TEXT = {
  matching: t('streamC.1924f5fad81966a8'),
  native: t('streamC.87de9b5e1122c152'),
  confirm: t('streamC.0e98d321e02e8080'),
  written: t('streamC.43a08b10a933141d'),
  reread: t('streamC.9bc503dfa7bf318f'),
}

const screen = ref<'review' | 'confirm' | 'failed'>('review')
const discarding = ref(false)
const failure = ref('')
const anchor = ref<HTMLElement | null>(null)
let finished = false

const parseError = computed(() =>
  t('streamC.62d470a828fadb6a', { v1: String(props.review.source.error) })
)

// Shown as text only, in `<pre>` by interpolation: source and extension contents cannot execute
// markup or load attachments.
const sections = computed(() => [
  {
    kind: 'source',
    title: t('streamC.6799a1715e5a5fc7'),
    value: props.review.source.bytes,
    graph: props.review.source.graph,
  },
  {
    kind: 'proposed',
    title: t('streamC.082b40eea5afad3f'),
    value: JSON.stringify(props.review.evidence.proposed, null, 2),
    graph: props.review.evidence.proposed,
  },
  {
    kind: 'baseline',
    title: t('streamC.c6169f810c546ba1'),
    value: JSON.stringify(props.review.evidence.baseline, null, 2),
    graph: props.review.evidence.baseline.graph,
  },
])

function graphSummary(graph: CanvasGraph): string {
  return t('streamC.03d7f53e71425578', {
    v1: t('streamC.graphNodes', { count: graph.nodes.length }),
    v2: t('streamC.graphEdges', { count: graph.edges.length }),
    v3:
      graph.nodes
        .slice(0, 3)
        .map((node) => labelOf(node).slice(0, 120))
        .join('; ') || t('streamC.d29a0939bcb51176'),
  })
}

function revoke(): void {
  if (finished) return
  finished = true
  props.keep()
}

// Admission ends at the user's choice, not at the host's eventual animation callback: Escape,
// the backdrop and the close button revoke here, before the host starts closing.
function dismiss(): boolean {
  revoke()
  return true
}

function close(): void {
  revoke()
  emit('close')
}

function onDiscard(): void {
  // The button disables itself on the next render; a second press before that is the same choice.
  if (discarding.value) return
  discarding.value = true
  void commitDiscard()
}

async function commitDiscard(): Promise<void> {
  try {
    await props.discard()
    if (!finished) close()
  } catch (cause) {
    if (finished) return
    const message = cause instanceof Error ? cause.message : t('streamC.6c92820b72ce4dcf')
    failure.value = t('streamC.3c846dc47c38405f', { v1: String(message) })
    screen.value = 'failed'
  }
}

onMounted(() => {
  const modalEl = anchor.value?.closest<HTMLElement>('.modal')
  if (modalEl) emit('opened', modalEl)
})
onBeforeUnmount(revoke)
</script>
