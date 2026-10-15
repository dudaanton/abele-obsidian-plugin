<template>
  <ObsidianModal
    title="Review retained canvas change"
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
          text="Keep retained work"
          tooltip="Close the review and keep the retained copy"
          @click="close"
        />
        <Button
          key="review-discard"
          text="Discard local pending copy…"
          tooltip="Ask before discarding the local pending copy"
          warning
          @click="screen = 'confirm'"
        />
      </template>
      <template v-else-if="screen === 'confirm'">
        <Button
          key="confirm-cancel"
          text="Cancel"
          tooltip="Close the review and keep the retained copy"
          @click="close"
        />
        <Button
          key="confirm-discard"
          text="Discard local pending copy"
          tooltip="Drop the local pending copy; the canvas file is not touched"
          warning
          :disabled="discarding"
          @click="onDiscard"
        />
      </template>
      <Button
        v-else
        key="failed-keep"
        text="Keep retained work"
        tooltip="Close the review and keep the retained copy"
        @click="close"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
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
  matching:
    'Matching file contents do not acknowledge this attempt. Keep the retained copy, or discard only local pending work. Any desired change afterward is a new ordinary edit after rereading the current file, not replay of this attempt.',
  native:
    'A native editor is open. Its unsaved contents are separate from persisted source; this review neither cancels native saves nor proves that this attempt succeeded.',
  confirm:
    'Discard the retained pending copy and its unresolved attempt evidence? This does not undo any changes already written to the canvas file. The file may already contain this change. No file contents will be written or restored, and no history entry will be added.',
  written:
    'The source write was confirmed. Discard does not reconstruct the missing local acknowledgment or history entry.',
  reread:
    'After discarding, reread the current file before making a new independently chosen edit. This does not authorize replaying the old attempt.',
}

const screen = ref<'review' | 'confirm' | 'failed'>('review')
const discarding = ref(false)
const failure = ref('')
const anchor = ref<HTMLElement | null>(null)
let finished = false

const parseError = computed(
  () =>
    `Persisted source cannot be parsed: ${props.review.source.error}. Discard does not repair or rewrite it.`
)

// Shown as text only, in `<pre>` by interpolation: source and extension contents cannot execute
// markup or load attachments.
const sections = computed(() => [
  {
    kind: 'source',
    title: 'Current persisted source',
    value: props.review.source.bytes,
    graph: props.review.source.graph,
  },
  {
    kind: 'proposed',
    title: 'Retained proposed draft — not persisted-source evidence',
    value: JSON.stringify(props.review.evidence.proposed, null, 2),
    graph: props.review.evidence.proposed,
  },
  {
    kind: 'baseline',
    title: 'Original baseline (historical)',
    value: JSON.stringify(props.review.evidence.baseline, null, 2),
    graph: props.review.evidence.baseline.graph,
  },
])

function graphSummary(graph: CanvasGraph): string {
  return `${graph.nodes.length} node${graph.nodes.length === 1 ? '' : 's'}, ${graph.edges.length} connection${graph.edges.length === 1 ? '' : 's'}. Preview: ${
    graph.nodes
      .slice(0, 3)
      .map((node) => labelOf(node).slice(0, 120))
      .join('; ') || '(empty)'
  }. Expand for full data.`
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
    const message = cause instanceof Error ? cause.message : 'Local choice could not complete'
    failure.value = `${message}. Close and reopen the review; retained work has not been discarded by this obsolete choice.`
    screen.value = 'failed'
  }
}

onMounted(() => {
  const modalEl = anchor.value?.closest<HTMLElement>('.modal')
  if (modalEl) emit('opened', modalEl)
})
onBeforeUnmount(revoke)
</script>
