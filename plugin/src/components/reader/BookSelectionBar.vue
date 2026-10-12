<template>
  <div
    class="abele-book-selection"
    role="toolbar"
    data-ignore-swipe="true"
    :aria-label="highlight ? 'Highlight' : 'Selection'"
  >
    <div class="abele-book-selection__colors">
      <!-- On e-ink a colour is shown as the shape its highlight takes, which a grey screen can
           tell apart where it cannot the colours. -->
      <template v-if="einkOn">
        <Icon
          v-for="c in HIGHLIGHT_COLORS"
          :key="c"
          text-right="ab"
          :active="highlight?.color === c"
          :tooltip="
            highlight
              ? `Make it ${c}: ${SHAPE_NAMES[einkShape(c)]}`
              : `Highlight in ${c}: ${SHAPE_NAMES[einkShape(c)]}`
          "
          :aria-label="`${c}, ${SHAPE_NAMES[einkShape(c)]}`"
          :class="`abele-book-selection__shape abele-book-selection__shape_${einkShape(c)}`"
          :data-color="c"
          @click="emit('color', c)"
        />
      </template>
      <template v-else>
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
      </template>
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
      <!-- Everything else in one menu, as Obsidian keeps a file's: the bar keeps what is done
           most to words, the colour, a comment and asking about them. -->
      <Icon
        class="abele-book-selection__more"
        icon="more-horizontal"
        aria-haspopup="menu"
        :tooltip="highlight ? 'More for this highlight' : 'More for these words'"
        @click="openMore"
      />
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
 * open its note, remove it. Frequent actions stay on the bar; the rest use a native menu.
 */
import { computed } from 'vue'
import { Menu } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '@/reader/highlights'
import { eink, einkShape, type EinkShape } from '@/reader/eink'

/** On e-ink, what each shape a highlight takes is called, for its tooltip. */
const SHAPE_NAMES: Record<EinkShape, string> = {
  underline: 'underlined',
  double: 'underlined twice',
  dashed: 'a dashed underline',
  box: 'boxed',
  'dashed-box': 'in a dashed box',
  'over-under': 'lined above and below',
}
const einkOn = computed(() => eink().on)

const props = defineProps<{
  /** The highlight tapped; unset for a fresh selection. */
  highlight?: Highlight | null
  /** The AI side is on, so a chat can be asked from here. */
  canAsk?: boolean
  repairable?: boolean
  repairCount?: number
  /**
   * The book menu's scripts, chosen in the settings or by their header, listed in More.
   */
  scripts?: { script: string; label: string; icon: string }[]
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
  (e: 'open-note', evt?: MouseEvent): void
  (e: 'forms'): void
  (e: 'repair', all: boolean): void
  (e: 'delete'): void
  (e: 'close'): void
}>()

/** The rest of what can be done to the words, in sections as Obsidian's own menus have them. */
const openMore = (event: MouseEvent) => {
  const menu = new Menu()
  const add = (section: string, title: string, icon: string, run: () => void, warning = false) =>
    menu.addItem((item) =>
      item.setTitle(title).setIcon(icon).setSection(section).setWarning(warning).onClick(run)
    )
  if (!props.highlight)
    add('words', 'Read aloud from here', 'audio-lines', () => emit('read-aloud'))
  add('words', 'Copy a link to this place', 'link', () => emit('copy-link'))
  add('words', 'Quote into the last note', 'text-quote', () => emit('quote'))
  for (const s of props.scripts ?? [])
    add('scripts', `Run ${s.label}`, s.icon, () => emit('script', s.script))
  if (props.canRunScripts) add('scripts', 'Run a script…', 'terminal', () => emit('script'))
  const h = props.highlight
  if (h) {
    add(
      'highlight',
      h.forms?.length
        ? 'Change the words underlined in the book'
        : 'Underline this word in the book',
      'underline',
      () => emit('forms')
    )
    add('highlight', 'Open the highlights note', 'file-text', () => emit('open-note', event))
    if (props.repairable) {
      add('highlight', 'Repair this highlight link…', 'wrench', () => emit('repair', false))
      if ((props.repairCount ?? 0) > 1)
        add('highlight', `Repair all found links (${props.repairCount})…`, 'wrench', () =>
          emit('repair', true)
        )
    }
    add('remove', 'Remove the highlight', 'trash-2', () => emit('delete'), true)
  }
  menu.showAtMouseEvent(event)
}
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
