<template>
  <Section
    title="Labels"
    desc="Labels are read from a task's property, one value or a list of them. Each label can have a colour; the rest are grey."
    class="abele-task-labels"
  >
    <Setting
      class="abele-task-labels__property"
      name="Label property"
      desc='The task property labels are read from (default: "labels").'
    >
      <Input
        :model-value="property"
        :placeholder="DEFAULT_LABEL_PROPERTY"
        @update:model-value="propertyChanged"
      />
    </Setting>
    <Setting v-for="row in rows" :key="row.key" :name="row.label">
      <Badge :text="row.label" :color="row.color" />
      <Dropdown
        :options="colorOptions"
        :model-value="row.color"
        @update:model-value="(color: string) => colorChanged(row.label, color)"
      />
    </Setting>
    <Setting
      class="abele-task-labels__new"
      name="Add a label"
      desc="To colour a label before any task carries it."
    >
      <Input v-model="newLabel" placeholder="Label" />
      <Button text="Add" tooltip="Add this label to the list" @click="addLabel" />
    </Setting>
  </Section>
</template>

<script setup lang="ts">
import { computed, ref, unref } from 'vue'
import { debounce } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Button from '../obsidian/Button.vue'
import Badge from '../obsidian/Badge.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { KIT_COLORS, KIT_COLOR_NAMES, isKitColor } from '@/constants/colors'
import { DEFAULT_LABEL_PROPERTY, labelColor, labelKey } from '@/helpers/taskMeta'

const config = AbeleConfig.getInstance()

const property = ref(config.taskLabelProperty)
/** Typed in on this screen and not yet on any task or given a colour. */
const added = ref<string[]>([])
const newLabel = ref('')
/** The save is debounced; this redraws the preview at once rather than half a second later. */
const changed = ref(0)

const colorOptions = KIT_COLORS.map((color) => ({ value: color, display: KIT_COLOR_NAMES[color] }))

const save = debounce(() => config.saveSettings(), 500)

/**
 * Every label worth offering a colour for: those tasks carry now — read from the task list
 * already in memory, not from the vault — those that already have a colour, and those typed
 * in here. One row per label whatever its case, spelled as first met.
 */
const rows = computed(() => {
  void config.version.value
  void changed.value
  const byKey = new Map<string, string>()
  const offer = (label: string) => {
    const key = labelKey(label)
    if (key && !byKey.has(key)) byKey.set(key, label.trim())
  }

  for (const entry of config.taskLabelColors) offer(entry.value)
  const tasks = unref(GlobalStore.getInstance().tasksList)?.tasks
  for (const task of tasks?.values() ?? []) task.labels.forEach(offer)
  added.value.forEach(offer)

  return [...byKey.entries()]
    .map(([key, label]) => ({ key, label, color: labelColor(label, config.taskLabelColors) }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const propertyChanged = (value: string) => {
  property.value = value
  config.taskLabelProperty = value.trim() || DEFAULT_LABEL_PROPERTY
  save()
}

const colorChanged = (label: string, color: string) => {
  const key = labelKey(label)
  const rest = config.taskLabelColors.filter((entry) => labelKey(entry.value) !== key)
  // Grey is no colour at all, so choosing it drops the entry rather than storing it.
  config.taskLabelColors =
    isKitColor(color) && color !== 'grey'
      ? [...rest, { value: label, color }]
      : rest
  changed.value++
  save()
}

const addLabel = () => {
  const label = newLabel.value.replace(/^#+/, '').trim()
  if (!label) return
  added.value = [...added.value, label]
  newLabel.value = ''
}
</script>
