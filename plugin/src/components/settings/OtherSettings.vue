<template>
  <div class="abele-settings__other">
    <Setting name="Changelog" desc="See what changed in every plugin version, newest first.">
      <Button text="Open changelog" tooltip="Open the plugin changelog" @click="showChangelog" />
    </Setting>
    <Setting
      name="CSS snippets folder"
      desc="Vault folder with .css files to auto-apply as style snippets. Leave empty to disable."
    >
      <Input
        :model-value="snippetsFolder"
        placeholder="e.g. snippets"
        @update:model-value="updateSnippetsFolder"
      />
    </Setting>
    <Setting name="Full-width sidebars" desc="Make sidebars take the full screen width on a phone.">
      <Checkbox :is-enabled="fullWidthSidebars" @toggle="toggleFullWidthSidebars" />
    </Setting>
    <Setting
      name="Half-width sidebars on tablet"
      desc="Make sidebars take half the screen width on a tablet."
    >
      <Checkbox :is-enabled="halfWidthSidebars" @toggle="toggleHalfWidthSidebars" />
    </Setting>
    <Setting
      name="Mermaid viewer"
      desc="Draw mermaid diagrams at the width of the note, with zoom, drag and a full-screen view, instead of Obsidian's own drawing."
    >
      <Checkbox :is-enabled="mermaidViewer" @toggle="toggleMermaidViewer" />
    </Setting>
    <Setting
      name="Own drawing of properties"
      desc="In a note's properties: a wallet's balance beside a link to it, sums worked out in number fields, and cards for File and Files properties and for the cover. Off is Obsidian's own drawing."
    >
      <Checkbox :is-enabled="propertyWidgets" @toggle="togglePropertyWidgets" />
    </Setting>
    <Setting
      name="Remember where notes were left"
      desc="Open each note at the scroll and cursor it was left at, kept on this device. A link to a heading or block, a search result or a book's highlight still goes to its own place."
    >
      <Checkbox :is-enabled="rememberNotePlaces" @toggle="toggleRememberNotePlaces" />
    </Setting>
    <Setting
      name="Counter properties"
      desc="Comma-separated property names drawn as a number with − and + buttons. An empty value counts as 0. Needs own drawing of properties on."
    >
      <Input
        :model-value="counterProperties"
        placeholder="e.g. reps, glasses"
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
      name="Keyboard diagnostics"
      desc="Show, at the top of the screen, what the app reports about the on-screen keyboard — for a screenshot when a dialog ends up under it. Stays on this device."
    >
      <Checkbox :is-enabled="keyboardDiagnostics" @toggle="toggleKeyboardDiagnostics" />
    </Setting>
    <Setting
      name="Coordinates property"
      desc="Note property holding a place as 'lat, lon'. The agent is told to write into this one."
    >
      <Input
        :model-value="mapCoordinatesProperty"
        placeholder="coordinates"
        @update:model-value="updateMapProperty"
      />
    </Setting>
    <Setting
      name="Map style URL"
      desc="MapLibre style for maps in notes and chats. Empty uses the free OpenFreeMap tiles."
    >
      <Input
        :model-value="mapStyleUrl"
        placeholder="https://tiles.openfreemap.org/styles/bright"
        @update:model-value="updateMapStyle"
      />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { debounce } from 'obsidian'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Button from '../obsidian/Button.vue'
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
const mermaidViewer = ref(config.mermaidViewer)
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
    'Date properties',
    'Comma-separated property names drawn as a date with buttons a day back and on, how far away it is, and a button to its daily note. Needs own drawing of properties on.',
    'e.g. date, due'
  ),
  propertyList(
    'priorityProperties',
    'Priority properties',
    'Comma-separated property names drawn as a task priority, low, medium or high, with buttons to raise and lower it. Needs own drawing of properties on.',
    'e.g. priority'
  ),
  propertyList(
    'labelProperties',
    'Label properties',
    'Comma-separated property names drawn as labels, added from those already used in the vault or typed. Needs own drawing of properties on.',
    'e.g. labels'
  ),
  propertyList(
    'groupProperties',
    'Group properties',
    'Comma-separated property names that get a button beside their list, adding one of the notes already used as groups. The list is still typed into as usual. Needs own drawing of properties on.',
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
