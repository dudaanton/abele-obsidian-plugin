<template>
  <div class="abele-book-reader" :class="{ 'abele-book-reader_panel': model.panel }">
    <template v-if="model.panel && model.status === 'ready'">
      <!-- Over the page, on a narrow screen: a tap beside the drawer closes it. -->
      <div class="abele-book-reader__backdrop" @click="emit('panel', false)" />
      <div class="abele-book-reader__panel">
        <div ref="panelHead" class="abele-book-reader__panel-head">
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
        <BookBookmarks
          v-else-if="model.panelTab === 'bookmarks'"
          :bookmarks="model.bookmarks"
          :current="model.bookmarksHere"
          @go="emit('go-bookmark', $event, narrow())"
          @remove="emit('remove-bookmark', $event)"
        />
        <BookHighlights
          v-else
          :highlights="model.highlights"
          @go="emit('go-highlight', $event, narrow())"
          @discuss="emit('discuss', $event)"
          @open-note="emit('open-note')"
        />
      </div>
    </template>

    <div class="abele-book-reader__main">
      <div class="abele-book-reader__page">
        <div ref="stage" class="abele-book-reader__stage" />
        <div v-if="model.status !== 'ready'" class="abele-book-reader__message">
          {{ model.message }}
        </div>
      </div>
      <!-- One row under the page, always as tall, for one thing at a time: the bar for words
           selected or a highlight tapped, else the bar for reading aloud, else the line with the
           slider. Nothing stands over the text, and the page is never laid out anew for a bar —
           which would move the words under a selection. -->
      <div v-if="model.status === 'ready'" class="abele-book-reader__foot">
        <BookInkBar
          v-if="model.ink.on"
          :ink="model.ink"
          @tool="emit('ink-tool', $event)"
          @color="emit('ink-color', $event)"
          @finger="emit('ink-finger', $event)"
          @undo="emit('ink-undo')"
          @redo="emit('ink-redo')"
          @done="emit('ink', false)"
        />
        <BookSelectionBar
          v-else-if="(model.selection || model.active) && !model.selecting"
          :highlight="model.active"
          :can-ask="model.canAsk"
          :scripts="pinnedScripts"
          :can-run-scripts="hasScripts"
          @script="emit('run-script', quoteTarget(), $event)"
          @ask="emit('ask', quoteTarget())"
          @read-aloud="emit('read-aloud')"
          @color="onColor"
          @comment="onComment"
          @copy-link="emit('copy-link', target())"
          @quote="emit('quote', quoteTarget())"
          @open-note="emit('open-note', model.active ?? undefined)"
          @delete="model.active && emit('delete-highlight', model.active)"
          @close="model.active ? emit('close-active') : emit('clear-selection')"
        />
        <BookSpeechBar
          v-else-if="model.speech !== 'idle'"
          :state="model.speech === 'paused' ? 'paused' : 'playing'"
          @action="emit('speech', $event)"
        />
        <BookFooter
          v-else
          :model="model"
          @back="emit('back')"
          @seek="emit('seek', $event)"
          @bookmark="emit('bookmark')"
          @draw="emit('ink', true)"
        />
      </div>
    </div>

    <ObsidianModal
      v-if="model.settingsOpen"
      title="Text and layout"
      size="tall"
      @close="emit('settings', false)"
    >
      <div class="abele-book-reader__settings">
        <ReaderSettingsForm :kind="model.kind" />
        <BookNotesSettings v-if="model.key && model.kind !== 'fixed'" :book-key="model.key" />
      </div>
    </ObsidianModal>

    <BookComment
      v-if="model.commenting"
      :highlight="model.commenting"
      @save="emit('save-comment', model.commenting!, $event)"
      @cancel="emit('cancel-comment')"
    />

    <BookFigureViewer v-if="model.figure" :figure="model.figure" @close="emit('figure-close')" />

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
import BookFooter from './BookFooter.vue'
import BookFigureViewer from './BookFigureViewer.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import BookContents from './BookContents.vue'
import BookSearch from './BookSearch.vue'
import BookHighlights from './BookHighlights.vue'
import BookBookmarks from './BookBookmarks.vue'
import BookSelectionBar from './BookSelectionBar.vue'
import BookComment from './BookComment.vue'
import BookSpeechBar from './BookSpeechBar.vue'
import BookInkBar from './BookInkBar.vue'
import type { InkToolName } from '@/reader/ink/inkModel'
import type { InkColor } from '@/reader/ink/stroke'
import Tabs from '../obsidian/Tabs.vue'
import type { Highlight, HighlightColor } from '@/reader/highlights'
import ReaderSettingsForm from './ReaderSettingsForm.vue'
import BookNotesSettings from './BookNotesSettings.vue'
import { type BookModel, type PanelTab, type SearchHit, type TocEntry } from '@/reader/model'
import type { Bookmark } from '@/reader/bookmarks'
import { ScriptService } from '@/scripting/ScriptService'
import { bookScripts } from '@/scripting/runFromBook'

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
  (e: 'figure-close'): void
  (e: 'discuss', h: Highlight): void
  (e: 'footnote-go'): void
  (e: 'panel-tab', tab: PanelTab): void
  (e: 'search', query: string): void
  (e: 'search-hit', hit: SearchHit, fromPanel: boolean): void
  (e: 'go-highlight', h: Highlight, fromPanel: boolean): void
  (e: 'highlight', color: HighlightColor): void
  (e: 'comment'): void
  (e: 'copy-link', target?: { cfi: string; label: string }): void
  (e: 'quote', target: { cfi: string; label: string; text: string }): void
  (e: 'run-script', target: { cfi: string; label: string; text: string }, name?: string): void
  (e: 'clear-selection'): void
  (e: 'ask', target: { cfi: string; label: string; text: string }): void
  (e: 'read-aloud'): void
  (e: 'speech', action: 'toggle' | 'stop' | 'next' | 'prev' | 'settings'): void
  (e: 'recolor', h: Highlight, color: HighlightColor): void
  (e: 'edit-comment', h: Highlight): void
  (e: 'save-comment', h: Highlight, comment: string): void
  (e: 'cancel-comment'): void
  (e: 'delete-highlight', h: Highlight): void
  (e: 'open-note', h?: Highlight): void
  (e: 'close-active'): void
  (e: 'bookmark'): void
  (e: 'go-bookmark', b: Bookmark, fromPanel: boolean): void
  (e: 'remove-bookmark', b: Bookmark): void
  (e: 'ink', on: boolean): void
  (e: 'ink-tool', tool: InkToolName): void
  (e: 'ink-color', color: InkColor): void
  (e: 'ink-finger', on: boolean): void
  (e: 'ink-undo'): void
  (e: 'ink-redo'): void
}>()

