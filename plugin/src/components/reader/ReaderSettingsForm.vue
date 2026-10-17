<template>
  <div class="abele-reader-settings">
    <EmptyState
      v-if="kind === 'fixed'"
      :text="t('settings.components.reader.ReaderSettingsForm.this_book_s_pages_are.f094ff7e')"
    />
    <template v-if="kind === 'epub' || kind === 'all'">
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.layout.a5119091')"
        :desc="
          einkState.on
            ? t('settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.8c26479f')
            : t('settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.c0f95f4f')
        "
      >
        <Dropdown
          :options="flowOptions"
          :model-value="settings.flow"
          @update:model-value="set('flow', $event)"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.font.64d0b3ad')"
        :desc="fontDesc"
      >
        <Dropdown
          :options="fontOptions"
          :model-value="settings.font"
          @update:model-value="set('font', $event)"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.fonts_folder.cb89bd22')"
        :desc="t('settings.components.reader.ReaderSettingsForm.a_folder_in_the_vault.92bd812c')"
      >
        <Input
          :model-value="fontsFolder"
          placeholder="Fonts"
          @update:model-value="setFontsFolder"
        />
      </Setting>
      <Setting :name="t('settings.components.reader.ReaderSettingsForm.text_size.d68761cc')">
        <Dropdown
          :options="sizeOptions"
          :model-value="String(settings.fontSize)"
          @update:model-value="set('fontSize', Number($event))"
        />
      </Setting>
      <Setting :name="t('settings.components.reader.ReaderSettingsForm.line_spacing.0db45da1')">
        <Dropdown
          :options="lineOptions"
          :model-value="String(settings.lineHeight)"
          @update:model-value="set('lineHeight', Number($event))"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.margins.eea8d245')"
        :desc="
          t('settings.components.reader.ReaderSettingsForm.the_space_around_the_text.0315d33b')
        "
      >
        <Dropdown
          :options="marginOptions"
          :model-value="settings.margin"
          @update:model-value="set('margin', $event)"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.column_width.86f4e582')"
        :desc="t('settings.components.reader.ReaderSettingsForm.the_widest_a_column_of.f684dbab')"
      >
        <Dropdown
          :options="widthOptions"
          :model-value="String(settings.maxWidth)"
          @update:model-value="set('maxWidth', Number($event))"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.two_columns.ff4a0135')"
        :desc="t('settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.4fa3abc2')"
      >
        <Checkbox
          :is-enabled="settings.columns === 2"
          @toggle="set('columns', settings.columns === 2 ? 1 : 2)"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.theme_colours.c75350b1')"
        :desc="t('settings.components.reader.ReaderSettingsForm.draw_the_book_in_your.2f7ab7ee')"
      >
        <Checkbox
          :is-enabled="settings.themeColors"
          @toggle="set('themeColors', !settings.themeColors)"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.book_s_own_styles.67266f8d')"
        :desc="t('settings.components.reader.ReaderSettingsForm.the_book_s_own_layout.a674d8a8')"
      >
        <Checkbox
          :is-enabled="settings.bookStyles"
          @toggle="set('bookStyles', !settings.bookStyles)"
        />
      </Setting>
    </template>

    <Section v-if="kind === 'pdf' || kind === 'all'" :title="kind === 'all' ? 'PDF' : undefined">
      <Setting
        v-if="kind === 'all'"
        :name="t('settings.components.reader.ReaderSettingsForm.open_pdf_files_in_the.d806dd32')"
        :desc="
          t('settings.components.reader.ReaderSettingsForm.pdfs_open_here_instead_of.3f90cb9b')
        "
      >
        <Checkbox
          :is-enabled="settings.pdfInReader"
          @toggle="set('pdfInReader', !settings.pdfInReader)"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.layout.a5119091')"
        :desc="
          t(
            'settings.components.reader.ReaderSettingsForm.one_continuous_scroll_page_under.0ef1ee8f'
          )
        "
      >
        <Dropdown
          :options="pdfLayoutOptions"
          :model-value="settings.pdfLayout"
          @update:model-value="set('pdfLayout', $event)"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.page_size.bd69e66e')"
        :desc="t('settings.components.reader.ReaderSettingsForm.automatic_is_the_page_s.b16d03bb')"
      >
        <Dropdown
          :options="zoomOptions"
          :model-value="settings.pdfZoom"
          @update:model-value="set('pdfZoom', $event)"
        />
      </Setting>
      <Setting
        v-if="settings.pdfLayout === 'paginated'"
        :name="t('settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.594104bc')"
        :desc="t('settings.components.reader.ReaderSettingsForm.when_the_tab_is_wide.f46590d6')"
      >
        <Checkbox
          :is-enabled="settings.pdfTwoPages"
          @toggle="set('pdfTwoPages', !settings.pdfTwoPages)"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.dark_pages_in_a_dark.93ab09cd')"
        :desc="t('settings.components.reader.ReaderSettingsForm.the_page_s_light_and.d827fce3')"
      >
        <Checkbox
          :is-enabled="settings.pdfDarkPages"
          @toggle="set('pdfDarkPages', !settings.pdfDarkPages)"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.pen_thickness.6cfc015f')"
        :desc="t('settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.ed066925')"
      >
        <Dropdown
          :options="thicknessOptions"
          :model-value="settings.pdfInkThickness"
          @update:model-value="set('pdfInkThickness', $event)"
        />
      </Setting>
      <Setting
        v-if="kind === 'all'"
        :name="
          t('settings.components.reader.ReaderSettingsForm.pen_thickness_on_drawings.cf146856')
        "
        :desc="t('settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.cb33f16a')"
      >
        <Dropdown
          :options="thicknessOptions"
          :model-value="settings.drawingInkThickness"
          @update:model-value="set('drawingInkThickness', $event)"
        />
      </Setting>
    </Section>

    <Section
      :title="t('settings.components.reader.ReaderSettingsForm.e_ink_on_this_device.c30db2fc')"
      :desc="t('settings.components.reader.ReaderSettingsForm.for_a_reader_with_an.85f96337')"
    >
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.e_ink_mode.42a01801')"
        :desc="
          t('settings.components.reader.ReaderSettingsForm.pages_turned_never_scrolled_or.98803e3d')
        "
      >
        <Checkbox :is-enabled="einkState.on" @toggle="setEink({ on: !einkState.on })" />
      </Setting>
      <Setting
        v-if="einkState.on"
        :name="t('settings.components.reader.ReaderSettingsForm.full_refresh.9322071a')"
        :desc="
          t('settings.components.reader.ReaderSettingsForm.the_page_flashes_black_and.d072717f')
        "
      >
        <Dropdown
          :options="refreshOptions"
          :model-value="String(einkState.refreshEvery)"
          @update:model-value="setEink({ refreshEvery: Number($event) })"
        />
      </Setting>
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.show_the_keys_the_reader.ea82694e')"
        :desc="t('settings.components.reader.ReaderSettingsForm.over_the_page_the_name.ff90557a')"
      >
        <Checkbox
          :is-enabled="einkState.showKeys"
          @toggle="setEink({ showKeys: !einkState.showKeys })"
        />
      </Setting>
    </Section>

    <Section :title="t('settings.components.reader.ReaderSettingsForm.reading_aloud.044c9986')">
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.voice.87bf2bc0')"
        :desc="
          t('settings.components.reader.ReaderSettingsForm.the_voices_this_device_has.fbb10a8e')
        "
      >
        <Dropdown
          :options="voiceOptions"
          :model-value="settings.ttsVoice"
          @update:model-value="set('ttsVoice', $event)"
        />
      </Setting>
      <Setting :name="t('settings.components.reader.ReaderSettingsForm.speed.c372fee9')">
        <Dropdown
          :options="rateOptions"
          :model-value="String(settings.ttsRate)"
          @update:model-value="set('ttsRate', Number($event))"
        />
      </Setting>
    </Section>

    <Section
      v-if="kind === 'all'"
      :title="t('settings.components.reader.ReaderSettingsForm.where_books_were_left.28aed7a8')"
    >
      <Setting
        :name="t('settings.components.reader.ReaderSettingsForm.reading_places_file.e1c4bfc7')"
        :desc="
          t('settings.components.reader.ReaderSettingsForm.a_json_file_in_the.601687c5', {
            value0: String(DEFAULT_PLACES_PATH),
          })
        "
      >
        <Input
          :model-value="placesPath"
          :placeholder="DEFAULT_PLACES_PATH"
          @update:model-value="setPlacesPath"
        />
      </Setting>
    </Section>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/**
 * How books are laid out and lettered. Shown in the plugin's settings and, from a book's tab, in a
 * dialog over the book, which redraws as each choice is made. Every change is saved at once.
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Section from '../obsidian/Section.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import Input from '../obsidian/Input.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { THICKNESSES } from '@/drawing/model'
import { readerFonts } from '@/reader/readerFonts'
import { REFRESH_EVERY, eink, setEink } from '@/reader/eink'
import {
  VAULT_FONT,
  vaultFontOf,
  FONT_SIZES,
  PDF_ZOOMS,
  TTS_RATES,
  LINE_HEIGHTS,
  MAX_WIDTHS,
  DEFAULT_PLACES_PATH,
  readerSettingsFrom,
  type ReaderSettings,
} from '@/reader/settings'

withDefaults(
  defineProps<{
    /** Which settings: a book's, a PDF's, or both, as the settings tab shows them. */
    kind?: 'epub' | 'pdf' | 'fixed' | 'all'
  }>(),
  { kind: 'all' }
)

