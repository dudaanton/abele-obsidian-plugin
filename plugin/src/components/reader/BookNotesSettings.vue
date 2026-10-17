<template>
  <Section
    :title="
      bookKey
        ? t('settings.components.reader.BookNotesSettings.highlights_of_this_book.1202b037')
        : t('settings.components.reader.BookNotesSettings.highlights.6e517828')
    "
    class="abele-book-notes"
  >
    <Setting
      :name="t('settings.components.reader.BookNotesSettings.where_they_go.e7d3bea7')"
      :desc="
        bookKey
          ? t('settings.components.reader.BookNotesSettings.for_this_book_alone_as.cc47dd64')
          : t('settings.components.reader.BookNotesSettings.a_note_of_each_book.198e675e')
      "
    >
      <Dropdown :options="toOptions" :model-value="to" @update:model-value="setTo" />
    </Setting>
    <Setting
      v-if="target.to === 'note'"
      :name="
        bookKey
          ? t('settings.components.reader.BookNotesSettings.note.d8da2c49')
          : t('settings.components.reader.BookNotesSettings.note_for_all_books.105d496e')
      "
      :desc="
        bookKey
          ? t('settings.components.reader.BookNotesSettings.the_note_this_book_s.47b93fc6', {
              value0: String(fallbackPath),
            })
          : t(
              'settings.components.reader.BookNotesSettings.made_with_the_first_highlight.21e4557d',
              { value0: String(DEFAULT_NOTES_PATH) }
            )
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
      :name="t('settings.components.reader.BookNotesSettings.template.0575f29d')"
      :desc="
        bookKey
          ? t('settings.components.reader.BookNotesSettings.a_note_to_make_this.fe9815bd')
          : t('settings.components.reader.BookNotesSettings.a_note_a_new_highlights.a56f13fc', {
              literal0: String('{{#body}}'),
              literal1: String('{{/body}}'),
              literal2: String('{{ highlight }}'),
              literal3: String('{{ quote }}'),
              literal4: String('{{ comment }}'),
              literal5: String('{{ title }}'),
              literal6: String('{{ author }}'),
              literal7: String('{{ book }}'),
              literal8: String('{{ chapter }}'),
              literal9: String('{{ date }}'),
            })
      "
    >
      <Search
        :model-value="template"
        :placeholder="
          bookKey
            ? fallbackTemplate || t('settings.components.reader.BookNotesSettings.none.dc937b59')
            : t('settings.components.reader.BookNotesSettings.none.dc937b59')
        "
        :suggester="FileSuggest"
        @update:model-value="type('notesTemplate', $event)"
      />
    </Setting>
  </Section>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
  book: t('settings.components.reader.BookNotesSettings.a_note_of_the_book.6c1f2ec2'),
  note: t('settings.components.reader.BookNotesSettings.one_note_for_every_book.698e6f78'),
}
const toOptions = computed(() =>
  props.bookKey
    ? [
        {
          value: '',
          display: t('settings.components.reader.BookNotesSettings.as_in_settings_value.7686ad0c', {
            value0: String(place[settings.value.notesTo].toLowerCase()),
          }),
        },
        {
          value: 'book',
          display: t('settings.components.reader.BookNotesSettings.a_note_of_the_book.6c1f2ec2'),
        },
        {
          value: 'note',
          display: t('settings.components.reader.BookNotesSettings.a_note_you_name.09402a6f'),
        },
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
