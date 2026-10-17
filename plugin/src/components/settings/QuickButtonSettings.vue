<template>
  <div class="abele-quick-button-settings">
    <Section>
      <template #desc>
        {{ t('settings.QuickButtonSettings.a_round_button_at_the.aa095d26') }}
      </template>
      <Setting
        :name="t('settings.QuickButtonSettings.show_the_quick_button.65b455f7')"
        :desc="t('settings.QuickButtonSettings.on_a_phone_it_is.0737337d')"
      >
        <Checkbox :is-enabled="current.enabled" @toggle="update({ enabled: !current.enabled })" />
      </Setting>
      <Setting
        :name="t('settings.QuickButtonSettings.also_on_a_tablet.5f696152')"
        :desc="t('settings.QuickButtonSettings.show_it_on_a_tablet.015eac3d')"
      >
        <Checkbox :is-enabled="current.tablet" @toggle="update({ tablet: !current.tablet })" />
      </Setting>
      <Setting
        :name="t('settings.QuickButtonSettings.side.630ef00b')"
        :desc="t('settings.QuickButtonSettings.the_edge_of_the_screen.20ef4e46')"
      >
        <Dropdown
          :model-value="current.side"
          :options="sideOptions"
          @update:model-value="update({ side: $event === 'left' ? 'left' : 'right' })"
        />
      </Setting>
      <Setting
        :name="t('settings.QuickButtonSettings.height.bfe2eca4')"
        :desc="
          current.lift
            ? t('settings.QuickButtonSettings.dragged_higher_than_where_it.8e838ed1')
            : t('settings.QuickButtonSettings.where_it_rests_just_above.3d9aff94')
        "
      >
        <Button
          :text="t('settings.QuickButtonSettings.put_it_back.55057d7e')"
          :disabled="!current.lift"
          :tooltip="
            current.lift
              ? t('settings.QuickButtonSettings.move_it_back_down_to.4bb8ca2b')
              : t('settings.QuickButtonSettings.it_is_already_where_it.36b74557')
          "
          @click="update({ lift: 0 })"
        />
      </Setting>
    </Section>

    <Section
      :title="t('settings.QuickButtonSettings.your_actions.6c06c355')"
      :desc="t('settings.QuickButtonSettings.at_the_top_of_the.b6848b73')"
    >
      <EmptyState
        v-if="!current.actions.length"
        :text="t('settings.QuickButtonSettings.nothing_of_your_own_yet.3d8c2002')"
      />
      <Setting
        v-for="(action, idx) in current.actions"
        :key="action.id"
        :name="titleOf(action)"
        :desc="describe(action)"
      >
        <Input
          :model-value="action.name"
          :placeholder="t('settings.QuickButtonSettings.name_in_the_menu.feca41eb')"
          @update:model-value="rename(idx, $event)"
        />
        <Icon
          :icon="action.icon || defaultIcon(action)"
          :tooltip="t('settings.QuickButtonSettings.choose_the_icon_it_has.e8357476')"
          @click="pickingIconFor = idx"
        />
        <Icon
          icon="arrow-up"
          :disabled="idx === 0"
          :tooltip="
            idx === 0
              ? t('settings.QuickButtonSettings.already_the_first.eab62d41')
              : t('settings.QuickButtonSettings.move_it_up_the_menu.20938d10')
          "
          @click="move(idx, -1)"
        />
        <Icon
          icon="arrow-down"
          :disabled="idx === current.actions.length - 1"
          :tooltip="
            idx === current.actions.length - 1
              ? t('settings.QuickButtonSettings.already_the_last.a6ec4b12')
              : t('settings.QuickButtonSettings.move_it_down_the_menu.dc508335')
          "
          @click="move(idx, 1)"
        />
        <Icon
          icon="trash"
          :tooltip="t('settings.QuickButtonSettings.take_it_out_of_the.4a64934c')"
          @click="pendingRemoval = action"
        />
      </Setting>
      <div class="abele-quick-button-settings__add">
        <Button
          :text="t('settings.QuickButtonSettings.add_a_command.b907f252')"
          :tooltip="t('settings.QuickButtonSettings.search_obsidian_s_commands_any.4054c0d7')"
          @click="addCommand"
        />
        <Button
          :text="t('settings.QuickButtonSettings.add_a_script.c4526bc4')"
          :tooltip="t('settings.QuickButtonSettings.search_your_scripts_for_one.df40b370')"
          @click="addScript"
        />
      </div>
    </Section>

    <IconPicker
      v-if="pickingIconFor !== null && current.actions[pickingIconFor]"
      :current="current.actions[pickingIconFor].icon"
      @choose="chooseIcon"
      @close="pickingIconFor = null"
    />

    <ConfirmModal
      v-if="pendingRemoval"
      :title="t('settings.QuickButtonSettings.take_out_of_the_menu.756bbe6a')"
      :message="
        t('settings.QuickButtonSettings.take_value_out_of_the.f628c5a3', {
          value0: String(titleOf(pendingRemoval)),
        })
      "
      :confirm-text="t('settings.QuickButtonSettings.take_out.a7fc33e3')"
      :confirm-tooltip="
        t('settings.QuickButtonSettings.take_value_out_of_the.8b01b719', {
          value0: String(titleOf(pendingRemoval)),
        })
      "
      @confirm="remove(pendingRemoval.id)"
      @close="pendingRemoval = null"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import { nanoid } from 'nanoid'
