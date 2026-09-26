<template>
  <div
    class="abele-book-selection"
    role="toolbar"
    data-ignore-swipe="true"
    :aria-label="highlight ? 'Highlight' : 'Selection'"
  >
    <div class="abele-book-selection__colors">
      <Icon
        v-for="c in HIGHLIGHT_COLORS"
        :key="c"
        icon="circle"
        :color="c"
        :active="highlight?.color === c"
        :tooltip="highlight ? `Make it ${c}` : `Highlight in ${c}`"
        class="abele-book-selection__swatch"
        @click="emit('color', c)"
      />
    </div>
    <div class="abele-book-selection__actions">
      <Icon
        icon="message-square"
        :tooltip="highlight?.comment ? 'Edit the comment' : 'Highlight and write a comment'"
        @click="emit('comment')"
      />
      <Icon
        v-if="canAsk"
        :icon="highlight?.discussion ? 'messages-square' : 'message-square-plus'"
        :tooltip="
          highlight?.discussion
            ? 'Open the discussion about these words'
            : 'Ask the agent about these words: a discussion kept with them'
        "
        @click="emit('ask')"
      />
      <Icon
        v-if="!highlight"
        icon="audio-lines"
        tooltip="Read aloud from here"
        @click="emit('read-aloud')"
      />
      <Icon icon="link" tooltip="Copy a link to this place" @click="emit('copy-link')" />
      <Icon
        icon="text-quote"
        tooltip="Quote these words with a link into the note you were last in"
        @click="emit('quote')"
      />
      <Icon
        v-for="s in scripts ?? []"
        :key="s.name"
        :icon="s.icon || 'scroll-text'"
        :tooltip="`Run ${s.name} on these words`"
        class="abele-book-selection__script"
        :data-script="s.name"
        @click="emit('script', s.name)"
      />
      <Icon
        v-if="canRunScripts"
        icon="terminal"
        tooltip="Run a script on these words…"
        class="abele-book-selection__run-script"
        @click="emit('script')"
      />
      <template v-if="highlight">
        <Icon icon="file-text" tooltip="Open the highlights note" @click="emit('open-note')" />
        <Icon icon="trash-2" tooltip="Remove the highlight" @click="emit('delete')" />
      </template>
      <Icon
        icon="x"
        :tooltip="highlight ? 'Close' : 'Clear the selection'"
        @click="emit('close')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * What can be done to words selected on the page — highlight them in a colour, comment, link to
 * them, quote them into a note, run a script on them — or to a highlight that was tapped: recolour it, comment, link,
 * open its note, remove it. A row of glyphs, so it fits a phone.
 */
import Icon from '../obsidian/Icon.vue'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '@/reader/highlights'

defineProps<{
  /** The highlight tapped; unset for a fresh selection. */
  highlight?: Highlight | null
  /** The AI side is on, so a chat can be asked from here. */
  canAsk?: boolean
  /** Scripts whose header says `@book`: a button each. */
  scripts?: { name: string; icon?: string }[]
  /** There are scripts to pick one from. */
  canRunScripts?: boolean
}>()

const emit = defineEmits<{
  (e: 'color', color: HighlightColor): void
  (e: 'comment'): void
  (e: 'ask'): void
  (e: 'read-aloud'): void
  (e: 'copy-link'): void
  (e: 'quote'): void
  (e: 'script', name?: string): void
  (e: 'open-note'): void
  (e: 'delete'): void
  (e: 'close'): void
}>()
</script>

<style lang="scss">
.abele-book-selection {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
  padding: 0 var(--size-4-2);
  /* One row, in the place of the line under the page and as tall: what does not fit on a
     narrow screen scrolls sideways rather than taking a second row from the page. */
  overflow-x: auto;
  scrollbar-width: none;
  border-top: 1px solid var(--background-modifier-border);
  background-color: var(--background-primary);

  &::-webkit-scrollbar {
    display: none;
  }

  &__colors,
  &__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--size-2-1);
  }

  /* Dots, narrower than the glyphs beside them: a highlight's full row fits a phone. */
  &__swatch.abele-obsidian-icon {
    padding-inline: var(--size-2-1);
  }

  &__swatch svg {
    fill: currentColor;
  }
}
</style>
