<template>
  <div class="abele-settings__links">
    <Section
      title="Links that run things"
      desc="Each one is an obsidian:// address that runs a script or a command when it is opened — from a bookmark, another app or a shortcut."
    >
      <!-- One row per link: its name and what it runs, the address to copy, and the rest in a
           window of its own. -->
      <Setting v-for="(link, idx) in links" :key="link.id" class="abele-links__row">
        <template #name>{{ link.name || 'Untitled link' }}</template>
        <template #desc>{{ runsText(link) }}</template>
        <Icon icon="copy" tooltip="Copy the link's address" @click="copyUrl(link)" />
        <Icon icon="settings" tooltip="Change this link" @click="editing = idx" />
      </Setting>
      <Setting
        :name="links.length ? 'Add another link' : 'No links yet'"
        desc="A name for the address, and the script or command it runs."
      >
        <Button text="Add link" tooltip="Add a link and set it up" @click="addAndEdit" />
      </Setting>
    </Section>

    <ObsidianModal
      v-if="editing !== null && links[editing]"
      :title="links[editing].name || 'New link'"
      @close="editing = null"
    >
      <Setting name="Name" desc="The part of the address after name=, in plain letters and dashes.">
        <Input
          :model-value="links[editing].name"
          placeholder="add-movie"
          @update:model-value="updateField(editing, 'name', $event)"
        />
      </Setting>
      <Setting name="Runs">
        <Dropdown
          :model-value="links[editing].type"
          :options="typeOptions"
          @update:model-value="updateField(editing, 'type', $event)"
        />
      </Setting>
      <Setting v-if="links[editing].type === 'script'" name="Script">
        <Button
          :text="links[editing].scriptName || 'Choose a script…'"
          tooltip="Search the scripts for the one this link runs"
          @click="chooseScript(editing)"
        />
      </Setting>
      <Setting v-if="links[editing].type === 'command'" name="Command">
        <Button
          :text="commandLabel(links[editing].commandId)"
          tooltip="Search the commands for the one this link runs"
          @click="chooseCommand(editing)"
        />
      </Setting>
      <Setting name="Wait for sync" desc="Run only once Obsidian Sync has brought the vault up to date.">
        <Checkbox :is-enabled="links[editing].waitForSync" @toggle="toggleWaitForSync(editing)" />
      </Setting>
      <Setting name="Address" desc="Add &param=value to hand the script its values.">
        <code class="abele-links__url">{{ buildUrl(links[editing]) }}</code>
        <Icon icon="copy" tooltip="Copy the link's address" @click="copyUrl(links[editing])" />
      </Setting>
      <template #footer>
        <div class="abele-modal__actions">
          <Button
            text="Delete"
            warning
            tooltip="Remove this link"
            class="abele-links__delete"
            @click="removeEditing"
          />
          <Button text="Done" accent tooltip="Close this window; changes are kept as you make them" @click="editing = null" />
        </div>
      </template>
    </ObsidianModal>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { debounce, Notice } from 'obsidian'
import { nanoid } from 'nanoid'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Section from '../obsidian/Section.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import { AbeleConfig, type LinkDefinition } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { pickScript, pickCommand, listCommands } from '@/helpers/suggesters/RunnablePicker'
import { GlobalStore } from '@/stores/GlobalStore'

const config = AbeleConfig.getInstance()
const app = GlobalStore.getInstance().app
const vaultName = app.vault.getName()
const links = ref<LinkDefinition[]>(JSON.parse(JSON.stringify(config.links || [])))

const typeOptions = [
  { value: 'script', display: 'Script' },
  { value: 'command', display: 'Command' },
]

/** A link stores a command's id; what a person recognises is its name. */
const commandLabel = (id: string): string => {
  if (!id) return 'Choose a command…'
  return listCommands(app).find((command) => command.id === id)?.name ?? id
}

const chooseScript = async (idx: number) => {
  const script = await pickScript(app, ScriptService.getInstance().getAll())
  if (script) updateField(idx, 'scriptName', script.meta.name)
}

const chooseCommand = async (idx: number) => {
  const command = await pickCommand(app)
  if (command) updateField(idx, 'commandId', command.id)
}

const save = debounce(async () => {
  config.links = JSON.parse(JSON.stringify(links.value))
  await config.saveSettings()
}, 500)

const addLink = () => {
  links.value.push({
    id: nanoid(8),
    name: '',
    type: 'script',
    scriptName: '',
    commandId: '',
    waitForSync: true,
  })
  save()
}

const removeLink = (idx: number) => {
  links.value.splice(idx, 1)
  save()
}

/** The link open in its window, by its place in the list. */
const editing = ref<number | null>(null)

const addAndEdit = () => {
  addLink()
  editing.value = links.value.length - 1
}

const removeEditing = () => {
  if (editing.value === null) return
  removeLink(editing.value)
  editing.value = null
}

/** What a link runs, in words, under its name. */
const runsText = (link: LinkDefinition): string =>
  link.type === 'script'
    ? link.scriptName
      ? `Runs the script ${link.scriptName}`
      : 'Runs a script — none chosen yet'
    : link.commandId
      ? `Runs the command ${commandLabel(link.commandId)}`
      : 'Runs a command — none chosen yet'

const updateField = (idx: number, field: keyof LinkDefinition, value: string) => {
  if (field === 'name') {
    links.value[idx].name = value.replace(/[^a-zA-Z0-9_-]/g, '-')
  } else if (field === 'type') {
    links.value[idx].type = value as 'script' | 'command'
  } else if (field === 'scriptName' || field === 'commandId') {
    links.value[idx][field] = value
  }
  save()
}

const toggleWaitForSync = (idx: number) => {
  links.value[idx].waitForSync = !links.value[idx].waitForSync
  save()
}

const buildUrl = (link: LinkDefinition): string => {
  if (!link.name) return 'obsidian://abele?name=...'
  return `obsidian://abele?vault=${encodeURIComponent(vaultName)}&name=${link.name}`
}

const copyUrl = (link: LinkDefinition) => {
  navigator.clipboard.writeText(buildUrl(link))
  new Notice('Link copied')
}
</script>

<style lang="scss">
// The copy and change glyphs at the end of the row; the row stays one line.
.abele-links__row > .setting-item-control {
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: var(--size-2-2);
}

// The address in full, wrapping where it must, quiet and selectable.
.abele-links__url {
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  overflow-wrap: anywhere;
  user-select: text;
}

.abele-links__delete {
  margin-inline-end: auto;
}
</style>
