<template>
  <Section
    :title="t('settings.scripts.StartupScriptsEditor.startup.65d48235')"
    :desc="t('settings.scripts.StartupScriptsEditor.scripts_run_each_time_obsidian.149c2450')"
    class="abele-startup-scripts"
  >
    <Setting
      :name="t('settings.scripts.StartupScriptsEditor.don_t_run_startup_scripts.a287f1aa')"
      :desc="t('settings.scripts.StartupScriptsEditor.skips_all_of_them_until.bf97689c')"
    >
      <Checkbox :is-enabled="paused" @toggle="togglePaused" />
    </Setting>

    <EmptyState
      v-if="!scripts.length"
      :text="t('settings.scripts.StartupScriptsEditor.there_are_no_scripts_yet.3ac66fc7')"
    />
    <EmptyState
      v-else-if="!chosen.length && !headed.length"
      :text="t('settings.scripts.StartupScriptsEditor.no_startup_scripts_yet.30a2445c')"
    />
    <Setting
      v-for="(entry, idx) in chosen"
      :key="entry.script"
      :name="entry.script"
      :desc="
        exists(entry.script)
          ? ''
          : t('settings.scripts.StartupScriptsEditor.not_found_in_the_scripts.e5cfdc39')
      "
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
        :tooltip="
          idx === 0
            ? t('settings.scripts.StartupScriptsEditor.already_the_first.eab62d41')
            : t('settings.scripts.StartupScriptsEditor.run_it_earlier.01c77f4e')
        "
        @click="move(idx, -1)"
      />
      <Icon
        icon="arrow-down"
        :disabled="idx === chosen.length - 1"
        :tooltip="
          idx === chosen.length - 1
            ? t('settings.scripts.StartupScriptsEditor.already_the_last.a6ec4b12')
            : t('settings.scripts.StartupScriptsEditor.run_it_later.f2761f7f')
        "
        @click="move(idx, 1)"
      />
      <Icon
        icon="trash"
        :tooltip="t('settings.scripts.StartupScriptsEditor.stop_running_it_at_startup.7b061cf3')"
        @click="remove(entry.script)"
      />
    </Setting>
    <Setting
      v-for="s in headed"
      :key="s.meta.name"
      :name="s.meta.name"
      :desc="
        t('settings.scripts.StartupScriptsEditor.runs_at_startup_by_its.2407579f', {
          value0: String(DEVICE_WORDS[s.meta.startup ?? 'both']),
        })
      "
      class="abele-startup-scripts__headed"
      :data-script="s.meta.name"
    >
      <Button
        :text="t('settings.scripts.StartupScriptsEditor.add_to_the_list.6b62dd0b')"
        :tooltip="
          t('settings.scripts.StartupScriptsEditor.put_value_in_the_list.f0c37c74', {
            value0: String(s.meta.name),
          })
        "
        @click="add(s.meta.name, s.meta.startup)"
      />
    </Setting>
    <div v-if="scripts.length" class="abele-startup-scripts__add">
      <Button
        :text="t('settings.scripts.StartupScriptsEditor.add_a_script.c4526bc4')"
        :tooltip="t('settings.scripts.StartupScriptsEditor.search_your_scripts_for_one.d53e42be')"
        @click="addScript"
      />
    </div>
  </Section>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
  { value: 'both', display: t('settings.scripts.StartupScriptsEditor.every_device.9b626893') },
  { value: 'desktop', display: t('settings.scripts.StartupScriptsEditor.computers.680cb3c6') },
  {
    value: 'mobile',
    display: t('settings.scripts.StartupScriptsEditor.phones_and_tablets.578553d2'),
  },
]

const DEVICE_WORDS: Record<StartupDevices, string> = {
  both: t('settings.scripts.StartupScriptsEditor.every_device.17779e2b'),
  desktop: t('settings.startup.computers'),
  mobile: t('settings.scripts.StartupScriptsEditor.phones_and_tablets.a522653d'),
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
