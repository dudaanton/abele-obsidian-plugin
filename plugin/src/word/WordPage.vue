<template>
  <div class="abele-word-page" :class="{ 'abele-word-page_read-only': !!model.readOnly }">
    <!-- The ribbon, one row as in Google Docs: the paragraph's style, the marks, lists, a link,
         a picture, a paragraph more or less. It acts on the paragraph being written in. -->
    <div
      v-if="!model.readOnly"
      class="abele-word-page__ribbon"
      role="toolbar"
      aria-label="Format the paragraph"
      @mousedown="keepFocus"
    >
      <Dropdown
        class="abele-word-page__style"
        :model-value="current?.style ?? ''"
        :options="styleOptions"
        :disabled="!current"
        aria-label="Paragraph style"
        @update:model-value="setStyle"
      />
      <span class="abele-word-page__sep" aria-hidden="true" />
      <Icon
        v-for="mark in MARKS"
        :key="mark.mark"
        :icon="mark.icon"
        :tooltip="`${mark.label} (${mark.keys})`"
        :disabled="!current"
        :active="!!current && markOn(mark.mark)"
        @click="toggleMark(mark.mark)"
      />
      <span class="abele-word-page__sep" aria-hidden="true" />
      <Icon
        icon="list"
        tooltip="Bulleted list"
        :disabled="!current"
        :active="current?.list === 'bullet'"
        @click="setList('bullet')"
      />
      <Icon
        icon="list-ordered"
        tooltip="Numbered list"
        :disabled="!current"
        :active="current?.list === 'decimal'"
        @click="setList('decimal')"
      />
      <span class="abele-word-page__sep" aria-hidden="true" />
      <Icon icon="link" tooltip="Link the selected words" :disabled="!current" @click="addLink" />
      <Icon
        icon="image-plus"
        tooltip="Insert a picture after this paragraph"
        :disabled="!current"
        @click="insertImage"
      />
      <span class="abele-word-page__sep" aria-hidden="true" />
      <Icon
        icon="between-horizontal-end"
        tooltip="Add a paragraph below"
        :disabled="!current"
        @click="addBelow"
      />
      <Icon
        icon="trash-2"
        tooltip="Delete this paragraph"
        :disabled="!current"
        @click="deleteCurrent"
      />
    </div>

    <!-- The page on its grey field, as Word and Pages show it; the theme's own colours. -->
    <div class="abele-word-page__field" @mousedown.self="leave">
      <div class="abele-word-page__sheet" :style="{ zoom: zoom / 100 }">
        <template v-for="block in model.blocks" :key="`${block.kind}-${block.number}`">
          <figure v-if="block.kind === 'image'" class="abele-word-page__image">
            <img :src="block.src" :alt="block.alt" :width="block.width" :height="block.height" />
          </figure>
          <table v-else-if="block.kind === 'table'" class="abele-word-page__table">
            <tbody>
              <tr v-for="(row, r) in block.rows" :key="r">
                <td v-for="cell in row" :key="cell.number">
                  <WordPageLine
                    :paragraph="cell"
                    :marker="markers.get(cell.number)"
                    :editing="editing === cell.number"
                    :read-only="!!model.readOnly"
                    @open="open(cell)"
                    @keys="onKeys"
                    @leave="leave"
                    @input="draft = $event"
                    @select="selection = $event"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <WordPageLine
            v-else
            :paragraph="block"
            :marker="markers.get(block.number)"
            :editing="editing === block.number"
            :read-only="!!model.readOnly"
            @open="open(block)"
            @keys="onKeys"
            @leave="leave"
            @input="draft = $event"
            @select="selection = $event"
          />
        </template>
      </div>
    </div>

    <!-- Word's status bar: where you are, how long it is, whether it is saved; the zoom. -->
    <div class="abele-word-page__status" role="status">
      <span v-if="model.readOnly" class="abele-word-page__fact"
        >Read only: {{ model.readOnly }}</span
      >
      <template v-else>
        <span v-if="current" class="abele-word-page__fact"
          >Paragraph {{ position }} of {{ paragraphs.length }}</span
        >
        <span class="abele-word-page__fact">{{ words }} {{ words === 1 ? 'word' : 'words' }}</span>
        <span
          v-if="save.state !== 'idle'"
          class="abele-word-page__fact"
          :class="{ 'abele-word-page__fact_error': save.state === 'failed' }"
          >{{ saveText }}</span
        >
      </template>
      <span class="abele-word-page__zoom">
        <Icon
          icon="minus"
          size="xs"
          tooltip="Smaller"
          :disabled="zoom <= 50"
          @click="zoomBy(-10)"
        />
        <span class="abele-word-page__zoom-value">{{ zoom }}%</span>
        <Icon icon="plus" size="xs" tooltip="Larger" :disabled="zoom >= 200" @click="zoomBy(10)" />
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Icon from '@/components/obsidian/Icon.vue'
import WordPageLine from './WordPageLine.vue'
import {
  allParagraphs,
  markCovers,
  paragraphText,
  wordCount,
  type WordMark,
  type WordPageEdit,
  type WordPageModel,
  type WordPageParagraph,
  type WordSaveState,
} from './pageModel'

