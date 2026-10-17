<template>
  <Section :title="t('settings.scripts.HeaderButtonsEditor.header_buttons.1d80ae78')">
    <template #desc>
      <I18nText :text="t('settings.rich.5c124ccc61dc59ea', { slot0: '⟪slot0⟫', slot1: '⟪slot1⟫' })"
        ><template #slot0
          ><code>{{ variableExamples }}</code></template
        ><template #slot1
          ><code>{{ frontmatterExample }}</code></template
        ></I18nText
      ></template
    >

    <!-- One row per button, in the order they stand in the header: its glyph and name, what it
         runs and where in a quiet line (or that it shows nowhere), moved up and down, on or off,
         and the rest in a window of its own. -->
    <Setting
      v-for="(button, idx) in buttons"
      :key="button.id"
      :name="button.name || t('settings.scripts.HeaderButtonsEditor.unnamed_button.06e343d4')"
      class="abele-header-buttons__row"
      :class="{ 'abele-header-buttons__row_off': button.enabled === false }"
    >
      <template #name>
        <span class="abele-header-buttons__name"
          ><Icon :icon="button.icon || 'play'" no-hover class="abele-header-buttons__glyph" />{{
            button.name || t('settings.scripts.HeaderButtonsEditor.unnamed_button.06e343d4')
          }}</span
        >
      </template>
      <template #desc>
        <span
          v-if="button.enabled !== false && problemsOf(button).nowhere"
          class="mod-warning"
          :title="problemsOf(button).nowhere"
          >{{
            t('settings.sentence.4f7ec121b15ac5e4', { value0: String(subtitleOf(button)) })
          }}</span
        >
        <template v-else>{{ subtitleOf(button) }}</template>
      </template>
      <Icon
        icon="arrow-up"
        :disabled="idx === 0"
        :tooltip="
          idx === 0
            ? t('settings.scripts.HeaderButtonsEditor.move_earlier_already_the_first.eafd3275')
            : t('settings.scripts.HeaderButtonsEditor.move_earlier_in_the_header.8dc04f10')
        "
        @click="move(idx, -1)"
      />
      <Icon
        icon="arrow-down"
        :disabled="idx === buttons.length - 1"
        :tooltip="
          idx === buttons.length - 1
            ? t('settings.scripts.HeaderButtonsEditor.move_later_already_the_last.a265fd45')
            : t('settings.scripts.HeaderButtonsEditor.move_later_in_the_header.ab6bf94d')
        "
        @click="move(idx, 1)"
      />
      <Icon
        icon="settings"
        :tooltip="t('settings.scripts.HeaderButtonsEditor.change_this_button.8467d30e')"
        @click="editing = idx"
      />
      <Checkbox
        :is-enabled="button.enabled !== false"
        @toggle="updateFlag(idx, 'enabled', button.enabled === false)"
      />
    </Setting>
    <Setting
      :name="
        buttons.length
          ? t('settings.scripts.HeaderButtonsEditor.add_another_button.1a22c516')
          : t('settings.scripts.HeaderButtonsEditor.no_header_buttons_yet.429fc6f3')
      "
      :desc="t('settings.scripts.HeaderButtonsEditor.a_command_or_a_script.e4b5be3f')"
    >
      <Button
        :text="t('settings.scripts.HeaderButtonsEditor.add_button.c0f290f3')"
        :tooltip="t('settings.scripts.HeaderButtonsEditor.add_a_header_button_and.959ddec8')"
        @click="addAndEdit"
      />
    </Setting>

    <ObsidianModal
      v-if="editing !== null && edited"
      :title="edited.name || t('settings.scripts.HeaderButtonsEditor.new_button.c499cbe3')"
      @close="editing = null"
    >
      <Setting heading :name="t('settings.scripts.HeaderButtonsEditor.what_it_runs.ba619d80')" />
      <Setting
        :name="t('settings.scripts.HeaderButtonsEditor.runs.848f54e8')"
        :desc="t('settings.scripts.HeaderButtonsEditor.a_command_from_anywhere_in.2b8a7412')"
      >
        <Dropdown
          class="abele-header-buttons__runs"
          :options="RUNS_OPTIONS"
          :model-value="runsOf(edited)"
          @update:model-value="updateRuns(editing, $event)"
        />
      </Setting>
      <Setting
        :name="t('settings.scripts.HeaderButtonsEditor.name.dcd1d522')"
        :desc="
          isCommand(edited)
            ? t('settings.scripts.HeaderButtonsEditor.shown_as_the_button_s.a52b2eef')
            : t('settings.scripts.HeaderButtonsEditor.shown_on_the_button_or.18bb181b')
        "
      >
        <Input
          :model-value="edited.name"
          :placeholder="
            t('settings.scripts.HeaderButtonsEditor.e_g_fetch_details.9c250ebd', {
              literal0: String('Fetch details'),
            })
          "
          @update:model-value="updateField(editing, 'name', $event)"
        />
      </Setting>
      <Setting
        :name="t('settings.scripts.HeaderButtonsEditor.icon.a35abcd6')"
        :desc="t('settings.scripts.HeaderButtonsEditor.shown_on_the_button_in.bf9242b8')"
      >
        <Button
          :icon="edited.icon || 'play'"
          :text="edited.icon || 'play'"
          :tooltip="t('settings.scripts.HeaderButtonsEditor.choose_the_icon_from_the.9fd0ec06')"
          @click="pickingIconFor = editing"
        />
      </Setting>
      <Setting
        v-if="isCommand(edited)"
        :name="t('settings.scripts.HeaderButtonsEditor.command.71316697')"
        :desc="t('settings.scripts.HeaderButtonsEditor.command_the_button_runs.e980230f')"
      >
        <Button
          :text="
            edited.commandId
              ? commandName(edited.commandId)
              : t('settings.scripts.HeaderButtonsEditor.choose_command.ea49d680')
          "
          :tooltip="
            t('settings.scripts.HeaderButtonsEditor.search_every_command_obsidian_has.4ef0ca77')
          "
          @click="chooseCommand(editing)"
        />
      </Setting>
      <Setting
        v-if="!isCommand(edited)"
        :name="t('settings.scripts.HeaderButtonsEditor.icon_only.7a047008')"
        :desc="t('settings.scripts.HeaderButtonsEditor.leave_the_name_off_the.b9311fa5')"
      >
        <Checkbox
          :is-enabled="edited.iconOnly === true"
          @toggle="updateFlag(editing, 'iconOnly', !edited.iconOnly)"
        />
      </Setting>
      <Setting
        v-if="!isCommand(edited)"
        :name="t('settings.scripts.HeaderButtonsEditor.script.102acc10')"
        :desc="t('settings.scripts.HeaderButtonsEditor.script_the_button_runs.bd6df80c')"
      >
        <Button
          :text="
            edited.scriptName || t('settings.scripts.HeaderButtonsEditor.choose_script.e582e7b2')
          "
          :tooltip="t('settings.scripts.HeaderButtonsEditor.search_the_scripts_for_the.dcae2ff4')"
          @click="chooseScript(editing)"
        />
      </Setting>

      <template v-for="param in isCommand(edited) ? [] : paramsOf(edited)" :key="param.name">
        <Setting :name="param.name" :desc="paramDescription(param)">
          <Input
            :model-value="edited.params[param.name] || ''"
            :placeholder="param.default || ''"
            @update:model-value="updateParam(editing, param.name, $event)"
          />
        </Setting>
      </template>
      <p
        v-if="!isCommand(edited) && edited.scriptName && !paramsOf(edited).length"
        class="setting-item-description"
      >
        {{ t('settings.scripts.HeaderButtonsEditor.this_script_takes_no_parameters.c613d6f9') }}
      </p>

      <Setting heading :name="t('settings.scripts.HeaderButtonsEditor.where_it_shows.3397c2f1')" />
      <Setting
        :name="t('settings.scripts.HeaderButtonsEditor.on_every_note.d761c688')"
        :desc="t('settings.scripts.HeaderButtonsEditor.whatever_its_type_tags_or.ed398572')"
      >
        <Checkbox
          :is-enabled="edited.allNotes === true"
          @toggle="updateFlag(editing, 'allNotes', !edited.allNotes)"
        />
      </Setting>
      <template v-if="!edited.allNotes">
        <Setting
          :name="t('settings.scripts.HeaderButtonsEditor.note_types.52d728fb')"
          :desc="typesDescription(edited)"
        >
          <Input
            :model-value="edited.noteTypes.join(', ')"
            :placeholder="
              t('settings.scripts.HeaderButtonsEditor.e_g_movie_book.f621e5b4', {
                literal0: String('movie, book'),
              })
            "
            @update:model-value="updateList(editing, 'noteTypes', $event)"
          />
        </Setting>
        <Setting
          :name="t('settings.scripts.HeaderButtonsEditor.folders.c4d6bb20')"
          :desc="foldersDescription(edited)"
        >
          <Input
            :model-value="(edited.folders ?? []).join(', ')"
            :placeholder="
              t('settings.scripts.HeaderButtonsEditor.e_g_films_library_books.2cdb7bb5', {
                literal0: String('Films, Library/Books'),
              })
            "
            @update:model-value="updateList(editing, 'folders', $event)"
          />
        </Setting>
        <Setting
          :name="t('settings.scripts.HeaderButtonsEditor.tags.1331275b')"
          :desc="t('settings.scripts.HeaderButtonsEditor.comma_separated_with_or_without.3c0cedc4')"
        >
          <Input
            :model-value="(edited.tags ?? []).join(', ')"
            :placeholder="
              t('settings.scripts.HeaderButtonsEditor.e_g_work_project_site.e87aea15', {
                literal0: String('work, project/site'),
              })
            "
            @update:model-value="updateList(editing, 'tags', $event)"
          />
        </Setting>
      </template>
      <Setting
        v-if="isCommand(edited)"
        :name="t('settings.scripts.HeaderButtonsEditor.also_on_other_files.9f988318')"
        :desc="t('settings.scripts.HeaderButtonsEditor.pdfs_canvases_books_and_other.b562d03c')"
      >
        <Checkbox
          :is-enabled="edited.otherFiles === true"
          @toggle="updateFlag(editing, 'otherFiles', !edited.otherFiles)"
        />
      </Setting>

      <Setting
        :name="t('settings.scripts.HeaderButtonsEditor.only_when_its_properties.488c8e87')"
        :desc="
          edited.conditions?.length
            ? t('settings.scripts.HeaderButtonsEditor.the_note_must_also_have.6119d754')
            : t('settings.scripts.HeaderButtonsEditor.show_it_only_on_notes.d5cbb9eb')
        "
      >
        <Button
          :text="t('settings.scripts.HeaderButtonsEditor.add_condition.60a0d835')"
          :tooltip="t('settings.scripts.HeaderButtonsEditor.ask_for_one_more_property.20378dfa')"
          @click="addCondition(editing)"
        />
      </Setting>
      <Setting
        v-if="(edited.conditions?.length ?? 0) > 1"
        :name="t('settings.scripts.HeaderButtonsEditor.conditions_needed.9e17c43b')"
        :desc="t('settings.scripts.HeaderButtonsEditor.whether_the_note_has_to.997bc0f1')"
      >
        <Dropdown
          class="abele-header-buttons__mode"
          :options="MODE_OPTIONS"
          :model-value="edited.conditionMode ?? 'all'"
          @update:model-value="updateMode(editing, $event)"
        />
      </Setting>
      <Setting
        v-for="(condition, cIdx) in edited.conditions ?? []"
        :key="cIdx"
        :name="
          condition.property.trim() || t('settings.scripts.HeaderButtonsEditor.property.40040cb1')
        "
        :desc="describeCondition(condition)"
      >
        <div class="abele-header-buttons__condition">
          <Input
            class="abele-header-buttons__property"
            :model-value="condition.property"
            :placeholder="
              t('settings.scripts.HeaderButtonsEditor.e_g_status.be5a95ab', {
                literal0: String('status'),
              })
            "
            @update:model-value="updateCondition(editing, cIdx, { property: $event })"
          />
          <Dropdown
            class="abele-header-buttons__test"
            :options="TEST_OPTIONS"
            :model-value="condition.test"
            @update:model-value="updateCondition(editing, cIdx, { test: $event as PropertyTest })"
          />
          <Input
            v-if="comparesValue(condition.test)"
            class="abele-header-buttons__value"
            :model-value="condition.value"
            :placeholder="
              t('settings.scripts.HeaderButtonsEditor.e_g_todo.f74eec56', {
                literal0: String('todo'),
              })
            "
            @update:model-value="updateCondition(editing, cIdx, { value: $event })"
          />
          <Icon
            class="abele-header-buttons__remove"
            icon="x"
            :tooltip="t('settings.scripts.HeaderButtonsEditor.remove_this_condition.3b23e189')"
            @click="removeCondition(editing, cIdx)"
          />
        </div>
      </Setting>
      <template #footer>
        <div class="abele-modal__actions">
          <Button
            :text="t('settings.scripts.HeaderButtonsEditor.delete.e2d0a549')"
            warning
            :tooltip="t('settings.scripts.HeaderButtonsEditor.delete_this_button.3a238ae9')"
            class="abele-header-buttons__delete"
            @click="pendingRemoval = edited"
          />
          <Button
            :text="t('settings.scripts.HeaderButtonsEditor.done.11a6767d')"
            accent
            :tooltip="
              t('settings.scripts.HeaderButtonsEditor.close_this_window_changes_are.91342d87')
            "
            @click="editing = null"
          />
        </div>
      </template>
    </ObsidianModal>

    <IconPicker
      v-if="pickingIconFor !== null && buttons[pickingIconFor]"
      :current="buttons[pickingIconFor].icon"
      @choose="chooseIcon"
      @close="pickingIconFor = null"
    />

    <ConfirmModal
      v-if="pendingRemoval"
      :title="t('settings.scripts.HeaderButtonsEditor.delete_header_button.bf829880')"
      :message="
        t('settings.scripts.HeaderButtonsEditor.delete_value_it_disappears_from.c2d5da26', {
          value0: String(pendingRemoval.name || t('settings.terms.unnamedButton')),
        })
      "
      :confirm-tooltip="
        t('settings.scripts.HeaderButtonsEditor.delete_value.8782b778', {
          value0: String(pendingRemoval.name || 'the button'),
        })
      "
      @confirm="remove(pendingRemoval.id)"
      @close="pendingRemoval = null"
    />
  </Section>