const config = AbeleConfig.getInstance()
const settings = reactive<ReaderSettings>(readerSettingsFrom(config.reader))

// Settings changed on disk — synced from another device — are shown rather than overwritten.
watch(config.version, () => Object.assign(settings, readerSettingsFrom(config.reader)))

/** E-ink mode, this device's own. */
const einkState = eink()
const refreshOptions = REFRESH_EVERY.map((n) => ({
  value: String(n),
  display: n
    ? t('settings.components.reader.ReaderSettingsForm.every_value_pages.95a857a4', {
        value0: String(n),
      })
    : t('settings.components.reader.ReaderSettingsForm.never.6300ef80'),
}))

const flowOptions = [
  {
    value: 'paginated',
    display: t('settings.components.reader.ReaderSettingsForm.pages.9046da16'),
  },
  {
    value: 'scrolled',
    display: t('settings.components.reader.ReaderSettingsForm.scrolling.9b976293'),
  },
]
/** The fonts folder's families; read when the settings open, followed while they are. */
const fonts = readerFonts()
void fonts?.ensure()
const fontOptions = computed(() => {
  const families = fonts?.families.value ?? []
  const chosen = vaultFontOf(settings)
  return [
    {
      value: 'theme',
      display: t('settings.components.reader.ReaderSettingsForm.theme_s_text_font.60cc69f0'),
    },
    { value: 'serif', display: t('settings.components.reader.ReaderSettingsForm.serif.1b5e747e') },
    {
      value: 'sans',
      display: t('settings.components.reader.ReaderSettingsForm.sans_serif.07e77255'),
    },
    {
      value: 'book',
      display: t('settings.components.reader.ReaderSettingsForm.the_book_s_own.e5eed055'),
    },
    ...families.map((f) => ({ value: `${VAULT_FONT}${f.name}`, display: f.name })),
    // A family chosen whose files are not here — not synced yet, or removed — stays chosen,
    // named as what it is; the text is in a serif meanwhile.
    ...(chosen && !families.some((f) => f.name.toLowerCase() === chosen.toLowerCase())
      ? [
          {
            value: settings.font,
            display: t(
              'settings.components.reader.ReaderSettingsForm.value_not_in_the_fonts.a0bd3d6c',
              { value0: String(chosen) }
            ),
          },
        ]
      : []),
  ]
})
const fontDesc = computed(() =>
  fonts?.families.value.length
    ? t('settings.components.reader.ReaderSettingsForm.the_font_of_the_text.d4417807')
    : t('settings.components.reader.ReaderSettingsForm.the_font_of_the_text.b3dc0358')
)
const sizeOptions = FONT_SIZES.map((n) => ({ value: String(n), display: `${n}%` }))
const lineOptions = LINE_HEIGHTS.map((n) => ({
  value: String(n),
  display:
    n === 0
      ? t('settings.components.reader.ReaderSettingsForm.the_book_s_own.e5eed055')
      : String(n),
}))
const marginOptions = [
  { value: 'narrow', display: t('settings.components.reader.ReaderSettingsForm.narrow.ba227109') },
  { value: 'normal', display: t('settings.components.reader.ReaderSettingsForm.normal.a7248eeb') },
  { value: 'wide', display: t('settings.components.reader.ReaderSettingsForm.wide.147170e7') },
]
const pdfLayoutOptions = [
  {
    value: 'scrolled',
    display: t('settings.components.reader.ReaderSettingsForm.continuous_scroll.39e14ae6'),
  },
  {
    value: 'paginated',
    display: t('settings.components.reader.ReaderSettingsForm.pages.9046da16'),
  },
]
const zoomLabel: Record<string, string> = {
  auto: t('settings.components.reader.ReaderSettingsForm.automatic.d461a493'),
  'fit-page': t('settings.components.reader.ReaderSettingsForm.whole_page.d9799e4c'),
  'fit-width': t('settings.components.reader.ReaderSettingsForm.page_width.217fbef1'),
}
const zoomOptions = PDF_ZOOMS.map((z) => ({
  value: z,
  display: zoomLabel[z] ?? `${Math.round(Number(z) * 100)}%`,
}))
const thicknessLabels = {
  fine: t('settings.reader.stroke.fine'),
  medium: t('settings.reader.stroke.medium'),
  bold: t('settings.reader.stroke.bold'),
}
const thicknessOptions = THICKNESSES.map((stroke) => ({
  value: stroke,
  display: thicknessLabels[stroke],
}))
const widthOptions = MAX_WIDTHS.map((n) => ({ value: String(n), display: `${n} px` }))

