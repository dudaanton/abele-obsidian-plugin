<template>
  <Section :title="bookKey ? 'Highlights of this book' : 'Highlights'" class="abele-book-notes">
    <Setting
      name="Where they go"
      :desc="
        bookKey
          ? 'For this book alone. “As in settings” follows Settings → Books.'
          : 'A note of each book\'s own, beside it, or one note for every book. A book can choose for itself from its Aa button.'
      "
    >
      <Dropdown :options="toOptions" :model-value="to" @update:model-value="setTo" />
    </Setting>
    <Setting
      v-if="target.to === 'note'"
      :name="bookKey ? 'Note' : 'Note for all books'"
      :desc="
        bookKey
          ? `The note this book's highlights go to. Empty: ${fallbackPath}.`
          : `Made with the first highlight; each book's are told apart by their links. Empty: ${DEFAULT_NOTES_PATH}.`
      "
    >
      <Search
        :model-value="path"
        :placeholder="fallbackPath"
        :suggester="FileSuggest"
        @update:model-value="type('notesPath', $event)"
      />
    </Setting>
    <Setting
      name="Template"
      :desc="
        bookKey
          ? 'A note to make this book\'s highlights note from. Empty: as in settings.'
          : 'A note a new highlights note is made from. Between {{#body}} and {{/body}} is what each highlight adds, {{ highlight }} being the highlight; also {{ title }}, {{ author }}, {{ book }}, {{ chapter }}, {{ date }}. Empty: none.'
      "
    >
      <Search
        :model-value="template"
        :placeholder="bookKey ? fallbackTemplate || 'None' : 'None'"
        :suggester="FileSuggest"
        @update:model-value="type('notesTemplate', $event)"
      />
    </Setting>
  </Section>
</template>

<script setup lang="ts">
/**
 * Where highlights go: for every book in Settings → Books, and — given a book's key — for that
 * book alone in its Aa dialog, where anything left as it is follows the settings. Saved to the
 * plugin's settings, so every device the settings reach writes a book's highlights to one note.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Section from '../obsidian/Section.vue'
import Search from '../obsidian/Search.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  DEFAULT_NOTES_PATH,
  notesTargetFor,
  readerSettingsFrom,
  withBookNotes,
  type BookNotesChoice,
  type NotesTo,
  type ReaderSettings,
} from '@/reader/settings'

const props = defineProps<{
  /** The book whose own choice this is; none for the choice for every book. */
  bookKey?: string
}>()

const config = AbeleConfig.getInstance()
const settings = ref<ReaderSettings>(readerSettingsFrom(config.reader))
// Settings changed on disk — synced from another device — are shown rather than overwritten.
watch(config.version, () => (settings.value = readerSettingsFrom(config.reader)))

const own = computed<BookNotesChoice>(() =>
  props.bookKey ? (settings.value.bookNotes[props.bookKey] ?? {}) : {}
)
const target = computed(() => notesTargetFor(settings.value, props.bookKey ?? ''))

const place: Record<NotesTo, string> = {
  book: "A note of the book's own",
  note: 'One note for every book',
}
const toOptions = computed(() =>
  props.bookKey
    ? [
        { value: '', display: `As in settings (${place[settings.value.notesTo].toLowerCase()})` },
        { value: 'book', display: "A note of the book's own" },
        { value: 'note', display: 'A note you name' },
      ]
    : [
        { value: 'book', display: place.book },
        { value: 'note', display: place.note },
      ]
)
const to = computed(() => (props.bookKey ? (own.value.notesTo ?? '') : settings.value.notesTo))

/** What the fields fall back to: for a book, the settings'; for every book, the defaults. */
const fallbackPath = computed(() =>
  props.bookKey ? settings.value.notesPath.trim() || DEFAULT_NOTES_PATH : DEFAULT_NOTES_PATH
)
const fallbackTemplate = computed(() => settings.value.notesTemplate.trim())

// The paths as typed, saved a moment after typing stops.
const path = ref('')
const template = ref('')
const showStored = () => {
  path.value = (props.bookKey ? own.value.notesPath : settings.value.notesPath) ?? ''
  template.value = (props.bookKey ? own.value.notesTemplate : settings.value.notesTemplate) ?? ''
}
showStored()
watch(settings, () => !timer && showStored())

type Field = 'notesTo' | 'notesPath' | 'notesTemplate'

const save = (field: Field, value: string) => {
  const now = readerSettingsFrom(config.reader)
  if (props.bookKey) {
    const choice: BookNotesChoice = { ...(now.bookNotes[props.bookKey] ?? {}) }
    if (value) (choice as Record<string, string>)[field] = value
    else delete choice[field]
    config.reader = { ...now, bookNotes: withBookNotes(now.bookNotes, props.bookKey, choice) }
  } else {
    config.reader = readerSettingsFrom({ ...now, [field]: value })
  }
  settings.value = readerSettingsFrom(config.reader)
  void config.saveSettings()
}

const setTo = (value: string) => save('notesTo', value)

let timer = 0
let pending: [Field, string] | null = null
const flush = () => {
  window.clearTimeout(timer)
  timer = 0
  if (pending) save(...pending)
  pending = null
}
const type = (field: Field, value: string) => {
  if (field === 'notesPath') path.value = value
  else template.value = value
  if (pending && pending[0] !== field) flush()
  pending = [field, value.trim()]
  window.clearTimeout(timer)
  timer = window.setTimeout(flush, 500)
}
// Closed while typing: what was typed is kept.
onBeforeUnmount(flush)
</script>
