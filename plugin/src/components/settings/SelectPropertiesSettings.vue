<template>
  <!-- The properties picked from a list: one row each, its options' marks and how many, opened
       to edit in a window of its own. -->
  <Section
    class="abele-select-settings"
    :title="t('area.selectSettingsName')"
    :desc="t('area.selectSettingsDesc')"
  >
    <template #actions>
      <Icon icon="plus" :tooltip="t('area.selectAddPropertyTip')" @click="editing = -1" />
    </template>
    <EmptyState v-if="!list.length" :text="t('area.selectSettingsEmpty')" />
    <Setting
      v-for="(property, idx) in list"
      :key="property.key"
      class="abele-select-settings__property"
      :name="property.key"
    >
      <template #desc>
        <span class="abele-select-settings__marks"
          ><SelectMark
            v-for="option in property.options.slice(0, 8)"
            :key="option.value"
            :option="option"
        /></span>
        <span class="abele-select-settings__summary">{{ summary(property) }}</span>
      </template>
      <Icon
        icon="pencil"
        :tooltip="t('area.selectEdit', { key: property.key })"
        @click="editing = idx"
      />
      <Icon
        icon="x"
        :tooltip="t('area.selectRemoveProperty', { key: property.key })"
        @click="remove(idx)"
      />
    </Setting>

    <SelectPropertyModal
      v-if="editing !== null"
      :property="editing >= 0 ? list[editing]! : { key: '', multiple: false, options: [] }"
      :taken="list.filter((_, i) => i !== editing).map((p) => p.key)"
      :uses="(value: string) => uses(editing! >= 0 ? list[editing!]!.key : '', value)"
      :open-at="openAt"
      @save="save"
      @rename="(from: string, to: string) => emit('rename', editingKey, from, to)"
      @close="editing = null"
    />
  </Section>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Section from '../obsidian/Section.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import Icon from '../obsidian/Icon.vue'
import SelectMark from '../properties/SelectMark.vue'
import SelectPropertyModal from '../properties/SelectPropertyModal.vue'
import type { SelectProperty } from '@/properties/select'

/**
 * The settings' list of select properties. Saving is the caller's: it gets the whole list back
 * each time one property is added, changed or removed. Taking a property off the list changes
 * no note; its values are drawn as plain text again.
 */
const props = defineProps<{
  modelValue: SelectProperty[]
  /** How many notes hold `value` under `key`. */
  uses: (key: string, value: string) => number
  /** Opened on this property and option, for a stand that shows the window open. */
  initialEdit?: { property: number; option?: number }
}>()

const emit = defineEmits<{
  'update:modelValue': [list: SelectProperty[]]
  rename: [key: string, from: string, to: string]
}>()

const list = computed(() => props.modelValue)
const editing = ref<number | null>(props.initialEdit?.property ?? null)
const openAt = computed(() =>
  editing.value === props.initialEdit?.property ? props.initialEdit?.option : undefined
)
const editingKey = computed(() =>
  editing.value !== null && editing.value >= 0 ? list.value[editing.value].key : ''
)

const summary = (p: SelectProperty) =>
  t(p.multiple ? 'area.selectSummaryMany' : 'area.selectSummaryOne', { count: p.options.length })

const save = (property: SelectProperty) => {
  const next = [...list.value]
  if (editing.value !== null && editing.value >= 0) next[editing.value] = property
  else next.push(property)
  emit('update:modelValue', next)
}

const remove = (idx: number) =>
  emit(
    'update:modelValue',
    list.value.filter((_, i) => i !== idx)
  )
</script>

<style>
.abele-select-settings__summary {
  display: inline-block;
  white-space: nowrap;
}

.abele-select-settings__marks {
  display: inline-flex;
  gap: var(--size-2-1);
  margin-inline-end: var(--size-4-2);
  vertical-align: middle;
}

.abele-select-settings__marks:empty {
  display: none;
}
</style>
