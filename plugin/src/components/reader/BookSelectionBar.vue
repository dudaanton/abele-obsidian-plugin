<template>
  <div
    class="abele-book-selection"
    role="toolbar"
    data-ignore-swipe="true"
    :aria-label="highlight ? t('streamC.07ccd15df32aa7e2') : t('kit.selection')"
  >
    <div class="abele-book-selection__colors abele-glyph-row">
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
              ? t('streamC.9ff94b2871da87cf', {
                  v1: streamCLabel(c),
                  v2: String(SHAPE_NAMES[einkShape(c)]),
                })
              : t('streamC.23555f01f2ded293', {
                  v1: streamCLabel(c),
                  v2: String(SHAPE_NAMES[einkShape(c)]),
                })
          "
          :aria-label="`${streamCLabel(c)}, ${SHAPE_NAMES[einkShape(c)]}`"
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
          :tooltip="
            highlight
              ? t('streamC.10d5c05487cb0225', { v1: streamCLabel(c) })
              : t('streamC.c06fc933938a9b36', { v1: streamCLabel(c) })
          "
          class="abele-book-selection__swatch"
          @click="emit('color', c)"
        />
      </template>
    </div>
    <div class="abele-book-selection__actions">
      <Icon
        icon="message-square"
        :tooltip="
          highlight?.comment ? t('streamC.745be8170559e2bb') : t('streamC.73d189b8feaa5e0a')
        "
        @click="emit('comment')"
      />
      <Icon
        v-if="canAsk"
        :icon="highlight?.discussion ? 'messages-square' : 'message-square-plus'"
        :tooltip="
          highlight?.discussion ? t('streamC.c6fec0f39d426672') : t('streamC.b78089158f67f818')
        "
        @click="emit('ask')"
      />
      <!-- Everything else in one menu, as Obsidian keeps a file's: the bar keeps what is done
           most to words, the colour, a comment and asking about them. -->
      <Icon
        class="abele-book-selection__more"
        icon="more-horizontal"
        aria-haspopup="menu"
        :tooltip="highlight ? t('streamC.c621479d31d37d0e') : t('streamC.fe07e933f02c75c4')"
        @click="openMore"
      />
      <Icon
        icon="x"
        :tooltip="highlight ? t('sync.window.close') : t('streamC.ef8b2814c03baa20')"
        @click="emit('close')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { streamCLabel } from '@/i18n/streamCLabels'
import { t } from '@/i18n'

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
  underline: t('streamC.ef23a7cecf915858'),
  double: t('streamC.674921a2690cbcff'),
  dashed: t('streamC.d03d2266d1a2b36a'),
  box: t('streamC.1fd10d64e0796fee'),
  'dashed-box': t('streamC.97db3d6467682e74'),
  'over-under': t('streamC.e541b63c59926194'),
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
    add('words', t('streamC.4619ac8735307219'), 'audio-lines', () => emit('read-aloud'))
  add('words', t('streamC.a07fe21d13f60519'), 'link', () => emit('copy-link'))
  add('words', t('streamC.750a724fe76f47a8'), 'text-quote', () => emit('quote'))
  for (const s of props.scripts ?? [])
    add('scripts', t('streamC.c1bfff806c4c1522', { v1: s.label }), s.icon, () =>
      emit('script', s.script)
    )
  if (props.canRunScripts)
    add('scripts', t('streamC.5a402ae4193038da'), 'terminal', () => emit('script'))
  const h = props.highlight
  if (h) {
    add(
      'highlight',
      h.forms?.length ? t('streamC.5e5a008baf522713') : t('streamC.6134b994540e4142'),
      'underline',
      () => emit('forms')
    )
    add('highlight', t('streamC.2bc80b2883dbd963'), 'file-text', () => emit('open-note', event))
    if (props.repairable) {
      add('highlight', t('streamC.5e6a728bf0c4b847'), 'wrench', () => emit('repair', false))
      if ((props.repairCount ?? 0) > 1)
        add(
          'highlight',
          t('streamC.e7bd26947204b0fb', { v1: String(props.repairCount) }),
          'wrench',
          () => emit('repair', true)
        )
    }
    add('remove', t('streamC.1385c21c5accbf32'), 'trash-2', () => emit('delete'), true)
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

  // On a phone the first dot's ink stands under the page's words.
  body.is-phone & {
    padding-inline-start: var(--size-4-6);
  }

  &__colors,
  &__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--size-2-1);
  }

  /* Dots keep a glyph's whole box, so each is as easy to hit; they stand edge to edge instead,
     which keeps a highlight's full row on a phone. */
  &__colors {
    gap: 0;
  }

  &__swatch svg {
    fill: currentColor;
  }
}
</style>
