<template>
  <Section
    title="Startup"
    desc="Scripts run each time Obsidian starts, one after another in this order, once the vault is open. A script that takes parameters gets its defaults; one that needs a value with no default is skipped. Put a script here with the power button on its card in the library."
    class="abele-startup-scripts"
  >
    <Setting
      name="Don't run startup scripts"
      desc="Skips all of them until switched back. If a startup script freezes Obsidian, it is also skipped by itself the next time Obsidian starts."
    >
      <Checkbox :is-enabled="paused" @toggle="togglePaused" />
    </Setting>

    <EmptyState
      v-if="!scripts.length"
      text="There are no scripts yet: add one to the scripts folder first."
    />
    <EmptyState v-else-if="!chosen.length && !headed.length" text="No startup scripts yet." />
    <Setting
      v-for="(entry, idx) in chosen"
      :key="entry.script"
      :name="entry.script"
      :desc="exists(entry.script) ? '' : 'Not found in the scripts folder'"
      class="abele-startup-scripts__entry"
      :data-script="entry.script"
    >
      <Dropdown
        :options="DEVICE_OPTIONS"
        :model-value="entry.devices"
        @update:model-value="setDevices(entry.script, $event)"
      />
      <Icon
        icon="arrow-up"
        :disabled="idx === 0"
        :tooltip="idx === 0 ? 'Already the first' : 'Run it earlier'"
        @click="move(idx, -1)"
      />
      <Icon
        icon="arrow-down"
        :disabled="idx === chosen.length - 1"
        :tooltip="idx === chosen.length - 1 ? 'Already the last' : 'Run it later'"
        @click="move(idx, 1)"
      />
      <Icon icon="trash" tooltip="Stop running it at startup" @click="remove(entry.script)" />
    </Setting>
    <Setting
      v-for="s in headed"
      :key="s.meta.name"
      :name="s.meta.name"
      :desc="`Runs at startup by its own header (@startup), after the ones above, on ${DEVICE_WORDS[s.meta.startup ?? 'both']}. Add it to the list to give it a place.`"
      class="abele-startup-scripts__headed"
      :data-script="s.meta.name"
    >
      <Button
        text="Add to the list"
        :tooltip="`Put ${s.meta.name} in the list above, to move it or choose its devices`"
        @click="add(s.meta.name, s.meta.startup)"
      />
    </Setting>
    <div v-if="scripts.length" class="abele-startup-scripts__add">
      <Button
        text="Add a script"
        tooltip="Search your scripts for one to run at startup"
        @click="addScript"
      />
    </div>
  </Section>
</template>

<script setup lang="ts">
/**
 * The startup scripts: which run when Obsidian starts, in what order and on which devices, with
 * those put there by their own header listed after them — and the switch that skips them all.
 * Kept under `ai.startupScripts` and `ai.startupScriptsPaused`, so it travels with the script
 * settings.
 */
import { computed } from 'vue'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScriptService } from '@/scripting/ScriptService'
import { pickScript } from '@/helpers/suggesters/RunnablePicker'
import {
  movedStartupScript,
  startupDevicesFrom,
  startupScriptsFrom,
  withStartupDevices,
  withStartupScript,
  withoutStartupScript,
} from '@/scripting/startupScripts'
import type { StartupDevices, StartupScript } from '@/scripting/types'

const DEVICE_OPTIONS = [
  { value: 'both', display: 'Every device' },
  { value: 'desktop', display: 'Computers' },
  { value: 'mobile', display: 'Phones and tablets' },
]

const DEVICE_WORDS: Record<StartupDevices, string> = {
  both: 'every device',
  desktop: 'computers',
  mobile: 'phones and tablets',
}

const config = AbeleConfig.getInstance()
const scripts = ScriptService.getInstance().scriptList

const stored = () => startupScriptsFrom(config.ai.startupScripts)

const chosen = computed(() => {
  void config.version.value
  return stored()
})

const paused = computed(() => {
  void config.version.value
  return !!config.ai.startupScriptsPaused
})

/** Scripts run at startup by their header alone, by name. */
const headed = computed(() => {
  const listed = new Set(chosen.value.map((c) => c.script))
  return scripts.value
    .filter((s) => s.meta.startup && !listed.has(s.meta.name))
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name))
})

const exists = (name: string) => scripts.value.some((s) => s.meta.name === name)

const save = async (startupScripts: StartupScript[]) => {
  config.ai = { ...config.ai, startupScripts }
  await config.saveSettings()
}

const add = (name: string, devices?: StartupDevices) =>
  save(withStartupScript(stored(), name, devices ?? 'both'))

const addScript = async () => {
  const listed = new Set(stored().map((c) => c.script))
  const app = GlobalStore.getInstance().app
  const script = await pickScript(
    app,
    ScriptService.getInstance()
      .getAll()
      .filter((s) => !listed.has(s.meta.name))
  )
  if (script) await add(script.meta.name, script.meta.startup)
}

const setDevices = (name: string, value: string) =>
  void save(withStartupDevices(stored(), name, startupDevicesFrom(value)))

const move = (idx: number, by: -1 | 1) => void save(movedStartupScript(stored(), idx, by))

const remove = (name: string) => void save(withoutStartupScript(stored(), name))

const togglePaused = () => {
  config.ai = { ...config.ai, startupScriptsPaused: !config.ai.startupScriptsPaused }
  void config.saveSettings()
}
</script>

<style lang="scss">
.abele-startup-scripts__add {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-top: var(--size-4-3);
}
</style>
