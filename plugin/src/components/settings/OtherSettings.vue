<template>
  <!-- What is left once every feature has its page, grouped by what it changes: how Obsidian
       looks, what Abele draws in a note in place of Obsidian, how notes open, where attachments go,
       maps, and the plugin itself. -->
  <div class="abele-settings__other">
    <Section :title="t('settings.OtherSettings.look.a0de5719')">
      <Setting
        :name="t('settings.OtherSettings.full_width_sidebars.bc7a2b4e')"
        :desc="t('settings.OtherSettings.make_sidebars_take_the_full.15d01abc')"
      >
        <Checkbox :is-enabled="fullWidthSidebars" @toggle="toggleFullWidthSidebars" />
      </Setting>
      <Setting
        :name="t('settings.OtherSettings.half_width_sidebars_on_tablet.9c66ca63')"
        :desc="t('settings.OtherSettings.make_sidebars_take_half_the.f915aa8e')"
      >
        <Checkbox :is-enabled="halfWidthSidebars" @toggle="toggleHalfWidthSidebars" />
      </Setting>
      <Setting
        :name="t('settings.OtherSettings.css_snippets_folder.0f718ada')"
        :desc="t('settings.OtherSettings.vault_folder_with_css_files.063bfc1c')"
      >
        <Input
          :model-value="snippetsFolder"
          :placeholder="
            t('settings.OtherSettings.e_g_snippets.d1877812', { literal0: String('snippets') })
          "
          @update:model-value="updateSnippetsFolder"
        />
      </Setting>
    </Section>
    <Section
      :title="t('settings.OtherSettings.drawn_by_abele_in_a.3c7dbc19')"
      :desc="t('settings.OtherSettings.each_one_in_place_of.7bc5aa3f')"
    >
      <Setting
        :name="t('settings.OtherSettings.own_drawing_of_properties.909062a8')"
        :desc="t('settings.OtherSettings.in_a_note_s_properties.769ed541')"
      >
        <Checkbox :is-enabled="propertyWidgets" @toggle="togglePropertyWidgets" />
      </Setting>
      <Setting
        :name="t('settings.OtherSettings.counter_properties.8ebc8e5b')"
        :desc="t('settings.OtherSettings.comma_separated_property_names_drawn.054f1654')"
      >
        <Input
          :model-value="counterProperties"
          :placeholder="
            t('settings.OtherSettings.e_g_reps_glasses.bcb26756', {
              literal0: String('reps, glasses'),
            })
          "
          @update:model-value="updateCounterProperties"
        />
      </Setting>
      <Setting
        v-for="list in propertyLists"
        :key="list.key"
        :class="`abele-other-settings__${list.key}`"
        :name="list.name"
        :desc="list.desc"
      >
        <Input
          :model-value="list.text.value"
          :placeholder="list.placeholder"
          @update:model-value="(value: string) => list.update(value)"
        />
      </Setting>
      <Setting
        :name="t('settings.OtherSettings.mermaid_viewer.0fee57c7')"
        :desc="t('settings.OtherSettings.draw_mermaid_diagrams_at_the.48ca67fa')"
      >
        <Checkbox :is-enabled="mermaidViewer" @toggle="toggleMermaidViewer" />
      </Setting>
      <Setting :name="t('pdf.includeHeaderFooter')">
        <Checkbox :is-enabled="pdfIncludeHeaderFooter" @toggle="togglePdfIncludeHeaderFooter" />
      </Setting>
      <Setting
        :name="t('settings.OtherSettings.open_canvases_in_abele.0104f91b')"
        :desc="t('settings.OtherSettings.open_diagrams_in_the_read.b48fc66f')"
      >
        <Checkbox :is-enabled="canvasViewer" @toggle="toggleCanvasViewer" />
      </Setting>
      <Setting
        :name="t('settings.OtherSettings.editor_syntax_highlighting.9bbd35c2')"
        :desc="t('settings.OtherSettings.highlight_more_fenced_code_languages.89e723bd')"
      >
        <Checkbox :is-enabled="editorSyntaxHighlight" @toggle="toggleEditorSyntaxHighlight" />
      </Setting>
    </Section>
    <Section :title="t('settings.OtherSettings.opening_notes.d2eceee4')">
      <Setting
        :name="t('settings.OtherSettings.remember_where_notes_were_left.1010d0b2')"
        :desc="t('settings.OtherSettings.open_each_note_at_the.c4f04706')"
      >
        <Checkbox :is-enabled="rememberNotePlaces" @toggle="toggleRememberNotePlaces" />
      </Setting>
    </Section>
    <AttachmentRulesSettings />
    <Section :title="t('settings.OtherSettings.maps.119e66d1')">
      <Setting
        :name="t('settings.OtherSettings.coordinates_property.afe852a5')"
        :desc="t('settings.OtherSettings.note_property_holding_a_place.d3b2dd8b')"
      >
        <Input
          :model-value="mapCoordinatesProperty"
          :placeholder="t('settings.OtherSettings.coordinates.29abdbc9')"
          @update:model-value="updateMapProperty"
        />
      </Setting>
      <Setting
        :name="t('settings.OtherSettings.map_style.62a4d250')"
        :desc="t('settings.OtherSettings.how_maps_in_notes_and.dc2e0608')"
      >
        <Dropdown
          :options="settingsOptions(MAP_STYLES)"
          :model-value="mapStyle"
          @update:model-value="pickMapStyle"
        />
      </Setting>
      <!-- Only for one's own style: where MapLibre reads it from. -->
      <Setting
        v-if="mapStyle === 'custom'"
        :name="t('settings.OtherSettings.style_url.221b2c65')"
        :desc="t('settings.OtherSettings.a_maplibre_style_json_of.2c7c7cee')"
      >
        <Input
          :model-value="mapStyleUrl"
          placeholder="https://example.com/style.json"
          @update:model-value="updateMapStyle"
        />
      </Setting>
      <MapStylePreview :choice="mapStyle" :url="savedMapStyleUrl" />
    </Section>
    <Section :title="t('maps.backgrounds')" :desc="t('maps.backgroundHint')">
      <MapBackgroundSettings />
    </Section>
    <Section :title="t('settings.OtherSettings.the_plugin.cb8c07f4')">
      <Setting
        :name="t('settings.OtherSettings.changelog.ead07c84')"
        :desc="t('settings.OtherSettings.see_what_changed_in_every.b28c48a6')"
      >
        <Button
          :text="t('settings.OtherSettings.open_changelog.f8738613')"
          :tooltip="t('settings.OtherSettings.open_the_plugin_changelog.f99c92b8')"
          @click="showChangelog"
        />
      </Setting>
      <Setting
        :name="t('settings.OtherSettings.keyboard_diagnostics.b559c4cd')"
        :desc="t('settings.OtherSettings.show_at_the_top_of.2cad0798')"
      >
        <Checkbox :is-enabled="keyboardDiagnostics" @toggle="toggleKeyboardDiagnostics" />
      </Setting>
    </Section>
  </div>
