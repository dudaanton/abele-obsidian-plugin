<template>
  <Section
    title="Scripts on selected words"
    :desc="
      surface === 'book'
        ? 'Scripts pinned to the book selection menu, in this order. Up to three are a button each; more fold into one menu. Other scripts remain under “Other script…”.'
        : 'Scripts chosen for the chat selection menu, independently of books. Chat launch support is not enabled yet.'
    "
    class="abele-selection-scripts-settings"
    :class="{ 'abele-book-scripts-settings': surface === 'book' }"
    :data-surface="surface"
  >
    <EmptyState
      v-if="!scripts.length"
      text="There are no scripts yet: add one to the scripts folder first."
    />
    <EmptyState v-else-if="!chosen.length && !headed.length" text="Nothing on the menu yet." />
    <Setting
      v-for="(entry, idx) in chosen"
      :key="entry.script"
      :name="entry.name.trim() || entry.script"
      :desc="
        exists(entry.script) ? `Script: ${entry.script}` : `Script: ${entry.script} — not found`
      "
      class="abele-selection-scripts-settings__entry"
      :class="{ 'abele-book-scripts-settings__entry': surface === 'book' }"
      :data-script="entry.script"
    >
      <Input
        :model-value="entry.name"
        placeholder="Name on the bar"
        @update:model-value="rename(idx, $event)"
      />
      <Icon
        :icon="entry.icon || iconOf(entry.script)"
        tooltip="Choose the icon it has on the bar"
        @click="pickingIconFor = idx"
      />
      <Icon
        icon="arrow-up"
        :disabled="idx === 0"
        :tooltip="idx === 0 ? 'Already the first' : 'Move it up the menu'"
        @click="move(idx, -1)"
      />
      <Icon
        icon="arrow-down"
        :disabled="idx === chosen.length - 1"
        :tooltip="idx === chosen.length - 1 ? 'Already the last' : 'Move it down the menu'"
        @click="move(idx, 1)"
      />
      <Icon icon="trash" tooltip="Take it off the menu" @click="pendingRemoval = entry.script" />
    </Setting>
    <Setting
      v-for="s in headed"
      :key="s.meta.name"
      :name="s.meta.name"
      :desc="`On the menu by its own header (${header}), after the ones above. Add it to the list to rename it or give it a place.`"
      class="abele-selection-scripts-settings__headed"
      :class="{ 'abele-book-scripts-settings__headed': surface === 'book' }"
      :data-script="s.meta.name"
    >
      <Button
        text="Add to the list"
        :tooltip="`Put ${s.meta.name} in the list above, to rename it or move it`"
        @click="add(s.meta.name)"
      />
    </Setting>
    <div v-if="scripts.length" class="abele-selection-scripts-settings__add">
      <Button
        text="Add a script"
        tooltip="Search your scripts for one to put on the menu"
        @click="addScript"
      />
    </div>
    <IconPicker
      v-if="pickingIconFor !== null && chosen[pickingIconFor]"
      :current="chosen[pickingIconFor].icon"
      @choose="chooseIcon"
      @close="pickingIconFor = null"
    />
    <ConfirmModal
      v-if="pendingRemoval"
      title="Take off the menu"
      :message="`Take ${pendingRemoval} off the menu for words in a ${surface === 'book' ? 'book' : 'chat'}? The script itself stays.${isHeaded(pendingRemoval) ? ` Its ${header} header still puts it on this menu; remove that line from the script to hide it.` : ''}`"
      confirm-text="Take off"
      :confirm-tooltip="`Take ${pendingRemoval} off the menu`"
      @confirm="remove(pendingRemoval)"
      @close="pendingRemoval = null"
    />
  </Section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { debounce } from 'obsidian'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import Input from '../../obsidian/Input.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import IconPicker from '../../obsidian/IconPicker.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScriptService } from '@/scripting/ScriptService'
import { pickScript } from '@/helpers/suggesters/RunnablePicker'
import { readerSettingsFrom } from '@/reader/settings'
import {
  SELECTION_SCRIPT_ICON,
  selectionMenu,
  selectionMenuScriptsFrom,
  movedSelectionScript,
  withSelectionScript,
  withoutSelectionScript,
  type SelectionMenuScript,
  type SelectionMenuSurface,
} from '@/scripting/selectionMenuScripts'

const props = defineProps<{ surface: SelectionMenuSurface }>()
const config = AbeleConfig.getInstance()
const service = ScriptService.getInstance()
const scripts = service.scriptList
const header = computed(() => (props.surface === 'book' ? '@book' : '@chat-selection'))
const stored = () =>
  props.surface === 'book'
    ? readerSettingsFrom(config.reader).selectionScripts
    : selectionMenuScriptsFrom(config.ai.chatSelectionScripts)
const chosen = computed(() => {
  void config.version.value
  return stored()
})
const headed = computed(() => {
  const names = new Set(
    selectionMenu(scripts.value, chosen.value, props.surface)
      .filter((i) => i.by === 'header')
      .map((i) => i.script)
  )
  return [...names].map((name) => scripts.value.find((s) => s.meta.name === name)!)
})
const exists = (name: string) => scripts.value.some((s) => s.meta.name === name)
const isHeaded = (name: string) =>
  selectionMenu(scripts.value, [], props.surface).some((i) => i.script === name)
const iconOf = (name: string) =>
  scripts.value.find((s) => s.meta.name === name)?.meta.icon || SELECTION_SCRIPT_ICON
const pickingIconFor = ref<number | null>(null)
const pendingRemoval = ref<string | null>(null)

const update = (selectionScripts: SelectionMenuScript[]) => {
  config.editSettings(() => {
    if (props.surface === 'book')
      config.reader = { ...readerSettingsFrom(config.reader), selectionScripts }
    else config.ai = { ...config.ai, chatSelectionScripts: selectionScripts }
  })
  config.version.value++
}
const save = async (list: SelectionMenuScript[]) => {
  update(list)
  await config.saveSettings()
}
const add = (name: string) => save(withSelectionScript(stored(), name))
const addScript = async () => {
  const listed = new Set(stored().map((c) => c.script))
  const script = await pickScript(
    GlobalStore.getInstance().app,
    service.getAll().filter((s) => !listed.has(s.meta.name))
  )
  if (script) await add(script.meta.name)
}
const saveSoon = debounce(() => void config.saveSettings(), 500, true)
const rename = (idx: number, name: string) => {
  update(stored().map((c, i) => (i === idx ? { ...c, name } : c)))
  saveSoon()
}
const chooseIcon = (icon: string) => {
  const idx = pickingIconFor.value
  pickingIconFor.value = null
  if (idx !== null) void save(stored().map((c, i) => (i === idx ? { ...c, icon } : c)))
}
const move = (idx: number, by: -1 | 1) => void save(movedSelectionScript(stored(), idx, by))
const remove = (name: string) => {
  pendingRemoval.value = null
  void save(withoutSelectionScript(stored(), name))
}
</script>

<style lang="scss">
.abele-selection-scripts-settings__add {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-top: var(--size-4-3);
}
</style>