const props = withDefaults(
  defineProps<{
    model: WordPageModel
    save?: WordSaveState
  }>(),
  { save: () => ({ state: 'idle' }) }
)

const emit = defineEmits<{
  /** One change to the document, as the document's own operations say it. */
  edit: [edit: WordPageEdit]
  /** Asked for a picture to put after a paragraph. */
  pickImage: [paragraph: number]
  /** Asked for an address for the selected words. */
  pickLink: [edit: Omit<WordPageEdit, 'url'>]
}>()

const MARKS: { mark: WordMark; icon: string; label: string; keys: string }[] = [
  { mark: 'bold', icon: 'bold', label: 'Bold', keys: 'Mod+B' },
  { mark: 'italic', icon: 'italic', label: 'Italic', keys: 'Mod+I' },
  { mark: 'underline', icon: 'underline', label: 'Underline', keys: 'Mod+U' },
  { mark: 'strike', icon: 'strikethrough', label: 'Strikethrough', keys: 'Mod+Shift+X' },
]

const paragraphs = computed(() => allParagraphs(props.model))
const words = computed(() => wordCount(props.model))

/** A bullet for each bulleted paragraph; a numbered one counts on from the one before it. */
const markers = computed(() => {
  const out = new Map<number, string>()
  let count = 0
  for (const p of paragraphs.value) {
    count = p.list === 'decimal' ? count + 1 : 0
    if (p.list === 'bullet') out.set(p.number, '•')
    else if (p.list === 'decimal') out.set(p.number, `${count}.`)
  }
  return out
})

const editing = ref<number | null>(null)
const draft = ref('')
const selection = ref<{ from: number; to: number }>({ from: 0, to: 0 })
const current = computed(() => paragraphs.value.find((p) => p.number === editing.value) ?? null)
const position = computed(() => paragraphs.value.findIndex((p) => p.number === editing.value) + 1)

const styleOptions = computed(() => [
  { value: '', display: 'Normal' },
  ...props.model.styles.map((s) => ({ value: s.id, display: s.name })),
])

const saveText = computed(() =>
  props.save.state === 'saving'
    ? 'Saving…'
    : props.save.state === 'saved'
      ? 'Saved'
      : props.save.state === 'failed'
        ? `Not saved: ${props.save.reason}`
        : ''
)

/** The ribbon's presses leave the caret where it was. */
const keepFocus = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('.clickable-icon')) e.preventDefault()
}

const base = (operation: WordPageEdit['operation']): WordPageEdit => ({
  operation,
  paragraph: editing.value ?? 0,
})

/** What was typed goes in as one replacement of the paragraph's text, before anything else. */
const flush = () => {
  const p = current.value
  if (!p || draft.value === paragraphText(p)) return
  emit('edit', { ...base('replace'), old_text: paragraphText(p), new_text: draft.value })
}

const open = (p: WordPageParagraph) => {
  if (props.model.readOnly || p.locked) return
  if (editing.value !== null && editing.value !== p.number) flush()
  editing.value = p.number
  draft.value = paragraphText(p)
  selection.value = { from: draft.value.length, to: draft.value.length }
}

const leave = () => {
  flush()
  editing.value = null
}

const range = () =>
  selection.value.to > selection.value.from ? selection.value : { from: 0, to: draft.value.length }

const markOn = (mark: WordMark) => {
  const { from, to } = range()
  return !!current.value && markCovers(current.value, mark, from, to)
}