</template>

<script setup lang="ts">
import I18nText from '@/components/obsidian/I18nText.vue'
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import { nanoid } from 'nanoid'
import Setting from '../../obsidian/Setting.vue'
import Section from '../../obsidian/Section.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import IconPicker from '../../obsidian/IconPicker.vue'
import {
  AbeleConfig,
  type HeaderButtonCondition,
  type HeaderButtonDefinition,
  type PropertyTest,
} from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { placementProblems, type VaultShape } from '@/helpers/headerButtons'
import { TFolder } from 'obsidian'
import { findScriptByName } from '@/scripting/runScript'
import { pickCommand, pickScript } from '@/helpers/suggesters/RunnablePicker'
import { defaultCommandLabel } from '@/i18n/commandLabels'
import { buttonRuns } from '@/helpers/headerButtons'
import { hasCommand } from '@/headerButtons/viewActions'
import { GlobalStore } from '@/stores/GlobalStore'
import { useSettingsSave } from '@/composables/useSettingsSave'
import type { ScriptParam } from '@/scripting/types'

const config = AbeleConfig.getInstance()

/**
 * Written here rather than in the template above: a `{{ ... }}` inside a template is an
 * interpolation, so the braces these are made of cannot be typed there directly.
 */
const variableExamples = ['title', 'path', 'folder', 'date:YYYY-MM-DD']
  .map((name) => `{{${name}}}`)
  .join(', ')
