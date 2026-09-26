<template>
  <Section
    title="Scripts on selected words"
    desc="Offered on the bar that shows when words in a book are selected, in this order. Up to three are a button each; more fold into one button with a menu. Any other script is still there under “Other script…”, where the pin beside a script puts it here too."
    class="abele-book-scripts-settings"
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
      class="abele-book-scripts-settings__entry"
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
      desc="On the menu by its own header (@book), after the ones above. Add it to the list to rename it or give it a place."
      class="abele-book-scripts-settings__headed"
      :data-script="s.meta.name"
    >
      <Button
        text="Add to the list"
        :tooltip="`Put ${s.meta.name} in the list above, to rename it or move it`"
        @click="add(s.meta.name)"
      />
    </Setting>
    <div v-if="scripts.length" class="abele-book-scripts-settings__add">
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
      :message="`Take ${pendingRemoval} off the menu for words in a book? The script itself stays.`"
      confirm-text="Take off"
      :confirm-tooltip="`Take ${pendingRemoval} off the menu`"
      @confirm="remove(pendingRemoval)"
      @close="pendingRemoval = null"
    />
  </Section>
</template>

<script setup lang="ts">
/**
 * The book menu: the scripts offered on words selected in a book, chosen, ordered, named and
 * drawn here — with those put there by their own header listed after them. Kept under
 * `reader.selectionScripts`, so it travels with the reader's settings.
 */
import { computed, ref } from 'vue'
import { debounce } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import Input from '../obsidian/Input.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import IconPicker from '../obsidian/IconPicker.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScriptService } from '@/scripting/ScriptService'
import { pickScript } from '@/helpers/suggesters/RunnablePicker'
import { readerSettingsFrom } from '@/reader/settings'
import {
  BOOK_SCRIPT_ICON,
  movedBookScript,
  withBookScript,
  withoutBookScript,
  type BookMenuScript,
} from '@/scripting/bookMenuScripts'

const config = AbeleConfig.getInstance()
const scripts = ScriptService.getInstance().scriptList

/** What is stored now — a name being typed is there before it is saved. */
const stored = () => readerSettingsFrom(config.reader).selectionScripts

const chosen = computed(() => {
  void config.version.value
  return stored()
})

/** Scripts on the menu by their header alone, by name. */
const headed = computed(() => {
  const listed = new Set(chosen.value.map((c) => c.script))
  return scripts.value
    .filter((s) => s.meta.book && !listed.has(s.meta.name))
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name))
})

const exists = (name: string) => scripts.value.some((s) => s.meta.name === name)
const iconOf = (name: string) =>
  scripts.value.find((s) => s.meta.name === name)?.meta.icon || BOOK_SCRIPT_ICON

const pickingIconFor = ref<number | null>(null)
const pendingRemoval = ref<string | null>(null)

const save = async (selectionScripts: BookMenuScript[]) => {
  config.reader = { ...readerSettingsFrom(config.reader), selectionScripts }
  await config.saveSettings()
}

const add = (name: string) => save(withBookScript(stored(), name))

const addScript = async () => {
  const listed = new Set(stored().map((c) => c.script))
  const app = GlobalStore.getInstance().app
  const script = await pickScript(
    app,
    ScriptService.getInstance()
      .getAll()
      .filter((s) => !listed.has(s.meta.name))
  )
  if (script) await add(script.meta.name)
}

// Typed a letter at a time: kept at once, written to disk once the typing stops.
const saveSoon = debounce(() => void config.saveSettings(), 500, true)
const rename = (idx: number, name: string) => {
  config.reader = {
    ...readerSettingsFrom(config.reader),
    selectionScripts: stored().map((c, i) => (i === idx ? { ...c, name } : c)),
  }
  saveSoon()
}

const chooseIcon = (icon: string) => {
  const idx = pickingIconFor.value
  pickingIconFor.value = null
  if (idx === null) return
  void save(stored().map((c, i) => (i === idx ? { ...c, icon } : c)))
}

const move = (idx: number, by: -1 | 1) => void save(movedBookScript(stored(), idx, by))

const remove = (name: string) => {
  pendingRemoval.value = null
  void save(withoutBookScript(stored(), name))
}
</script>

<style lang="scss">
.abele-book-scripts-settings__add {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-top: var(--size-4-3);
}
</style>
