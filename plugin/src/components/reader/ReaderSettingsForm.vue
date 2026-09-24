<template>
  <div class="abele-reader-settings">
    <Setting name="Layout" desc="Turn pages one at a time, or scroll through each chapter.">
      <Dropdown
        :options="flowOptions"
        :model-value="settings.flow"
        @update:model-value="set('flow', $event)"
      />
    </Setting>
    <Setting name="Font" desc="The font of the text. The theme's is the one your notes use.">
      <Dropdown
        :options="fontOptions"
        :model-value="settings.font"
        @update:model-value="set('font', $event)"
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
  </div>
</template>

<script setup lang="ts">
/**
 * How books are laid out and lettered. Shown in the plugin's settings and, from a book's tab, in a
 * dialog over the book, which redraws as each choice is made. Every change is saved at once.
 */
import { reactive, watch } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  FONT_SIZES,
  LINE_HEIGHTS,
  MAX_WIDTHS,
  readerSettingsFrom,
  type ReaderSettings,
} from '@/reader/settings'

const config = AbeleConfig.getInstance()
const settings = reactive<ReaderSettings>(readerSettingsFrom(config.reader))

// Settings changed on disk — synced from another device — are shown rather than overwritten.
watch(config.version, () => Object.assign(settings, readerSettingsFrom(config.reader)))

const flowOptions = [
  { value: 'paginated', display: 'Pages' },
  { value: 'scrolled', display: 'Scrolling' },
]
const fontOptions = [
  { value: 'theme', display: "Theme's text font" },
  { value: 'serif', display: 'Serif' },
  { value: 'sans', display: 'Sans-serif' },
  { value: 'book', display: "The book's own" },
]
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
const widthOptions = MAX_WIDTHS.map((n) => ({ value: String(n), display: `${n} px` }))

const set = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K] | string) => {
  ;(settings as Record<string, unknown>)[key] = value
  config.reader = readerSettingsFrom({ ...settings })
  void config.saveSettings()
}
</script>
