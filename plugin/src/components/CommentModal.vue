<template>
  <ObsidianModal :title="title" size="tall" @close="emit('close')">
    <div class="abele-comment-modal">
      <CommentCard :entry="entry" host="modal" @promoted="emit('close')" />
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * A comment card in a dialog, for a pane with no margin beside the text and for a phone.
 *
 * The same component the margin hosts, told only which host it is in — which is the point:
 * one card, two hosts, and no second implementation of a thread to keep in step. What the
 * dialog contributes is a column and a frame with its own way out, so the card drops the fold
 * chevron that would otherwise sit beside the dialog's × doing the same thing.
 *
 * The geometry is Obsidian's: the kit's `tall` size asks for their `mod-lg`, which on a phone
 * is the sheet they draw for their own big dialogs — full width, bottom-pinned, top edge and
 * close button clear of the notch. The one thing added to it is the keyboard, which their
 * sizing does not take off a dialog. Writing that geometry ourselves is what put the close
 * button under the status bar in 1.17.0, and it is not to be written again.
 *
 * Which card is expanded is `CommentService.open`, not a ref of ours: the marker in the text
 * draws itself open from that same value, and two sources for one fact is how a full-height
 * dialog ends up next to an icon that says nothing is open.
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
 * The card keeps its fold action in the margin, and in a dialog folding is leaving: two
 * clamped lines in a full-height dialog is not a thing to look at. The session is untouched
 * either way.
 */
watch(
  () => service.open.value,
  (id) => {
    if (!showsOurCard(id)) emit('close')
  }
)
</script>

<style lang="scss">
.abele-comment-modal {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

/**
 * In the margin the card is a box on the page: a border, a background of its own, and a width
 * the overlay measured for it. In a dialog it *is* the page — the dialog has already drawn the
 * box and spent the padding — so the card gives all three back, takes the reading size the
 * rest of a dialog is set in, and fills what it was given.
 */
.abele-comment-modal .abele-comment-card {
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
 * what would keep the composer away from the bottom.
 *
 * The size is set again here because the thread sets its own: `--font-ui-small` is the size a
 * 300 px sidenote needs, and it does not inherit the card's. A dialog is read at arm's length
 * on a phone, so its conversation is set at the size the rest of a dialog is.
 */
.abele-comment-modal .abele-comment-thread {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  font-size: var(--font-ui-medium);
}

/* Whatever the keyboard leaves of the screen, the field is the last row of the column. */
.abele-comment-modal .abele-comment-input {
  flex: 0 0 auto;
}

/**
 * The agent picker, at the size the rest of a dialog is hit at.
 *
 * The margin's is a badge with a chevron, sized to a 300 px sidenote header. A dialog is the
 * whole screen of a phone — and a narrow desktop pane, which is the other thing that opens one
 * — so the picker goes back to a control a thumb can land on, as the composer below it does.
 */
.abele-comment-modal .abele-comment-card__agent .abele-obsidian-dropdown .dropdown {
  min-height: var(--size-4-9);
  font-size: var(--font-ui-small);
}
</style>