const toggleMark = (mark: WordMark) => {
  if (!current.value) return
  flush()
  const { from, to } = range()
  emit('edit', { ...base('format'), format: mark, from, to, enabled: !markOn(mark) })
}

const setStyle = (style: string) => {
  if (!current.value) return
  flush()
  emit('edit', { ...base('style'), style_id: style })
}

const setList = (list: 'bullet' | 'decimal') => {
  if (!current.value) return
  flush()
  emit('edit', { ...base('list'), list: current.value.list === list ? 'none' : list })
}

const addLink = () => {
  if (!current.value) return
  flush()
  const { from, to } = range()
  emit('pickLink', { ...base('link'), from, to })
}

const insertImage = () => {
  if (!current.value) return
  flush()
  emit('pickImage', current.value.number)
}

const addBelow = () => {
  if (!current.value) return
  flush()
  emit('edit', { ...base('paragraph_add'), text: '' })
}

const deleteCurrent = () => {
  if (!current.value) return
  emit('edit', base('paragraph_delete'))
  editing.value = null
}

/** Keys as Word has them: Enter splits, Backspace on an empty paragraph removes it, Esc leaves. */
const onKeys = (e: KeyboardEvent) => {
  const mod = e.metaKey || e.ctrlKey
  if (e.key === 'Escape') {
    e.preventDefault()
    leave()
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    flush()
    emit('edit', { ...base('paragraph_split'), offset: selection.value.from })
  } else if (e.key === 'Backspace' && draft.value === '' && current.value) {
    e.preventDefault()
    deleteCurrent()
  } else if (mod && !e.shiftKey && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
    e.preventDefault()
    toggleMark(({ b: 'bold', i: 'italic', u: 'underline' } as const)[e.key.toLowerCase() as 'b'])
  } else if (mod && e.shiftKey && e.key.toLowerCase() === 'x') {
    e.preventDefault()
    toggleMark('strike')
  }
}

const zoom = ref(100)
const zoomBy = (by: number) => (zoom.value = Math.min(200, Math.max(50, zoom.value + by)))

defineExpose({ open, leave })
</script>

<style lang="scss">
.abele-word-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.abele-word-page__ribbon {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  padding: var(--size-2-3) var(--size-4-3);
  border-bottom: 1px solid var(--background-modifier-border);
  background-color: var(--background-primary);
  overflow-x: auto;
  scrollbar-width: none;
  flex: none;
}

.abele-word-page__style {
  flex: none;
  width: 10em;
}

.abele-word-page__sep {
  flex: none;
  align-self: stretch;
  width: 1px;
  margin-inline: var(--size-2-2);
  background-color: var(--background-modifier-border);
}

.abele-word-page__field {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: var(--size-4-8) var(--size-4-4);
  background-color: var(--background-secondary);
}

.abele-word-page__sheet {
  box-sizing: border-box;
  max-width: 50em;
  min-height: 60em;
  margin-inline: auto;
  padding: var(--size-4-16) var(--size-4-12);
  background-color: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  box-shadow: var(--shadow-s);
  font-family: var(--font-text);
  font-size: var(--font-text-size);
  line-height: var(--line-height-normal);
  color: var(--text-normal);
}

.abele-word-page__image {
  margin: var(--size-4-3) 0;

  img {
    max-width: 100%;
    height: auto;
  }
}

.abele-word-page__table {
  width: 100%;
  margin: var(--size-4-3) 0;
  border-collapse: collapse;

  td {
    padding: var(--size-2-2) var(--size-2-3);
    border: 1px solid var(--background-modifier-border);
    vertical-align: top;
  }
}

.abele-word-page__status {
  display: flex;
  align-items: center;
  gap: var(--size-4-3);
  padding: var(--size-2-2) var(--size-4-3);
  border-top: 1px solid var(--background-modifier-border);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
  flex: none;
}

.abele-word-page__fact_error {
  color: var(--text-error);
}

.abele-word-page__zoom {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  margin-inline-start: auto;
}

.abele-word-page__zoom-value {
  min-width: 3em;
  text-align: center;
}

// A phone: the page is the screen's width, the zoom has no place.
.is-phone {
  .abele-word-page__field {
    padding: 0;
  }

  .abele-word-page__sheet {
    min-height: 100%;
    padding: var(--size-4-4);
    border: none;
    border-radius: 0;
    box-shadow: none;
  }

  .abele-word-page__zoom {
    display: none;
  }
}
</style>
