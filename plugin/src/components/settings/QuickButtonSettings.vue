<template>
  <div class="abele-quick-button-settings">
    <Section>
      <template #desc>
        A round button at the edge of the screen on a phone. It opens a menu of quick actions for
        whatever is in front: your own actions below, a note's header buttons, and what the plugin
        offers there — a book's search and highlights, a note's timer and chat. It gets out of the
        way while you read or type. Drag it to move it; it keeps the side and height it is left at.
      </template>
      <Setting
        name="Show the quick button"
        desc="On a phone. It is a concept, so it starts switched off."
      >
        <Checkbox :is-enabled="current.enabled" @toggle="update({ enabled: !current.enabled })" />
      </Setting>
      <Setting name="Also on a tablet" desc="Show it on a tablet as well as on a phone.">
        <Checkbox :is-enabled="current.tablet" @toggle="update({ tablet: !current.tablet })" />
      </Setting>
      <Setting
        name="Side"
        desc="The edge of the screen it stands at. Dragging it across changes it."
      >
        <Dropdown
          :model-value="current.side"
          :options="sideOptions"
          @update:model-value="update({ side: $event === 'left' ? 'left' : 'right' })"
        />
      </Setting>
      <Setting
        name="Height"
        :desc="
          current.lift
            ? 'Dragged higher than where it rests, above the bottom bar of each screen.'
            : 'Where it rests: just above the bottom bar of each screen.'
        "
      >
        <Button
          text="Put it back"
          :disabled="!current.lift"
          :tooltip="
            current.lift
              ? 'Move it back down to where it rests'
              : 'It is already where it rests; drag it to raise it'
          "
          @click="update({ lift: 0 })"
        />
      </Setting>
    </Section>

    <Section
      title="Your actions"
      desc="At the top of the menu, in this order. A command appears only where it can run, so one meant for notes is not offered over a book."
    >
      <EmptyState v-if="!current.actions.length" text="Nothing of your own yet." />
      <Setting
        v-for="(action, idx) in current.actions"
        :key="action.id"
        :name="titleOf(action)"
        :desc="describe(action)"
      >
        <Input
          :model-value="action.name"
          placeholder="Name in the menu"
          @update:model-value="rename(idx, $event)"
        />
        <Icon
          :icon="action.icon || defaultIcon(action)"
          tooltip="Choose the icon it has in the menu"
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
          :disabled="idx === current.actions.length - 1"
          :tooltip="
            idx === current.actions.length - 1 ? 'Already the last' : 'Move it down the menu'
          "
          @click="move(idx, 1)"
        />
        <Icon icon="trash" tooltip="Take it out of the menu" @click="pendingRemoval = action" />
      </Setting>
      <div class="abele-quick-button-settings__add">
        <Button
          text="Add a command"
          tooltip="Search Obsidian's commands — any plugin's — for one to put in the menu"
          @click="addCommand"
        />
        <Button
          text="Add a script"
          tooltip="Search your scripts for one to put in the menu"
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
      title="Take out of the menu"
      :message="`Take ${titleOf(pendingRemoval)} out of the quick menu? The command or script itself stays.`"
      confirm-text="Take out"
      :confirm-tooltip="`Take ${titleOf(pendingRemoval)} out of the menu`"
      @confirm="remove(pendingRemoval.id)"
      @close="pendingRemoval = null"
    />
  </div>
</template>

<script setup lang="ts">
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
  { value: 'right', display: 'Right' },
  { value: 'left', display: 'Left' },
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
  'Unnamed'

const describe = (action: QuickAction): string =>
  action.type === 'command'
    ? `Command: ${commandName(action.commandId)}`
    : `Script: ${action.scriptName}`

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
  await setActions([
    ...stored().actions,
    { ...blank(), type: 'command', commandId: command.id },
  ])
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