import { debounce } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import Input from '../obsidian/Input.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import IconPicker from '../obsidian/IconPicker.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScriptService } from '@/scripting/ScriptService'
import { listCommands, pickCommand, pickScript } from '@/helpers/suggesters/RunnablePicker'
import { applyQuickButton } from '@/quickButton/mount'
import {
  quickButtonSettingsFrom,
  type QuickAction,
  type QuickButtonSettings,
} from '@/quickButton/settings'

const config = AbeleConfig.getInstance()
const app = GlobalStore.getInstance().app

const current = computed(() => {
  void config.version.value
  return quickButtonSettingsFrom(config.quickButton)
})

const sideOptions = [
  { value: 'right', display: t('settings.QuickButtonSettings.right.883361d5') },
  { value: 'left', display: t('settings.QuickButtonSettings.left.58eb9032') },
]

const pickingIconFor = ref<number | null>(null)
const pendingRemoval = ref<QuickAction | null>(null)

/** What is stored now — a name being typed is there before it is saved. */
const stored = () => quickButtonSettingsFrom(config.quickButton)

const update = async (change: Partial<QuickButtonSettings>) => {
  config.quickButton = quickButtonSettingsFrom({ ...stored(), ...change })
  await config.saveSettings()
  applyQuickButton()
}

const setActions = (actions: QuickAction[]) => update({ actions })

const commandName = (id: string): string =>
  listCommands(app).find((command) => command.id === id)?.name ?? id

const titleOf = (action: QuickAction): string =>
  action.name ||
  (action.type === 'command' ? commandName(action.commandId) : action.scriptName) ||
  t('settings.QuickButtonSettings.unnamed.e504e615')

const describe = (action: QuickAction): string =>
  action.type === 'command'
    ? t('settings.QuickButtonSettings.command_value.b7bcffe4', {
        value0: String(commandName(action.commandId)),
      })
    : t('settings.QuickButtonSettings.script_value.804f5354', { value0: String(action.scriptName) })

const defaultIcon = (action: QuickAction): string =>
  action.type === 'command'
    ? (listCommands(app).find((command) => command.id === action.commandId)?.icon ??
      'terminal-square')
    : 'play'

const blank = (): QuickAction => ({
  id: nanoid(8),
  type: 'command',
  commandId: '',
  scriptName: '',
  name: '',
  icon: '',
})

const addCommand = async () => {
  const command = await pickCommand(app)
  if (!command) return
  await setActions([...stored().actions, { ...blank(), type: 'command', commandId: command.id }])
}

const addScript = async () => {
  const script = await pickScript(app, ScriptService.getInstance().getAll())
  if (!script) return
  await setActions([
    ...stored().actions,
    { ...blank(), type: 'script', scriptName: script.meta.name },
  ])
}

// Typed a letter at a time: kept at once, written to disk once the typing stops.
const saveSoon = debounce(() => void config.saveSettings(), 500, true)
const rename = (idx: number, name: string) => {
  const now = stored()
  config.quickButton = {
    ...now,
    actions: now.actions.map((a, i) => (i === idx ? { ...a, name } : a)),
  }
  saveSoon()
}

const chooseIcon = (icon: string) => {
  const idx = pickingIconFor.value
  pickingIconFor.value = null
  if (idx === null) return
  void setActions(stored().actions.map((a, i) => (i === idx ? { ...a, icon } : a)))
}

const move = (idx: number, by: -1 | 1) => {
  const actions = [...stored().actions]
  const to = idx + by
  if (to < 0 || to >= actions.length) return
  ;[actions[idx], actions[to]] = [actions[to], actions[idx]]
  void setActions(actions)
}

const remove = (id: string) => setActions(stored().actions.filter((a) => a.id !== id))
</script>

<style lang="scss">
.abele-quick-button-settings__add {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-top: var(--size-4-3);
}
</style>
