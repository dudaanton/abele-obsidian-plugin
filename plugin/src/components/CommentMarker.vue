<template>
  <span
    class="abele-comment-marker"
    :class="{
      [`abele-comment-marker_${state}`]: state !== 'idle',
      'abele-comment-marker_open': open,
      'abele-comment-marker_orphan': unresolved,
    }"
    :data-comment-ids="ids.join(',')"
    :data-comment-kind="kind"
    role="button"
    tabindex="0"
    :aria-label="`${kind === 'human' ? 'Open text comments' : 'Open Ask here'}${unresolved ? ' (unresolved passage)' : ''}`"
    @click.prevent.stop="onPress(ids)"
    @keydown.enter.prevent.stop="onPress(ids)"
    @keydown.space.prevent.stop="onPress(ids)"
  >
    <span ref="iconEl" class="abele-comment-marker__icon" />
    <!-- A count only earns its space when there is something to count. A comment nobody has
         said anything in yet is a marker and no digit — a "0" beside an icon is not information. -->
    <span v-if="count > 0" class="abele-comment-marker__count">{{ count }}</span>
  </span>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { setIcon } from 'obsidian'
import type { CommentState } from '@/editor/CommentPlugin'

/**
 * The icon a comment stands as: where `%%c:…%%` was in a note's editor and reading view, and
 * after the passage in a chat answer. An inline `span` pressed like a button rather than a
 * `<button>`, so selecting the text around it works as it does around a word.
 *
 * Drawn through `renderKitRoot` and drawn anew when anything changes — CodeMirror rebuilds a
 * widget whose `eq` fails — so it is props only: no store, no watchers. The glyph is set with
 * `setIcon` into the marker's own span rather than the kit `Icon`, whose own colour would
 * override the marker's accent and error colours.
 */
const props = withDefaults(
  defineProps<{
    ids: string[]
    /** How much has been said here: the messages of every comment on this marker. */
    count?: number
    state?: CommentState
    open?: boolean
    kind?: 'ai' | 'human'
    /** Its words are no longer found: still openable, faded. */
    unresolved?: boolean
    onPress: (ids: string[]) => void
  }>(),
  { count: 0, state: 'idle', open: false, kind: 'ai', unresolved: false }
)

const iconEl = ref<HTMLElement>()

onMounted(() => {
  if (iconEl.value)
    setIcon(iconEl.value, props.kind === 'human' ? 'message-square' : 'message-circle')
})
</script>