const frontmatterExample = '{{status}}'

const copy = (): HeaderButtonDefinition[] =>
  JSON.parse(JSON.stringify(config.headerButtons || [])) as HeaderButtonDefinition[]

const buttons = ref<HeaderButtonDefinition[]>(copy())
const pendingRemoval = ref<HeaderButtonDefinition | null>(null)
/**
 * The types and folders the vault has, read once as the screen opens, so a button set up for
 * a type no note has — `tasks` where notes say `task` — says so here instead of silently never
 * appearing.
 */
const vaultShape = ((): VaultShape => {
  const { app } = GlobalStore.getInstance()
  const types = new Set<string>()
  for (const file of app.vault.getMarkdownFiles()) {
    const type: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.type
    if (typeof type === 'string' && type.trim()) types.add(type.trim().toLowerCase())
  }
  return {
    types,
    folderExists: (folder) =>
      folder === '/' || app.vault.getAbstractFileByPath(folder) instanceof TFolder,
    hasCommand: (id) => hasCommand(app, id),
  }
})()

const RUNS_OPTIONS = [
  { value: 'command', display: t('settings.scripts.HeaderButtonsEditor.a_command.18e6a3ee') },
  { value: 'script', display: t('settings.scripts.HeaderButtonsEditor.a_script.1ccd820b') },
]