const rateOptions = TTS_RATES.map((n) => ({ value: String(n), display: `${n}×` }))

/** The device's voices; they arrive a moment after the page on some platforms. */
const voices = ref<SpeechSynthesisVoice[]>([])
const synth = activeWindow.speechSynthesis
const loadVoices = () => (voices.value = synth?.getVoices() ?? [])
loadVoices()
synth?.addEventListener?.('voiceschanged', loadVoices)
onBeforeUnmount(() => synth?.removeEventListener?.('voiceschanged', loadVoices))
const voiceOptions = computed(() => [
  {
    value: '',
    display: t('settings.components.reader.ReaderSettingsForm.the_device_s_voice_for.7aa4eae4'),
  },
  ...[...voices.value]
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
    .map((v) => ({ value: v.voiceURI, display: `${v.name} (${v.lang})` })),
  // A voice chosen on another device stays chosen, named as what it is.
  ...(settings.ttsVoice && !voices.value.some((v) => v.voiceURI === settings.ttsVoice)
    ? [
        {
          value: settings.ttsVoice,
          display: t(
            'settings.components.reader.ReaderSettingsForm.a_voice_from_another_device.f2965a24'
          ),
        },
      ]
    : []),
])

/** The path as typed, saved a moment after typing stops: the places move once it is saved. */
const placesPath = ref(settings.placesPath)
watch(
  () => settings.placesPath,
  (value) => (placesPath.value = value)
)
let placesTimer = 0
const savePlacesPath = () => {
  window.clearTimeout(placesTimer)
  placesTimer = 0
  if (placesPath.value.trim() !== settings.placesPath) set('placesPath', placesPath.value.trim())
}
const setPlacesPath = (value: string) => {
  placesPath.value = value
  window.clearTimeout(placesTimer)
  placesTimer = window.setTimeout(savePlacesPath, 500)
}
// Settings closed while typing: what was typed is kept.
onBeforeUnmount(() => placesTimer && savePlacesPath())

/** The folder as typed, saved a moment after typing stops, as the places file is. */
const fontsFolder = ref(settings.fontsFolder)
watch(
  () => settings.fontsFolder,
  (value) => (fontsFolder.value = value)
)
let fontsTimer = 0
const saveFontsFolder = () => {
  window.clearTimeout(fontsTimer)
  fontsTimer = 0
  if (fontsFolder.value.trim() !== settings.fontsFolder)
    set('fontsFolder', fontsFolder.value.trim())
}
const setFontsFolder = (value: string) => {
  fontsFolder.value = value
  window.clearTimeout(fontsTimer)
  fontsTimer = window.setTimeout(saveFontsFolder, 500)
}
onBeforeUnmount(() => fontsTimer && saveFontsFolder())

const set = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K] | string) => {
  ;(settings as Record<string, unknown>)[key] = value
  config.reader = readerSettingsFrom({ ...settings })
  void config.saveSettings()
}
</script>