</template>

<script setup lang="ts">
import { settingsOptions } from '@/i18n/settingsLabels'
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import { debounce } from 'obsidian'
import Setting from '../obsidian/Setting.vue'
import Section from '../obsidian/Section.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import { MAP_STYLES, type MapStyleChoice } from '@/helpers/mapStyles'
import Input from '../obsidian/Input.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Button from '../obsidian/Button.vue'
import AttachmentRulesSettings from './AttachmentRulesSettings.vue'
import MapBackgroundSettings from './MapBackgroundSettings.vue'
import MapStylePreview from './MapStylePreview.vue'
import { openChangelog } from '@/changelog/ChangelogView'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SnippetService } from '@/services/SnippetService'
import { GlobalStore } from '@/stores/GlobalStore'
import { setKeyboardDiagnostics } from '@/helpers/keyboardDiagnostics'

const config = AbeleConfig.getInstance()
const showChangelog = () => {
  const app = GlobalStore.getInstance().app
  ;(app as unknown as { setting?: { close?: () => void } }).setting?.close?.()
  void openChangelog(app)
}
const snippetsFolder = ref(config.snippetsFolder)
const fullWidthSidebars = ref(config.fullWidthSidebars)
const halfWidthSidebars = ref(config.halfWidthSidebarsOnTablet)
const keyboardDiagnostics = ref(config.keyboardDiagnostics)
const mapCoordinatesProperty = ref(config.mapCoordinatesProperty)
const mapStyleUrl = ref(config.mapStyleUrl)
// The preview follows the address once it is saved, not every key typed into it.
const savedMapStyleUrl = ref(config.mapStyleUrl)
// An older settings file with a URL and no choice reads as one's own style.
const mapStyle = ref<MapStyleChoice>(config.mapStyle ?? (config.mapStyleUrl ? 'custom' : 'theme'))
const pickMapStyle = async (value: string) => {
  mapStyle.value = value as MapStyleChoice
  config.mapStyle = mapStyle.value
  await config.saveSettings()
}
const mermaidViewer = ref(config.mermaidViewer)
const pdfIncludeHeaderFooter = ref(config.pdfIncludeHeaderFooter)
const togglePdfIncludeHeaderFooter = async () => {
  pdfIncludeHeaderFooter.value = !pdfIncludeHeaderFooter.value
  config.pdfIncludeHeaderFooter = pdfIncludeHeaderFooter.value
  await config.saveSettings()
}
const canvasViewer = ref(config.canvasViewer)
const toggleCanvasViewer = async () => {
  canvasViewer.value = !canvasViewer.value
  config.canvasViewer = canvasViewer.value
  await config.saveSettings()
}
const editorSyntaxHighlight = computed(() => {
  void config.version.value
  return config.editorSyntaxHighlight
})
const propertyWidgets = ref(config.propertyWidgets)
const rememberNotePlaces = ref(config.rememberNotePlaces)
const counterProperties = ref((config.counterProperties ?? []).join(', '))