const runsOf = buttonRuns
const isCommand = (button: HeaderButtonDefinition) => buttonRuns(button) === 'command'

interface CommandInfo {
  id: string
  name: string
  icon?: string
}

/** A command as Obsidian has it now, or undefined while its plugin is off. */
const findCommand = (id: string): CommandInfo | undefined => {
  const commands = (
    GlobalStore.getInstance().app as unknown as {
      commands?: { findCommand?(id: string): CommandInfo | undefined }
    }
  ).commands
  return commands?.findCommand?.(id)
}

/** The command's name as the palette shows it; its id while it is not there. */
const commandName = (id: string): string => findCommand(id)?.name ?? id

const subtitleOf = (button: HeaderButtonDefinition): string => {
  if (isCommand(button)) {
    return button.commandId
      ? commandName(button.commandId)
      : t('settings.scripts.HeaderButtonsEditor.no_command_chosen_yet.114ca4e7')
  }
  return (
    button.scriptName || t('settings.scripts.HeaderButtonsEditor.no_script_chosen_yet.1662385a')
  )
}

const problemsOf = (button: HeaderButtonDefinition) => placementProblems(button, vaultShape)

const quoted = (items: string[]) => items.map((item) => `"${item}"`).join(', ')

const typesDescription = (button: HeaderButtonDefinition): string => {
  const plain = t('settings.scripts.HeaderButtonsEditor.comma_separated_notes_whose_type.15826848')
  const unknown = problemsOf(button).unknownTypes
  if (!unknown.length) return plain
  const known = [...vaultShape.types].sort().slice(0, 12)
  const which =
    unknown.length === 1
      ? t('settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.c4ccaca3', {
          value0: String(quoted(unknown)),
        })
      : t('settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.0477bd78', {
          value0: String(quoted(unknown)),
        })
  return known.length
    ? t('settings.scripts.HeaderButtonsEditor.value_types_in_use_value.165f7815', {
        value0: String(which),
        value1: String(known.join(', ')),
      })
    : which
}

