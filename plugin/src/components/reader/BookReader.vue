<template>
  <div class="abele-book-reader" :class="{ 'abele-book-reader_panel': model.panel }">
    <template v-if="model.panel && model.status === 'ready'">
      <!-- Over the page, on a narrow screen: a tap beside the drawer closes it. -->
      <div class="abele-book-reader__backdrop" @click="emit('panel', false)" />
      <div class="abele-book-reader__panel">
        <div class="abele-book-reader__panel-head">
          <Tabs
            :tabs="panelTabs"
            :model-value="model.panelTab"
            level="secondary"
            @update:model-value="emit('panel-tab', $event as PanelTab)"
          />
          <Icon icon="x" tooltip="Close the panel" @click="emit('panel', false)" />
        </div>
        <BookContents
          v-if="model.panelTab === 'contents'"
          :toc="model.toc"
          :current-href="model.currentHref"
          @pick="onPick"
          @close="emit('panel', false)"
        />
        <BookSearch
          v-else-if="model.panelTab === 'search'"
          :search="model.search"
          @search="emit('search', $event)"
          @go="emit('search-hit', $event, narrow())"
        />
        <BookHighlights
          v-else
          :highlights="model.highlights"
          @go="emit('go-highlight', $event, narrow())"
          @open-note="emit('open-note')"
        />
      </div>
    </template>

    <div class="abele-book-reader__main">
      <div ref="stage" class="abele-book-reader__stage" />
      <div v-if="model.status !== 'ready'" class="abele-book-reader__message">
        {{ model.message }}
      </div>
      <BookSelectionBar
        v-if="model.status === 'ready' && (model.selection || model.active)"
        :highlight="model.active"
        :can-ask="model.canAsk"
        @ask="emit('ask', quoteTarget())"
        @color="onColor"
        @comment="onComment"
        @copy-link="emit('copy-link', target())"
        @quote="emit('quote', quoteTarget())"
        @open-note="emit('open-note', model.active ?? undefined)"
        @delete="model.active && emit('delete-highlight', model.active)"
        @close="model.active ? emit('close-active') : emit('clear-selection')"
      />
      <div v-if="model.status === 'ready'" class="abele-book-reader__footer">
        <Icon
          v-if="model.canGoBack"
          icon="undo-2"
          tooltip="Back to where you were before the link"
          @click="emit('back')"
        />
        <span class="abele-book-reader__chapter">{{ model.chapter }}</span>
        <Slider
          class="abele-book-reader__progress"
          :model-value="Math.round(dragging ?? model.fraction * 1000)"
          :min="0"
          :max="1000"
          label="Go to a place in the book"
          @input="dragging = $event"
          @update:model-value="seek"
        />
        <span class="abele-book-reader__percent">{{
          percent((dragging ?? model.fraction * 1000) / 1000)
        }}</span>
      </div>
    </div>

    <ObsidianModal
      v-if="model.settingsOpen"
      title="Text and layout"
      size="tall"
      @close="emit('settings', false)"
    >
      <ReaderSettingsForm :kind="model.kind" />
    </ObsidianModal>

    <BookComment
      v-if="model.commenting"
      :highlight="model.commenting"
      @save="emit('save-comment', model.commenting!, $event)"
      @cancel="emit('cancel-comment')"
    />

    <ObsidianModal v-if="model.footnote" :title="noteTitle" @close="emit('footnote-close')">
      <div class="abele-book-reader__note">
        <div ref="noteStage" class="abele-book-reader__note-stage" />
        <div class="abele-book-reader__note-actions">
          <Button
            text="Go to the note"
            tooltip="Close this and turn to the note in the book"
            @click="emit('footnote-go')"
          />
        </div>
      </div>
    </ObsidianModal>
  </div>
</template>

<script setup lang="ts">
/**
 * What a book tab shows around the page: the contents panel beside it (a drawer over it on a
 * narrow screen), a line under it with the chapter and a slider through the whole book, the
 * dialog with the text and layout settings, and the one a note opens in.
 *
 * The page itself is the engine's element, which the tab makes and puts into the stage.
 */
import { computed, onMounted, ref, watch } from 'vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import Slider from '../obsidian/Slider.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import BookContents from './BookContents.vue'
import BookSearch from './BookSearch.vue'
import BookHighlights from './BookHighlights.vue'
import BookSelectionBar from './BookSelectionBar.vue'
import BookComment from './BookComment.vue'
import Tabs from '../obsidian/Tabs.vue'
import type { Highlight, HighlightColor } from '@/reader/highlights'
import ReaderSettingsForm from './ReaderSettingsForm.vue'
import {
  percent,
  type BookModel,
  type PanelTab,
  type SearchHit,
  type TocEntry,
} from '@/reader/model'

const props = defineProps<{
  model: BookModel
}>()

const emit = defineEmits<{
  (e: 'stage', el: HTMLElement): void
  (e: 'go', href: string, fromPanel: boolean): void
  (e: 'seek', fraction: number): void
  (e: 'back'): void
  (e: 'panel', open: boolean): void
  (e: 'settings', open: boolean): void
  (e: 'footnote-close'): void
  (e: 'footnote-go'): void
  (e: 'panel-tab', tab: PanelTab): void
  (e: 'search', query: string): void
  (e: 'search-hit', hit: SearchHit, fromPanel: boolean): void
  (e: 'go-highlight', h: Highlight, fromPanel: boolean): void
  (e: 'highlight', color: HighlightColor): void
  (e: 'comment'): void
  (e: 'copy-link', target?: { cfi: string; label: string }): void
  (e: 'quote', target: { cfi: string; label: string; text: string }): void
  (e: 'clear-selection'): void
  (e: 'ask', target: { cfi: string; label: string; text: string }): void
  (e: 'recolor', h: Highlight, color: HighlightColor): void
  (e: 'edit-comment', h: Highlight): void
  (e: 'save-comment', h: Highlight, comment: string): void
  (e: 'cancel-comment'): void
  (e: 'delete-highlight', h: Highlight): void
  (e: 'open-note', h?: Highlight): void
  (e: 'close-active'): void
}>()

