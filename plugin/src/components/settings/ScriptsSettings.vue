<template>
  <div class="abele-settings__scripts">
    <Setting
      name="Enable scripts"
      desc="Allow JavaScript scripts stored in a vault folder to be registered as commands and AI tools."
    >
      <Checkbox :is-enabled="scriptsEnabled" @toggle="toggleScriptsEnabled" />
    </Setting>

    <template v-if="scriptsEnabled">
      <Setting name="Scripts folder" desc="Vault folder containing .js script files.">
        <Search
          :model-value="scriptsFolder"
          :suggester="FolderSuggest"
          placeholder="e.g. System/Scripts"
          @update:model-value="updateScriptsFolder"
        />
      </Setting>

      <p v-if="discoveredScripts.length" class="setting-item-description">
        {{ discoveredScripts.length }} scripts discovered. Configure tool modes in
        <strong>AI Agent → Default Tool Modes</strong> or per-chat in the permissions modal.
      </p>

      <Section title="Header buttons">
        <template #desc>
          Put a button in the header of every note of a given type, running a script. Parameters
          accept <code>{{ variableExamples }}</code> and any frontmatter field of the note, such as
          <code>{{ frontmatterExample }}</code
          >.
        </template>

        <div v-if="buttons.length" class="abele-header-buttons__list">
          <div v-for="(button, idx) in buttons" :key="button.id" class="abele-header-buttons__item">
            <div class="abele-header-buttons__fields">
              <Setting name="Name" desc="Shown on the button.">
                <Input
                  :model-value="button.name"
                  placeholder="e.g. Fetch details"
                  @update:model-value="updateField(idx, 'name', $event)"
                />
              </Setting>
              <Setting name="Icon" desc="A lucide icon name, as used elsewhere in the header.">
                <Input
                  :model-value="button.icon"
                  placeholder="play"
                  @update:model-value="updateField(idx, 'icon', $event)"
                />
              </Setting>
              <Setting
                name="Note types"
                desc="Comma-separated. The button appears on notes whose type frontmatter is one of these."
              >
                <Input
                  :model-value="button.noteTypes.join(', ')"
                  placeholder="e.g. movie, book"
                  @update:model-value="updateTypes(idx, $event)"
                />
              </Setting>
              <Setting name="Script" desc="Script the button runs.">
                <Dropdown
                  :model-value="button.scriptName"
                  :options="scriptOptions"
                  @update:model-value="updateField(idx, 'scriptName', $event)"
                />
              </Setting>

              <template v-for="param in paramsOf(button)" :key="param.name">
                <Setting :name="param.name" :desc="paramDescription(param)">
                  <Input
                    :model-value="button.params[param.name] || ''"
                    :placeholder="param.default || ''"
                    @update:model-value="updateParam(idx, param.name, $event)"
                  />
                </Setting>
              </template>
              <p
                v-if="button.scriptName && !paramsOf(button).length"
                class="setting-item-description"
              >
                This script takes no parameters.
              </p>
            </div>
            <Icon icon="trash" tooltip="Remove this button" @click="removeButton(idx)" />
          </div>
        </div>

        <div v-else class="abele-header-buttons__empty">No header buttons configured.</div>

        <Button text="Add button" tooltip="Add another header button" @click="addButton" />
      </Section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { debounce } from 'obsidian'
import { nanoid } from 'nanoid'
import Setting from '../obsidian/Setting.vue'
import Section from '../obsidian/Section.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Search from '../obsidian/Search.vue'
import Input from '../obsidian/Input.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { AbeleConfig, type HeaderButtonDefinition } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { findScriptByName } from '@/scripting/runScript'
import type { ScriptParam } from '@/scripting/types'

const config = AbeleConfig.getInstance()

const scriptsEnabled = ref(config.ai.scriptsEnabled ?? false)
const scriptsFolder = ref(config.ai.scriptsFolder ?? '')

const discoveredScripts = computed(() => {
  if (!scriptsEnabled.value) return []
  return ScriptService.getInstance()
    .getAll()
    .filter((s) => s.meta.enabled !== false)
})

const save = debounce(async () => {
  config.ai.scriptsEnabled = scriptsEnabled.value
  config.ai.scriptsFolder = scriptsFolder.value
  await config.saveSettings()
}, 500)

const toggleScriptsEnabled = () => {
  scriptsEnabled.value = !scriptsEnabled.value
  if (scriptsEnabled.value && scriptsFolder.value) {
    ScriptService.getInstance().init()
  } else if (!scriptsEnabled.value) {
    ScriptService.destroy()
  }
  save()
}

const updateScriptsFolder = (value: string) => {
  scriptsFolder.value = value
  save()
}

// ── Header buttons ──

/**
 * Written here rather than in the template above: a `{{ ... }}` inside a template is an
 * interpolation, so the braces these are made of cannot be typed there directly.
 */
const variableExamples = ['title', 'path', 'folder', 'date:YYYY-MM-DD']
  .map((name) => `{{${name}}}`)
  .join(', ')
const frontmatterExample = '{{status}}'

const buttons = ref<HeaderButtonDefinition[]>(
  JSON.parse(JSON.stringify(config.headerButtons || []))
)

const scriptOptions = computed(() => [
  { value: '', display: '(select script)' },
  ...discoveredScripts.value.map((s) => ({ value: s.meta.name, display: s.meta.name })),
])

/**
 * The parameters the chosen script declares. The form is built from these rather than from
 * free-form key/value rows, so a button cannot be configured with a parameter its script has
 * never heard of.
 */
const paramsOf = (button: HeaderButtonDefinition): ScriptParam[] =>
  button.scriptName ? (findScriptByName(button.scriptName)?.meta.params ?? []) : []

const paramDescription = (param: ScriptParam): string => {
  const described = param.description || 'No description.'
  return param.default ? `${described} Defaults to "${param.default}".` : described
}

const saveButtons = debounce(async () => {
  config.headerButtons = JSON.parse(JSON.stringify(buttons.value))
  await config.saveSettings()
}, 500)

const addButton = () => {
  buttons.value.push({
    id: nanoid(8),
    name: '',
    icon: 'play',
    noteTypes: [],
    scriptName: '',
    params: {},
  })
  saveButtons()
}

const removeButton = (idx: number) => {
  buttons.value.splice(idx, 1)
  saveButtons()
}

const updateField = (idx: number, field: 'name' | 'icon' | 'scriptName', value: string) => {
  buttons.value[idx][field] = value
  // A button's parameters belong to the script it runs; carrying them to another script would
  // leave values under names the new one does not declare.
  if (field === 'scriptName') buttons.value[idx].params = {}
  saveButtons()
}

const updateTypes = (idx: number, value: string) => {
  buttons.value[idx].noteTypes = value
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean)
  saveButtons()
}

const updateParam = (idx: number, name: string, value: string) => {
  buttons.value[idx].params = { ...buttons.value[idx].params, [name]: value }
  saveButtons()
}
</script>

<style lang="scss">
.abele-header-buttons__list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);
  margin-bottom: var(--size-4-3);
}

.abele-header-buttons__item {
  display: flex;
  gap: var(--size-4-2);
  padding: var(--size-4-3);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);

  > .abele-header-buttons__fields {
    flex: 1;
    min-width: 0;
  }
}

.abele-header-buttons__empty {
  color: var(--text-muted);
  margin-bottom: var(--size-4-3);
}
</style>