const foldersDescription = (button: HeaderButtonDefinition): string => {
  const plain =
    t('settings.scripts.HeaderButtonsEditor.comma_separated_notes_anywhere_under.e213df44') +
    t('settings.scripts.HeaderButtonsEditor.any_one_folder_for_any.d06e9c0a', {
      literal0: String('Projects/*/Notes'),
    })
  const missing = problemsOf(button).missingFolders
  if (!missing.length) return plain
  return missing.length === 1
    ? t('settings.scripts.HeaderButtonsEditor.no_folder_value_in_this.046d41b9', {
        value0: String(quoted(missing)),
      })
    : t('settings.scripts.HeaderButtonsEditor.no_folders_value_in_this.c62c6ef1', {
        value0: String(quoted(missing)),
      })
}

/** The button whose icon is being chosen, by its place in the list. */
const pickingIconFor = ref<number | null>(null)

const TEST_OPTIONS: { value: PropertyTest; display: string }[] = [
  { value: 'equals', display: t('settings.scripts.HeaderButtonsEditor.is.fa51fd49') },
  { value: 'not-equals', display: t('settings.scripts.HeaderButtonsEditor.is_not.e1bf1560') },
  { value: 'filled', display: t('settings.scripts.HeaderButtonsEditor.is_filled_in.855a94e1') },
  { value: 'empty', display: t('settings.scripts.HeaderButtonsEditor.is_empty.86aaa00d') },
]

