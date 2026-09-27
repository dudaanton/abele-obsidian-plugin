<template>
  <div class="abele-reader-settings">
    <EmptyState
      v-if="kind === 'fixed'"
      text="This book's pages are laid out by the book, like a comic's: there is nothing to set for them. Zoom with Mod and plus or minus, a pinch, or the tab's menu."
    />
    <template v-if="kind === 'epub' || kind === 'all'">
      <Setting
        name="Layout"
        :desc="
          einkState.on
            ? 'Turn pages one at a time, or scroll through each chapter. E-ink mode keeps pages on this device.'
            : 'Turn pages one at a time, or scroll through each chapter.'
        "
      >
        <Dropdown
          :options="flowOptions"
          :model-value="settings.flow"
          @update:model-value="set('flow', $event)"
        />
      </Setting>
      <Setting name="Font" :desc="fontDesc">
        <Dropdown
          :options="fontOptions"
          :model-value="settings.font"
          @update:model-value="set('font', $event)"
        />
      </Setting>
      <Setting
        name="Fonts folder"
        desc="A folder in the vault with font files: .ttf, .otf, .woff or .woff2. Each family in it is offered as a font above, and travels to your other devices with the vault. Obsidian Sync carries them with Sync all other types on. Empty: no fonts from the vault."
      >
        <Input
          :model-value="fontsFolder"
          placeholder="Fonts"
          @update:model-value="setFontsFolder"
        />
      </Setting>
      <Setting name="Text size">
        <Dropdown
          :options="sizeOptions"
          :model-value="String(settings.fontSize)"
          @update:model-value="set('fontSize', Number($event))"
        />
      </Setting>
      <Setting name="Line spacing">
        <Dropdown
          :options="lineOptions"
          :model-value="String(settings.lineHeight)"
          @update:model-value="set('lineHeight', Number($event))"
        />
      </Setting>
      <Setting name="Margins" desc="The space around the text and between columns.">
        <Dropdown
          :options="marginOptions"
          :model-value="settings.margin"
          @update:model-value="set('margin', $event)"
        />
      </Setting>
      <Setting name="Column width" desc="The widest a column of text may grow.">
        <Dropdown
          :options="widthOptions"
          :model-value="String(settings.maxWidth)"
          @update:model-value="set('maxWidth', Number($event))"
        />
      </Setting>
      <Setting name="Two columns" desc="Two pages side by side when the tab is wide enough.">
        <Checkbox
          :is-enabled="settings.columns === 2"
          @toggle="set('columns', settings.columns === 2 ? 1 : 2)"
        />
      </Setting>
      <Setting
        name="Theme colours"
        desc="Draw the book in your theme's text and background colours, dark mode included. Off: the book's own colours, on a light page."
      >
        <Checkbox
          :is-enabled="settings.themeColors"
          @toggle="set('themeColors', !settings.themeColors)"
        />
      </Setting>
      <Setting
        name="Book's own styles"
        desc="The book's own layout: tables, indents, alignment, drop caps. Your text size, spacing, font and colours still win. Nothing outside the book is ever loaded."
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
        name="Open PDF files in the Abele reader"
        desc="PDFs open here instead of in Obsidian's own viewer, with pages to turn, the contents beside them and the place kept. Off: they open in Obsidian's viewer, and Open in Abele reader in a PDF's menu still opens one here."
      >
        <Checkbox
          :is-enabled="settings.pdfInReader"
          @toggle="set('pdfInReader', !settings.pdfInReader)"
        />
      </Setting>
      <Setting
        name="Layout"
        desc="One continuous scroll, page under page, or pages turned one at a time."
      >
        <Dropdown
          :options="pdfLayoutOptions"
          :model-value="settings.pdfLayout"
          @update:model-value="set('pdfLayout', $event)"
        />
      </Setting>
      <Setting
        name="Page size"
        desc="Automatic is the page's width when scrolling and the whole page with pages. Or fit the whole page, fit its width, or a fixed zoom."
      >
        <Dropdown
          :options="zoomOptions"
          :model-value="settings.pdfZoom"
          @update:model-value="set('pdfZoom', $event)"
        />
      </Setting>
      <Setting
        v-if="settings.pdfLayout === 'paginated'"
        name="Two pages side by side"
        desc="When the tab is wide enough, as a printed book lies open."
      >
        <Checkbox
          :is-enabled="settings.pdfTwoPages"
          @toggle="set('pdfTwoPages', !settings.pdfTwoPages)"
        />
      </Setting>
      <Setting
        name="Dark pages in a dark theme"
        desc="The page's light and dark swapped while Obsidian's theme is dark, so a white page does not glare. Pictures come out as negatives."
      >
        <Checkbox
          :is-enabled="settings.pdfDarkPages"
          @toggle="set('pdfDarkPages', !settings.pdfDarkPages)"
        />
      </Setting>
      <Setting
        name="Pen thickness"
        desc="How thick the pen and the marker draw on a PDF. The button beside the colours under the page changes it too."
      >
        <Dropdown
          :options="thicknessOptions"
          :model-value="settings.pdfInkThickness"
          @update:model-value="set('pdfInkThickness', $event)"
        />
      </Setting>
      <Setting
        v-if="kind === 'all'"
        name="Pen thickness on drawings"
        desc="How thick the pen and the marker draw on a drawing or a picture drawn on. The button beside the colours on its bar changes it too."
      >
        <Dropdown
          :options="thicknessOptions"
          :model-value="settings.drawingInkThickness"
          @update:model-value="set('drawingInkThickness', $event)"
        />
      </Setting>
    </Section>

    <Section
      title="E-ink, on this device"
      desc="For a reader with an e-ink screen, such as a Boox. Kept on this device only: your phone and computer read as before."
    >
      <Setting
        name="E-ink mode"
        desc="Pages turned, never scrolled or slid, a PDF's too. Black text on white, nothing grey, thicker lines, nothing that moves or fades. Highlights drawn as lines whose shape tells the colour. A tap in the left or right third turns the page. The page buttons and keys turn it too."
      >
        <Checkbox :is-enabled="einkState.on" @toggle="setEink({ on: !einkState.on })" />
      </Setting>
      <Setting
        v-if="einkState.on"
        name="Full refresh"
        desc="The page flashes black and then white every so many pages, which clears the faint ghost of earlier pages an e-ink screen leaves."
      >
        <Dropdown
          :options="refreshOptions"
          :model-value="String(einkState.refreshEvery)"
          @update:model-value="setEink({ refreshEvery: Number($event) })"
        />
      </Setting>
      <Setting
        name="Show the keys the reader hears"
        desc="Over the page, the name and code of the last key or button pressed, and whether it turned the page; the console logs each. For finding out what a reader's page buttons send when they do not turn the pages."
      >
        <Checkbox
          :is-enabled="einkState.showKeys"
          @toggle="setEink({ showKeys: !einkState.showKeys })"
        />
      </Setting>
    </Section>

    <Section title="Reading aloud">
      <Setting
        name="Voice"
        desc="The voices this device has; on an iPhone, the ones in Settings → Accessibility → Spoken Content. A voice chosen on another device that this one lacks reads as the default."
      >
        <Dropdown
          :options="voiceOptions"
          :model-value="settings.ttsVoice"
          @update:model-value="set('ttsVoice', $event)"
        />
      </Setting>
      <Setting name="Speed">
        <Dropdown
          :options="rateOptions"
          :model-value="String(settings.ttsRate)"
          @update:model-value="set('ttsRate', Number($event))"
        />
      </Setting>
    </Section>

    <Section v-if="kind === 'all'" title="Where books were left">
      <Setting
        name="Reading places file"
        :desc="`A .json file in the vault that keeps where each book was left, so every device opens it there. Obsidian's file list does not show it. Obsidian Sync carries it with Sync all other types on, as it does chats. Changing the path moves the places to the new file. Empty: ${DEFAULT_PLACES_PATH}.`"
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
  display: n ? `Every ${n} pages` : 'Never',
}))

