<template>
  <div class="abele-settings__links">
    <Section
      :title="t('settings.LinksSettings.links_that_run_things.6849bb37')"
      :desc="t('settings.LinksSettings.each_one_is_an_obsidian.bcfd9260')"
    >
      <!-- One row per link: its name and what it runs, the address to copy, and the rest in a
           window of its own. -->
      <Setting v-for="(link, idx) in links" :key="link.id" class="abele-links__row">
        <template #name>{{
          link.name || t('settings.LinksSettings.untitled_link.be1c93df')
        }}</template>
        <template #desc>{{ runsText(link) }}</template>
        <Icon
          icon="copy"
          :tooltip="t('settings.LinksSettings.copy_the_link_s_address.331a3bd9')"
          @click="copyUrl(link)"
        />
        <Icon
          icon="settings"
          :tooltip="t('settings.LinksSettings.change_this_link.f6aa89bf')"
          @click="editing = idx"
        />
      </Setting>
      <Setting
        :name="
          links.length
            ? t('settings.LinksSettings.add_another_link.a8b73866')
            : t('settings.LinksSettings.no_links_yet.30d3e862')
        "
        :desc="t('settings.LinksSettings.a_name_for_the_address.f36bdc5a')"
      >
        <Button
          :text="t('settings.LinksSettings.add_link.dfe9ca4d')"
          :tooltip="t('settings.LinksSettings.add_a_link_and_set.5eb68448')"
          @click="addAndEdit"
        />
      </Setting>
    </Section>

    <ObsidianModal
      v-if="editing !== null && links[editing]"
      :title="links[editing].name || t('settings.LinksSettings.new_link.98ee0dfb')"
      @close="editing = null"
    >
      <Setting
        :name="t('settings.LinksSettings.name.dcd1d522')"
        :desc="t('settings.LinksSettings.the_part_of_the_address.2929fc21')"
      >
        <Input
          :model-value="links[editing].name"
          :placeholder="t('settings.LinksSettings.add_movie.2f79eca6')"
          @update:model-value="updateField(editing, 'name', $event)"
        />
      </Setting>
      <Setting :name="t('settings.LinksSettings.runs.848f54e8')">
        <Dropdown
          :model-value="links[editing].type"
          :options="typeOptions"
          @update:model-value="updateField(editing, 'type', $event)"
        />
      </Setting>
      <Setting
        v-if="links[editing].type === 'script'"
        :name="t('settings.LinksSettings.script.102acc10')"
      >
        <Button
          :text="links[editing].scriptName || t('settings.LinksSettings.choose_a_script.d8ff6dd0')"
          :tooltip="t('settings.LinksSettings.search_the_scripts_for_the.e5119ad8')"
          @click="chooseScript(editing)"
        />
      </Setting>
      <Setting
        v-if="links[editing].type === 'command'"
        :name="t('settings.LinksSettings.command.71316697')"
      >
        <Button
          :text="commandLabel(links[editing].commandId)"
          :tooltip="t('settings.LinksSettings.search_the_commands_for_the.ebe2fa5b')"
          @click="chooseCommand(editing)"
        />
      </Setting>
      <Setting
        :name="t('settings.LinksSettings.wait_for_sync.8d3efbd1')"
        :desc="t('settings.LinksSettings.run_only_once_obsidian_sync.91ba259b')"
      >
        <Checkbox :is-enabled="links[editing].waitForSync" @toggle="toggleWaitForSync(editing)" />
      </Setting>
      <Setting
        :name="t('settings.LinksSettings.address.56ef8f20')"
        :desc="t('settings.LinksSettings.add_param_value_to_hand.2c89675e')"
      >
        <code class="abele-links__url">{{ buildUrl(links[editing]) }}</code>
        <Icon
          icon="copy"
          :tooltip="t('settings.LinksSettings.copy_the_link_s_address.331a3bd9')"
          @click="copyUrl(links[editing])"
        />
      </Setting>
      <template #footer>
        <div class="abele-modal__actions">
          <Button
            :text="t('settings.LinksSettings.delete.e2d0a549')"
            warning
            :tooltip="t('settings.LinksSettings.remove_this_link.d7173cb1')"
            class="abele-links__delete"
            @click="removeEditing"
          />
          <Button
            :text="t('settings.LinksSettings.done.11a6767d')"
            accent
            :tooltip="t('settings.LinksSettings.close_this_window_changes_are.91342d87')"
            @click="editing = null"
          />
        </div>
      </template>
    </ObsidianModal>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
  { value: 'script', display: t('settings.LinksSettings.script.102acc10') },
  { value: 'command', display: t('settings.LinksSettings.command.71316697') },
]

/** A link stores a command's id; what a person recognises is its name. */
const commandLabel = (id: string): string => {
  if (!id) return t('settings.LinksSettings.choose_a_command.58e501e1')
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
      ? t('settings.LinksSettings.runs_the_script_value.c5e5c031', {
          value0: String(link.scriptName),
        })
      : t('settings.LinksSettings.runs_a_script_none_chosen.1b6f1723')
    : link.commandId
      ? t('settings.LinksSettings.runs_the_command_value.c397fa11', {
          value0: String(commandLabel(link.commandId)),
        })
      : t('settings.LinksSettings.runs_a_command_none_chosen.67edb64d')

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
  new Notice(t('settings.LinksSettings.link_copied.d12860c2'))
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