const panelTabs = [
  { id: 'contents', label: 'Contents' },
  { id: 'search', label: 'Search' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'bookmarks', label: 'Bookmarks' },
]

/** The words or highlight the bar is about, for a link. */
const target = () => props.model.active ?? props.model.selection ?? undefined
const quoteTarget = () => {
  const t = props.model.active ?? props.model.selection
  return { cfi: t.cfi, label: t.label, text: t.text }
}

// Scripts to run on the words: the ones whose header says `@book` have a button each.
const scriptList = ScriptService.getInstance().scriptList
const hasScripts = computed(() => scriptList.value.length > 0)
const pinnedScripts = computed(() =>
  bookScripts(scriptList.value).map((s) => ({ name: s.meta.name, icon: s.meta.icon }))
)

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

onMounted(() => {
  if (stage.value) emit('stage', stage.value)
})

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

// On a phone the panel's tabs are one row that scrolls sideways: the one showing is brought into
// view, so a list opened from the menu or by a test is not named by a tab off the edge.
const panelHead = ref<HTMLElement>()
const revealTab = (head: HTMLElement) => {
  const tab = head.querySelector<HTMLElement>('.abele-tabs__tab_active')
  const strip = tab?.parentElement
  if (!tab || !strip || strip.scrollWidth <= strip.clientWidth) return
  const t = tab.getBoundingClientRect()
  const box = strip.getBoundingClientRect()
  const pad = parseFloat(getComputedStyle(strip).paddingInlineEnd) || 0
  if (t.left < box.left + pad) strip.scrollLeft -= box.left + pad - t.left
  else if (t.right > box.right - pad) strip.scrollLeft += t.right - (box.right - pad)
}
watch(
  () => [props.model.panel, props.model.panelTab, panelHead.value] as const,
  ([open, , head]) => {
    // Once laid out: measured as it is first drawn, the strip was not yet as wide as it ends up.
    if (open && head) head.win.requestAnimationFrame(() => revealTab(head))
  },
  { flush: 'post' }
)

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

  &__page {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  &__stage {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* The row under the page: as tall whatever it holds, so swapping what it holds moves no
     line of the page. On the desktop Obsidian's status bar floats over its bottom right. */
  &__foot {
    display: flex;
    flex: 0 0 auto;
    box-sizing: content-box;
    height: var(--abele-book-foot, 2.75rem);
  }

  &__foot > * {
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    height: 100%;
  }

  &__message {
    position: absolute;
    inset: 0;
    padding: var(--size-4-8) var(--size-4-4);
    color: var(--text-muted);
    text-align: center;
    background-color: var(--background-primary);
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

  /* The text and layout settings scroll inside their tall dialog: the dialog is as tall as a
     dialog may be and clips, so a form that only grew had its last rows cut off on a phone,
     with nothing to scroll. */
  &__settings {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
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
body:not(.is-mobile) .abele-book-reader__foot {
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
