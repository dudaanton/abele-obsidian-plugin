<template>
  <Card
    v-if="message"
    class="abele-comment-pin"
    :class="{ 'abele-comment-pin_open': open }"
    :title="speaker"
    clickable
    @click="reveal"
  >
    <!-- Decoration, not an action: what makes this card a pin rather than a comment, said in
         the one place a 180 px card has room to say it. -->
    <template #badges>
      <Icon icon="pin" no-hover class="abele-comment-pin__mark" />
    </template>

    <template #actions>
      <!-- Three lines is what keeps a stack of pins short; the rest is one press away, and
           this is that press. Drawn only when there is something behind the clamp: a control
           that does nothing when pressed reads as a broken one. `Card` stops a click in here
           from opening the card. -->
      <Icon
        v-if="clamped || open"
        :icon="open ? 'chevron-up' : 'chevron-down'"
        :tooltip="open ? 'Clamp this message back to three lines' : 'Show this message in full'"
        @click="open = !open"
      />
      <Icon icon="pin-off" tooltip="Take this message out of the margin" @click="unpin" />
    </template>

    <Markdown
      ref="body"
      class="abele-comment-pin__body"
      :text="message.content"
      :file-path="pin.notePath"
    />
  </Card>
</template>

<script setup lang="ts">
/**
 * One pinned message, parked at the top of the note's margin.
 *
 * A reminder rather than a conversation: the message, who said it, and the way back to the
 * passage it is about. Everything it draws it reads from the session — there is no copy of
 * `pinned` here, and the message it shows is looked up rather than passed in, so a retry that
 * takes the message away takes the card with it instead of leaving a card over nothing.
 */
import { computed, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import Card from './obsidian/Card.vue'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import { CommentPin } from '@/entities/Comment'
import { CommentService } from '@/ai/CommentService'
import { reliableScrollTo } from '@/helpers/scrollUtils'

const props = defineProps<{ pin: CommentPin }>()

const service = CommentService.getInstance()

/** Unclamped. Local, and deliberately so: it is how this card is being read, not what it is. */
const open = ref(false)

const session = computed(() => service.sessionFor(props.pin.commentId))

/**
 * The message itself, or nothing.
 *
 * Nothing covers two ordinary cases: the comment has not been read off disk yet, and the
 * message has left the conversation on a retry or a branch. `CommentService.get` already
 * keeps the second out of the margin, but the card is mounted from a store the provider
 * fills and would render an empty box for a frame either way.
 */
const message = computed(
  () => session.value?.messages.value.find((msg) => msg.id === props.pin.messageId) ?? null
)

/** Who said it. The agent's own name for an answer, so two pins from two agents read apart. */
const speaker = computed(() =>
  message.value?.role === 'user' ? 'You' : (session.value?.agent.value?.name ?? 'Comment')
)

/**
 * Back to the passage this comment is about, with its card open.
 *
 * `markerFrom` is refreshed by the provider on every sync, so the offset scrolled to is where
 * the marker stands now and not where it stood when the pin was made.
 */
function reveal(): void {
  service.open.value = props.pin.commentId
  reliableScrollTo(props.pin.markerFrom)
}

const unpin = () => void session.value?.unpin(props.pin.messageId)

/**
 * Whether the clamp is actually holding anything back.
 *
 * `Markdown` renders through Obsidian and answers whenever it answers, so a body is empty at
 * mount and grows several times afterwards — measuring once would say "it fits" about every
 * message there is. The observer is built from the element's own window, not the ambient one:
 * a note can be open in a popout, and `ResizeObserver` from the wrong window observes nothing.
 */
const body = ref<ComponentPublicInstance | null>(null)
const clamped = ref(false)

let growth: ResizeObserver | null = null

const measure = (): void => {
  const el = body.value?.$el as HTMLElement | undefined
  // Only meaningful while the clamp is on; unfolded, the chevron stays so it can be folded back.
  if (el && !open.value) clamped.value = el.scrollHeight - el.clientHeight > 1
}

watch(
  body,
  (instance) => {
    growth?.disconnect()
    growth = null

    const el = instance?.$el as HTMLElement | undefined
    const view = el?.ownerDocument.defaultView
    if (!el || !view?.ResizeObserver) return

    growth = new view.ResizeObserver(() => measure())
    growth.observe(el)
    measure()
  },
  { flush: 'post' }
)

onBeforeUnmount(() => {
  growth?.disconnect()
  growth = null
})
</script>

<style lang="scss">
/**
 * A pin sits above the comment cards rather than beside its own marker, so it has to read as
 * a different thing at a glance: the accent edge is what says "kept here on purpose", and the
 * secondary fill is what separates it from the note's background the way a card does.
 */
.abele-comment-pin {
  gap: var(--size-2-2);
  padding: var(--size-4-2);
  border-color: var(--text-accent);
  background-color: var(--background-secondary);
  font-size: var(--font-ui-small);
}

/**
 * The glyph at the size of the name beside it. `Icon` draws at Obsidian's default 18 px, which
 * in a card header at this width is taller than the title it stands next to.
 */
.abele-comment-pin__mark {
  flex: 0 0 auto;
  --icon-size: var(--icon-xs);
  height: auto;
  padding: 0;
  color: var(--text-accent);
}

/**
 * Three lines, and an ellipsis where they stop.
 *
 * There is no cap on how many messages may be pinned, so the height of one is the only thing
 * keeping a stack of them from filling the margin and pushing every comment card off the
 * bottom of the screen. The clamp is on the rendered Markdown rather than on a plain string:
 * `-webkit-line-clamp` counts the lines of a block, and the paragraphs Obsidian renders lose
 * their own margins here so the count is of text and not of gaps.
 */
.abele-comment-pin__body {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  overflow-wrap: anywhere;

  p:first-child,
  ul:first-child,
  ol:first-child {
    margin-top: 0;
  }

  p:last-child,
  ul:last-child,
  ol:last-child {
    margin-bottom: 0;
  }

  pre,
  code {
    white-space: pre-wrap;
    word-break: break-word;
  }
}

/**
 * Read in full. `display: block` rather than a taller clamp: a `-webkit-box` with no line
 * limit still lays its children out as flex items and drops the paragraph spacing.
 */
.abele-comment-pin_open .abele-comment-pin__body {
  display: block;
  -webkit-line-clamp: none;
  line-clamp: none;
  /* Long enough to be worth unfolding, short enough that one pin is not the whole margin. */
  max-height: 20em;
  overflow-y: auto;
}
</style>