const flowOptions = [
  { value: 'paginated', display: 'Pages' },
  { value: 'scrolled', display: 'Scrolling' },
]
/** The fonts folder's families; read when the settings open, followed while they are. */
const fonts = readerFonts()
void fonts?.ensure()
const fontOptions = computed(() => {
  const families = fonts?.families.value ?? []
  const chosen = vaultFontOf(settings)
  return [
    { value: 'theme', display: "Theme's text font" },
    { value: 'serif', display: 'Serif' },
    { value: 'sans', display: 'Sans-serif' },
    { value: 'book', display: "The book's own" },
    ...families.map((f) => ({ value: `${VAULT_FONT}${f.name}`, display: f.name })),
    // A family chosen whose files are not here — not synced yet, or removed — stays chosen,
    // named as what it is; the text is in a serif meanwhile.
    ...(chosen && !families.some((f) => f.name.toLowerCase() === chosen.toLowerCase())
      ? [{ value: settings.font, display: `${chosen} (not in the fonts folder)` }]
      : []),
  ]
})
const fontDesc = computed(() =>
  fonts?.families.value.length
    ? "The font of the text. The theme's is the one your notes use; below the book's own are the fonts from your fonts folder."
    : "The font of the text. The theme's is the one your notes use. Put font files in the fonts folder to read in your own."
)
const sizeOptions = FONT_SIZES.map((n) => ({ value: String(n), display: `${n}%` }))
const lineOptions = LINE_HEIGHTS.map((n) => ({
  value: String(n),
  display: n === 0 ? "The book's own" : String(n),
}))
const marginOptions = [
  { value: 'narrow', display: 'Narrow' },
  { value: 'normal', display: 'Normal' },
  { value: 'wide', display: 'Wide' },
]
const pdfLayoutOptions = [
  { value: 'scrolled', display: 'Continuous scroll' },
  { value: 'paginated', display: 'Pages' },
]
const zoomLabel: Record<string, string> = {
  auto: 'Automatic',
  'fit-page': 'Whole page',
  'fit-width': 'Page width',
}
const zoomOptions = PDF_ZOOMS.map((z) => ({
  value: z,
  display: zoomLabel[z] ?? `${Math.round(Number(z) * 100)}%`,
}))
const thicknessOptions = THICKNESSES.map((t) => ({
  value: t,
  display: t[0].toUpperCase() + t.slice(1),
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
  { value: '', display: "The device's voice for the book's language" },
  ...[...voices.value]
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
    .map((v) => ({ value: v.voiceURI, display: `${v.name} (${v.lang})` })),
  // A voice chosen on another device stays chosen, named as what it is.
  ...(settings.ttsVoice && !voices.value.some((v) => v.voiceURI === settings.ttsVoice)
    ? [{ value: settings.ttsVoice, display: 'A voice from another device' }]
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