const MODE_OPTIONS = [
  { value: 'all', display: t('settings.scripts.HeaderButtonsEditor.all_of_them.29c88933') },
  { value: 'any', display: t('settings.scripts.HeaderButtonsEditor.any_one.4013adf2') },
]

const { save } = useSettingsSave(
  () => {
    config.headerButtons = JSON.parse(JSON.stringify(buttons.value))
  },
  () => {
    buttons.value = copy()
  }
)

/**
 * The parameters the chosen script declares. The form is built from these rather than from
 * free-form key/value rows, so a button cannot be configured with a parameter its script has
 * never heard of.
 */
const paramsOf = (button: HeaderButtonDefinition): ScriptParam[] =>
  button.scriptName ? (findScriptByName(button.scriptName)?.meta.params ?? []) : []

const paramDescription = (param: ScriptParam): string => {
  const described =
    param.description || t('settings.scripts.HeaderButtonsEditor.no_description.06a69482')
  // A description written as a label has no full stop: the default joins it as a second fact.
  return param.default
    ? t('settings.scripts.HeaderButtonsEditor.value_defaults_to_value.e824e925', {
        value0: String(described),
        value1: String(param.default),
      })
    : described
}

/** Scripts a header button may run: not the ones switched off in their own header. */
const runnableScripts = () =>
  ScriptService.getInstance().scriptList.value.filter((s) => s.meta.enabled !== false)

/** A new button runs a command, on every note: narrowing it down is the next step, if any. */
const addButton = () => {
  buttons.value.push({
    id: nanoid(8),
    name: '',
    icon: 'play',
    noteTypes: [],
    runs: 'command',
    scriptName: '',
    commandId: '',
    params: {},
    enabled: true,
    iconOnly: false,
    allNotes: true,
    folders: [],
    tags: [],
    otherFiles: false,
    conditions: [],
    conditionMode: 'all',
  })
  save()
}

const remove = (id: string) => {
  buttons.value = buttons.value.filter((b) => b.id !== id)
  pendingRemoval.value = null
  editing.value = null
  save()
}

/** The button open in its window, by its place in the list. */
const editing = ref<number | null>(null)
const edited = computed(() => (editing.value === null ? null : buttons.value[editing.value]))

const addAndEdit = () => {
  addButton()
  editing.value = buttons.value.length - 1
}

/** The order here is the order in the header. */
const move = (idx: number, by: -1 | 1) => {
  const to = idx + by
  if (to < 0 || to >= buttons.value.length) return
  const next = [...buttons.value]
  ;[next[idx], next[to]] = [next[to], next[idx]]
  buttons.value = next
  save()
}

const chooseScript = async (idx: number) => {
  const script = await pickScript(GlobalStore.getInstance().app, runnableScripts())
  if (script) updateField(idx, 'scriptName', script.meta.name)
}

/**
 * The command, from every command Obsidian has, scripts' included. A button with no name or
 * icon of its own yet takes the command's, which is what it would have been called anyway.
 */
const chooseCommand = async (idx: number) => {
  const command = await pickCommand(GlobalStore.getInstance().app)
  if (!command) return
  const button = buttons.value[idx]
  button.commandId = command.id
  if (!button.name.trim())
    button.name = defaultCommandLabel(command, ScriptService.getInstance().scriptList.value)
  if ((!button.icon || button.icon === 'play') && command.icon) button.icon = command.icon
  save()
}

/** Switching what it runs keeps both the script and the command, so switching back loses nothing. */
const updateRuns = (idx: number, runs: string) => {
  buttons.value[idx].runs = runs === 'script' ? 'script' : 'command'
  save()
}

const updateField = (idx: number, field: 'name' | 'icon' | 'scriptName', value: string) => {
  const changedScript = field === 'scriptName' && buttons.value[idx].scriptName !== value
  buttons.value[idx][field] = value
  // A button's parameters belong to the script it runs; carrying them to another script would
  // leave values under names the new one does not declare. Choosing the same one again is
  // not a change, and must not cost the parameters.
  if (changedScript) buttons.value[idx].params = {}
  save()
}