const panelTabs = [
  { id: 'contents', label: 'Contents' },
  { id: 'search', label: 'Search' },
  { id: 'highlights', label: 'Highlights' },
]

/** The words or highlight the bar is about, for a link. */
const target = () => props.model.active ?? props.model.selection ?? undefined
const quoteTarget = () => {
  const t = props.model.active ?? props.model.selection
  return { cfi: t.cfi, label: t.label, text: t.text }
}

const onColor = (color: HighlightColor) => {
  if (props.model.active) emit('recolor', props.model.active, color)
  else emit('highlight', color)
}

const onComment = () => {
  if (props.model.active) emit('edit-comment', props.model.active)
  else emit('comment')
}

const stage = ref<HTMLElement>()
const noteStage = ref<HTMLElement>()
/** The slider while its thumb is held, in thousandths; null otherwise. */
const dragging = ref<number | null>(null)

onMounted(() => {
  if (stage.value) emit('stage', stage.value)
})

const seek = (value: number) => {
  dragging.value = null
  emit('seek', value / 1000)
}

/** A narrow tab shows the panel over the page; picking a chapter there gets it out of the way. */
const narrow = () => (stage.value?.closest('.abele-book-reader')?.clientWidth ?? 0) <= 640
const onPick = (entry: TocEntry) => emit('go', entry.href, narrow())

const noteTitle = computed(() => {
  switch (props.model.footnote?.type) {
    case 'endnote':
      return 'Endnote'
    case 'definition':
      return 'Definition'
    case 'biblioentry':
      return 'Reference'
    default:
      return 'Note'
  }
})

// The note's engine element, placed in the dialog once the dialog is there. It has to be in the
// page before it loads: a frame outside the document never loads, and one moved reloads.
watch(
  () => [props.model.footnote?.view, noteStage.value] as const,
  ([view, holder]) => {
    if (view && holder && view.parentElement !== holder) holder.replaceChildren(view)
  },
  { flush: 'post' }
)
</script>

<style lang="scss">
.workspace-leaf-content .view-content.abele-book {
  padding: 0;
  overflow: hidden;
  position: relative;
}

// On a phone Obsidian's navigation bar floats over the bottom of the tab; the reader keeps clear
// of it by the spacing Obsidian gives its own views. The top needs nothing: the tab already
// starts below the header, and taking the header's height off again is what left a band the
// height of a thumb above the text.
.is-phone .workspace-leaf-content .view-content.abele-book {
  box-sizing: border-box;
  padding-bottom: var(--view-bottom-spacing, 0);
}

.abele-book__mount {
  height: 100%;
}

.abele-book-reader {
  position: relative;
  display: flex;
  height: 100%;
  container-type: inline-size;

  &__main {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
  }

  &__stage {
    flex: 1 1 auto;
    min-height: 0;
  }

  &__message {
    position: absolute;
    inset: 0;
    padding: var(--size-4-8) var(--size-4-4);
    color: var(--text-muted);
    text-align: center;
    background-color: var(--background-primary);
  }

  &__footer {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    flex: 0 0 auto;
    padding: var(--size-4-1) var(--size-4-3) var(--size-4-2);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  &__chapter {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 40%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__progress {
    flex: 1 1 auto;
  }

  &__percent {
    flex: 0 0 auto;
    min-width: 3ch;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  &__panel {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    width: 21em;
    max-width: 45%;
    border-inline-end: 1px solid var(--background-modifier-border);
    background-color: var(--background-primary);
  }

  &__backdrop {
    display: none;
  }

  &__panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-4-2);
    padding: var(--size-4-1) var(--size-4-2);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  &__note {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-3);
  }

  &__note-stage {
    height: min(22em, 50vh);
    border-radius: var(--radius-s);
    overflow: hidden;
  }

  &__note-stage > * {
    display: block;
    width: 100%;
    height: 100%;
  }

  &__note-actions {
    display: flex;
    justify-content: flex-end;
  }
}

// A PDF: pages on a tinted ground, so a white page has an edge.
.abele-book-reader__stage:has(> .abele-book__engine_pdf) {
  background-color: var(--background-secondary);
}

.abele-book__engine_pdf::part(filter) {
  box-shadow: var(--shadow-s);
}

// A PDF in a dark theme, when asked: the page's light and dark swapped, its colours kept.
.abele-book__engine_dark-pages::part(filter) {
  filter: invert(1) hue-rotate(180deg);
}

// The canvases PDF.js measures text on, which it leaves in the app's own document.
.abele-book__pdf-hidden {
  position: absolute;
  inset: 0 auto auto 0;
  width: 0;
  height: 0;
  display: none;
}

// Obsidian's status bar floats over the bottom right of the workspace on the desktop.
body:not(.is-mobile) .abele-book-reader__footer {
  padding-bottom: var(--size-4-8);
}

.abele-book-reader__stage > .abele-book__engine {
  display: block;
  width: 100%;
  height: 100%;
}

// Too narrow to share, a phone or a split pane: the contents are a drawer over the page.
@container (max-width: 640px) {
  .abele-book-reader__panel {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 2;
    width: min(85%, 22em);
    max-width: none;
    box-shadow: var(--shadow-l);
  }

  .abele-book-reader__backdrop {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 1;
    background-color: var(--background-modifier-cover);
  }

  .abele-book-reader__chapter {
    display: none;
  }
}
</style>