const applyClass = (enabled: boolean) => {
  document.body.classList.toggle('abele-full-width-sidebars', enabled)
}

const applyHalfClass = (enabled: boolean) => {
  document.body.classList.toggle('abele-half-width-sidebars', enabled)
}

// Apply on mount
applyClass(fullWidthSidebars.value)
applyHalfClass(halfWidthSidebars.value)

const saveSnippetsFolder = debounce(async (value: string) => {
  config.snippetsFolder = value
  await config.saveSettings()
  await SnippetService.getInstance().reload()
}, 500)

const updateSnippetsFolder = (value: string) => {
  snippetsFolder.value = value
  saveSnippetsFolder(value)
}

const saveMapProperty = debounce(async (value: string) => {
  config.mapCoordinatesProperty = value.trim()
  await config.saveSettings()
}, 500)

const updateMapProperty = (value: string) => {
  mapCoordinatesProperty.value = value
  saveMapProperty(value)
}

const saveMapStyle = debounce(async (value: string) => {
  config.mapStyleUrl = value.trim()
  savedMapStyleUrl.value = config.mapStyleUrl
  await config.saveSettings()
}, 500)

const updateMapStyle = (value: string) => {
  mapStyleUrl.value = value
  saveMapStyle(value)
}

const toggleFullWidthSidebars = async () => {
  fullWidthSidebars.value = !fullWidthSidebars.value
  config.fullWidthSidebars = fullWidthSidebars.value
  applyClass(fullWidthSidebars.value)
  await config.saveSettings()
}

const toggleHalfWidthSidebars = async () => {
  halfWidthSidebars.value = !halfWidthSidebars.value
  config.halfWidthSidebarsOnTablet = halfWidthSidebars.value
  applyHalfClass(halfWidthSidebars.value)
  await config.saveSettings()
}

// Obsidian's own signal to redraw rendered markdown; the plugin passes it on to the editors.
const toggleMermaidViewer = async () => {
  mermaidViewer.value = !mermaidViewer.value
  config.mermaidViewer = mermaidViewer.value
  await config.saveSettings()
  GlobalStore.getInstance().app.workspace.trigger('post-processor-change')
}

const toggleEditorSyntaxHighlight = async () => {
  config.editorSyntaxHighlight = !config.editorSyntaxHighlight
  await config.saveSettings()
}

// The properties on screen are redrawn by the plugin as the saved settings move.
const togglePropertyWidgets = async () => {
  propertyWidgets.value = !propertyWidgets.value
  config.propertyWidgets = propertyWidgets.value
  await config.saveSettings()
}

// Read as each note opens; the places already saved stay, for when it is switched back on.
const toggleRememberNotePlaces = async () => {
  rememberNotePlaces.value = !rememberNotePlaces.value
  config.rememberNotePlaces = rememberNotePlaces.value
  await config.saveSettings()
}

// The rows on screen are drawn again by the plugin as the saved list moves.
const saveCounterProperties = debounce(async (value: string) => {
  config.counterProperties = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  await config.saveSettings()
}, 500)

const updateCounterProperties = (value: string) => {
  counterProperties.value = value
  saveCounterProperties(value)
}

type ListKey = 'dateProperties' | 'priorityProperties' | 'labelProperties' | 'groupProperties'

/** A comma-separated list of property names, saved as the list it spells. */
const propertyList = (key: ListKey, name: string, desc: string, placeholder: string) => {
  const text = ref((config[key] ?? []).join(', '))
  const save = debounce(async (value: string) => {
    config[key] = value
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
    await config.saveSettings()
  }, 500)
  return {
    key,
    name,
    desc,
    placeholder,
    text,
    update: (value: string) => {
      text.value = value
      save(value)
    },
  }
}

const propertyLists = [
  propertyList(
    'dateProperties',
    t('settings.OtherSettings.date_properties.9201e6b8'),
    t('settings.OtherSettings.comma_separated_property_names_drawn.2b3d1640'),
    'e.g. date, due'
  ),
  propertyList(
    'priorityProperties',
    t('settings.OtherSettings.priority_properties.21f4bae9'),
    t('settings.OtherSettings.comma_separated_property_names_drawn.b31eb248'),
    'e.g. priority'
  ),
  propertyList(
    'labelProperties',
    t('settings.OtherSettings.label_properties.7ad8c49d'),
    t('settings.OtherSettings.comma_separated_property_names_drawn.fcb4c6c7'),
    'e.g. labels'
  ),
  propertyList(
    'groupProperties',
    t('settings.OtherSettings.group_properties.23d1a496'),
    t('settings.OtherSettings.comma_separated_property_names_that.cb39dad8'),
    'e.g. groups'
  ),
]

const toggleKeyboardDiagnostics = async () => {
  keyboardDiagnostics.value = !keyboardDiagnostics.value
  config.keyboardDiagnostics = keyboardDiagnostics.value
  setKeyboardDiagnostics(keyboardDiagnostics.value)
  await config.saveSettings()
}
</script>