const updateFlag = (
  idx: number,
  field: 'enabled' | 'iconOnly' | 'allNotes' | 'otherFiles',
  value: boolean
) => {
  buttons.value[idx][field] = value
  save()
}

const updateList = (idx: number, field: 'noteTypes' | 'folders' | 'tags', value: string) => {
  buttons.value[idx][field] = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  save()
}

const chooseIcon = (icon: string) => {
  if (pickingIconFor.value !== null) updateField(pickingIconFor.value, 'icon', icon)
  pickingIconFor.value = null
}

const comparesValue = (test: PropertyTest) => test === 'equals' || test === 'not-equals'

/** The condition read out as a sentence, so a row says what it asks without parsing. */
const describeCondition = (c: HeaderButtonCondition): string => {
  const property = c.property.trim()
  if (!property)
    return t('settings.scripts.HeaderButtonsEditor.name_a_frontmatter_property_until.b0812819')
  switch (c.test) {
    case 'filled':
      return t('settings.scripts.HeaderButtonsEditor.notes_whose_value_is_filled.031bfe7b', {
        value0: String(property),
      })
    case 'empty':
      return t('settings.scripts.HeaderButtonsEditor.notes_whose_value_is_empty.18f1876a', {
        value0: String(property),
      })
    case 'not-equals':
      return t('settings.scripts.HeaderButtonsEditor.notes_whose_value_is_anything.292370b0', {
        value0: String(property),
        value1: String(c.value.trim()),
      })
    default:
      return c.value.trim()
        ? t('settings.scripts.HeaderButtonsEditor.notes_whose_value_is_value.20728e9f', {
            value0: String(property),
            value1: String(c.value.trim()),
          })
        : t('settings.scripts.HeaderButtonsEditor.type_the_value_value_must.eb364908', {
            value0: String(property),
          })
  }
}

const addCondition = (idx: number) => {
  const button = buttons.value[idx]
  button.conditions = [...(button.conditions ?? []), { property: '', test: 'equals', value: '' }]
  save()
}

const updateCondition = (idx: number, cIdx: number, change: Partial<HeaderButtonCondition>) => {
  const button = buttons.value[idx]
  const conditions = [...(button.conditions ?? [])]
  conditions[cIdx] = { ...conditions[cIdx], ...change }
  button.conditions = conditions
  save()
}

const removeCondition = (idx: number, cIdx: number) => {
  const button = buttons.value[idx]
  button.conditions = (button.conditions ?? []).filter((_, i) => i !== cIdx)
  save()
}

const updateMode = (idx: number, mode: string) => {
  buttons.value[idx].conditionMode = mode === 'any' ? 'any' : 'all'
  save()
}

const updateParam = (idx: number, name: string, value: string) => {
  buttons.value[idx].params = { ...buttons.value[idx].params, [name]: value }
  save()
}
</script>

<style lang="scss">
.abele-header-buttons__name {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-header-buttons__glyph {
  flex: 0 0 auto;
  --icon-size: var(--icon-s);
}

// Off reads as off: the name quieter, the switch says the rest.
.abele-header-buttons__row_off .abele-header-buttons__name {
  color: var(--text-muted);
}

// Order, change and on at the end of the row, which stays one line.
.abele-header-buttons__row > .setting-item-control {
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: var(--size-2-2);
}

.abele-header-buttons__delete {
  margin-inline-end: auto;
}

/**
 * A condition as one small form: the property and the test side by side with the glyph that
 * removes it, the value it is compared with on the line under them, across the whole column.
 */
.abele-header-buttons__condition {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  grid-template-areas:
    'property test remove'
    'value value value';
  align-items: center;
  gap: var(--size-4-2);
  width: 100%;

  > .abele-header-buttons__property {
    grid-area: property;
  }

  > .abele-header-buttons__test {
    grid-area: test;

    select {
      width: 100%;
    }
  }

  > .abele-header-buttons__value {
    grid-area: value;
  }

  > .abele-header-buttons__remove {
    grid-area: remove;
  }
}
</style>
