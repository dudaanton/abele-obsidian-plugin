<template>
  <Section
    :title="t('settings.scripts.SelectionScriptsSettings.scripts_on_selected_words.1698fbec')"
    :desc="
      surface === 'book'
        ? t('settings.scripts.SelectionScriptsSettings.scripts_pinned_to_the_book.f58bed5f')
        : t('settings.scripts.SelectionScriptsSettings.scripts_chosen_for_the_chat.db9d7d44')
    "
    class="abele-selection-scripts-settings"
    :class="{ 'abele-book-scripts-settings': surface === 'book' }"
    :data-surface="surface"
  >
    <EmptyState
      v-if="!scripts.length"
      :text="t('settings.scripts.SelectionScriptsSettings.there_are_no_scripts_yet.3ac66fc7')"
    />
    <EmptyState
      v-else-if="!chosen.length && !headed.length"
      :text="t('settings.scripts.SelectionScriptsSettings.nothing_on_the_menu_yet.e30d6c11')"
    />
    <Setting
      v-for="(entry, idx) in chosen"
      :key="entry.script"
      :name="entry.name.trim() || entry.script"
      :desc="
        exists(entry.script)
          ? t('settings.scripts.SelectionScriptsSettings.script_value.804f5354', {
              value0: String(entry.script),
            })
          : t('settings.scripts.SelectionScriptsSettings.script_value_not_found.48b085e0', {
              value0: String(entry.script),
            })
      "
      class="abele-selection-scripts-settings__entry"
      :class="{ 'abele-book-scripts-settings__entry': surface === 'book' }"
      :data-script="entry.script"
    >
      <Input
        :model-value="entry.name"
        :placeholder="t('settings.scripts.SelectionScriptsSettings.name_on_the_bar.6c09f682')"
        @update:model-value="rename(idx, $event)"
      />
      <Icon
        :icon="entry.icon || iconOf(entry.script)"
        :tooltip="t('settings.scripts.SelectionScriptsSettings.choose_the_icon_it_has.ebff10d4')"
        @click="pickingIconFor = idx"
      />
      <Icon
        icon="arrow-up"
        :disabled="idx === 0"
        :tooltip="
          idx === 0
            ? t('settings.scripts.SelectionScriptsSettings.already_the_first.eab62d41')
            : t('settings.scripts.SelectionScriptsSettings.move_it_up_the_menu.20938d10')
        "
        @click="move(idx, -1)"
      />
      <Icon
        icon="arrow-down"
        :disabled="idx === chosen.length - 1"
        :tooltip="
          idx === chosen.length - 1
            ? t('settings.scripts.SelectionScriptsSettings.already_the_last.a6ec4b12')
            : t('settings.scripts.SelectionScriptsSettings.move_it_down_the_menu.dc508335')
        "
        @click="move(idx, 1)"
      />
      <Icon
        icon="trash"
        :tooltip="t('settings.scripts.SelectionScriptsSettings.take_it_off_the_menu.c979b889')"
        @click="pendingRemoval = entry.script"
      />
    </Setting>
    <Setting
      v-for="s in headed"
      :key="s.meta.name"
      :name="s.meta.name"
      :desc="
        t('settings.scripts.SelectionScriptsSettings.on_the_menu_by_its.9695bd79', {
          value0: String(header),
        })
      "
      class="abele-selection-scripts-settings__headed"
      :class="{ 'abele-book-scripts-settings__headed': surface === 'book' }"
      :data-script="s.meta.name"
    >
      <Button
        :text="t('settings.scripts.SelectionScriptsSettings.add_to_the_list.6b62dd0b')"
        :tooltip="
          t('settings.scripts.SelectionScriptsSettings.put_value_in_the_list.ab3d4711', {
            value0: String(s.meta.name),
          })
        "
        @click="add(s.meta.name)"
      />
    </Setting>
    <div v-if="scripts.length" class="abele-selection-scripts-settings__add">
      <Button
        :text="t('settings.scripts.SelectionScriptsSettings.add_a_script.c4526bc4')"
        :tooltip="
          t('settings.scripts.SelectionScriptsSettings.search_your_scripts_for_one.702cfb4f')
        "
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
      :title="t('settings.scripts.SelectionScriptsSettings.take_off_the_menu.c4b604ec')"
      :message="
        t('settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.66090b83', {
          value0: String(pendingRemoval),
          value1: String(surface === 'book' ? t('settings.terms.book') : t('settings.terms.chat')),
          value2: String(
            isHeaded(pendingRemoval)
              ? t('settings.parts.951aaf14e2b23dff', { value0: String(header) })
              : ''
          ),
        })
      "
      :confirm-text="t('settings.scripts.SelectionScriptsSettings.take_off.c2ed15e8')"
      :confirm-tooltip="
        t('settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.83b6400c', {
          value0: String(pendingRemoval),
        })
      "
      @confirm="remove(pendingRemoval)"
      @close="pendingRemoval = null"
    />
  </Section>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
