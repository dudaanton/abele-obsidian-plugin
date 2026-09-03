<template>
  <ObsidianModal :title="title" size="sheet" @close="emit('close')">
    <div class="abele-comment-sheet">
      <CommentCard :entry="entry" @promoted="emit('close')" />
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * A comment card in a dialog, for a pane with no margin beside the text and for a phone.
 *
 * The same component the margin hosts, with no props of its own added — which is the point:
 * one card, two hosts, and no second implementation of a thread to keep in step. What the
 * sheet contributes is a column. Obsidian sizes the dialog (capped on the desktop, the whole
 * screen on a phone, shorter again while the keyboard is up) and the kit's `sheet` size makes
 * its boxes shrinkable; here the thread takes the room that is left and the input keeps its
 * own, so the field a person is typing in is the last row whatever the height turns out to be.
 *
 * Which card is expanded is `CommentService.open`, not a ref of ours: the marker in the text
 * draws itself open from that same value, and two sources for one fact is how a full-height
 * sheet ends up next to an icon that says nothing is open.
 */
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import CommentCard from './CommentCard.vue'
import { CommentEntry } from '@/entities/Comment'
import { CommentService } from '@/ai/CommentService'

const props = defineProps<{
  entry: CommentEntry
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const service = CommentService.getInstance()

/** The note's name: the only thing on screen that still says where this conversation sits. */
const title = computed(() => {
  const name = props.entry.notePath.split('/').pop() ?? props.entry.notePath
  return name.replace(/\.md$/, '')
})

const showsOurCard = (id: string | null): boolean => !!id && props.entry.ids.includes(id)

onMounted(() => {
  service.open.value = props.entry.ids[0] ?? null
})

onBeforeUnmount(() => {
  // Only if it is still ours: something else may have taken the open card in the meantime.
  if (showsOurCard(service.open.value)) service.open.value = null
})

/**
 * The card keeps its fold action, and in a sheet folding is leaving: two clamped lines in a
 * full-height dialog is not a thing to look at. The session is untouched either way.
 */
watch(
  () => service.open.value,
  (id) => {
    if (!showsOurCard(id)) emit('close')
  }
)
</script>

<style lang="scss">
.abele-comment-sheet {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

/**
 * In the margin the card is a box on the page: a border, a background of its own, and a width
 * the overlay measured for it. In a sheet it *is* the page — the dialog has already drawn the
 * box and spent the padding — so the card gives all three back, takes the reading size the
 * rest of a dialog is set in, and fills what it was given.
 */
.abele-comment-sheet .abele-comment-card {
  flex: 1 1 auto;
  min-height: 0;
  max-width: none;
  padding: 0;
  border: none;
  background-color: transparent;
  font-size: var(--font-ui-medium);
}

/**
 * The one thing that scrolls. In the margin the thread is capped, so a long conversation
 * cannot push the next sidenote off the page; here there is no next sidenote and the cap is
 * what would keep the input away from the bottom.
 *
 * The size is set again here because the thread sets its own: `--font-ui-small` is the size a
 * 300 px sidenote needs, and it does not inherit the card's. A sheet is read at arm's length
 * on a phone, so its conversation is set at the size the rest of a dialog is.
 */
.abele-comment-sheet .abele-comment-thread {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  font-size: var(--font-ui-medium);
}

/* Whatever the keyboard leaves of the viewport, the field is the last row of the column. */
.abele-comment-sheet .abele-comment-input {
  flex: 0 0 auto;
}

/* And what is typed is read at the size of what is answered. */
.abele-comment-sheet .abele-comment-input__field {
  font-size: var(--font-ui-medium);
}
</style>
