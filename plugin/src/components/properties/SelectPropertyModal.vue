<template>
  <Modal
    :title="draft.key.trim() || t('area.selectNewProperty')"
    phone-sheet
    modal-class="abele-select-property"
    @close="emit('close')"
  >
    <Setting :name="t('area.selectPropertyName')" :error="nameError">
      <Input
        :model-value="draft.key"
        :placeholder="t('area.selectPropertyPlaceholder')"
        :invalid="!!nameError"
        @update:model-value="(v: string) => change({ key: v })"
      />
    </Setting>
    <Setting :name="t('area.selectMultiple')" :desc="t('area.selectMultipleDesc')">
      <Checkbox :is-enabled="draft.multiple" @toggle="change({ multiple: !draft.multiple })" />
    </Setting>

    <Setting heading :name="t('area.selectOptions')">
      <Icon icon="plus" :tooltip="t('area.selectAddOption')" @click="addOption" />
    </Setting>
    <EmptyState v-if="!draft.options.length" :text="t('area.selectNoOptions')" />
    <div v-else class="abele-select-property__options" role="list">
      <div
        v-for="(option, idx) in draft.options"
        :key="ids[idx]"
        class="abele-select-property__option"
        :class="{ 'is-open': open === idx, 'is-dragged': dragged === idx }"
        role="listitem"
        @dragover.prevent="dragOver(idx)"
        @drop.prevent="dragged = null"
      >
        <div class="abele-select-property__row">
          <span
            class="abele-select-property__grip"
            draggable="true"
            :aria-label="t('area.selectDrag')"
            @dragstart="dragged = idx"
            @dragend="dragged = null"
            ><Icon icon="grip-vertical" no-hover
          /></span>
          <div
            role="button"
            tabindex="0"
            class="abele-select-property__main"
            :aria-expanded="open === idx"
            @click="open = open === idx ? null : idx"
            @keydown.enter.prevent="open = open === idx ? null : idx"
            @keydown.space.prevent="open = open === idx ? null : idx"
          >
            <SelectMark :option="option" />
            <span class="abele-select-property__text">
              <span class="abele-select-property__name">{{
                option.value || t('area.selectUnnamed')
              }}</span>
              <span v-if="option.description" class="abele-select-property__desc">{{
                option.description
              }}</span>
            </span>
          </div>
          <Icon
            icon="x"
            :tooltip="t('area.selectRemoveOption', { value: option.value })"
            @click="askRemove(idx)"
          />
        </div>
        <div v-if="stale(idx)" class="abele-select-property__stale">
          {{ t('area.selectStale', { count: stale(idx), value: originals[idx] }) }}
          <a href="#" @click.prevent="rename(idx)">{{ t('area.selectRenameInNotes') }}</a>
        </div>
        <div v-if="open === idx" class="abele-select-property__editor">
          <Setting :name="t('area.selectOptionName')" :error="optionError(idx)">
            <Input
              :model-value="option.value"
              :invalid="!!optionError(idx)"
              @update:model-value="(v: string) => setOption(idx, { value: v })"
            />
          </Setting>
          <Setting :name="t('area.selectOptionDesc')">
            <Input
              :model-value="option.description ?? ''"
              :placeholder="t('area.selectOptionDescPlaceholder')"
              @update:model-value="(v: string) => setOption(idx, { description: v || undefined })"
            />
          </Setting>
          <Setting :name="t('area.selectOptionColour')">
            <SwatchPicker
              :model-value="option.color ?? 'grey'"
              :label="t('area.selectOptionColour')"
              @update:model-value="
                (c: KitColor) => setOption(idx, { color: c === 'grey' ? undefined : c })
              "
            />
          </Setting>
          <Setting :name="t('area.selectOptionIcon')">
            <Icon
              v-if="option.icon"
              icon="x"
              :tooltip="t('area.selectOptionNoIcon')"
              @click="setOption(idx, { icon: undefined })"
            />
            <Button
              :text="
                option.icon ? t('area.selectOptionChangeIcon') : t('area.selectOptionPickIcon')
              "
              :icon="option.icon"
              :tooltip="t('area.selectOptionPickIconTip')"
              @click="pickingIcon = idx"
            />
          </Setting>
        </div>
      </div>
    </div>

    <template #footer>
      <Button
        accent
        :text="t('area.selectDone')"
        :disabled="!!nameError || draft.options.some((_, i) => optionError(i))"
        :tooltip="t('area.selectDoneTip')"
        @click="done"
      />
    </template>

    <IconPicker
      v-if="pickingIcon !== null"
      :current="draft.options[pickingIcon]?.icon"
      @choose="(icon: string) => chooseIcon(icon)"
      @close="pickingIcon = null"
    />
    <ConfirmModal
      v-if="removing !== null"
      :title="t('area.selectRemoveTitle', { value: draft.options[removing]!.value })"
      :message="
        t('area.selectRemoveInUse', {
          count: uses(originals[removing] ?? draft.options[removing]!.value),
        })
      "
      :confirm-text="t('area.selectRemove')"
      @confirm="removeOption(removing)"
      @close="removing = null"
    />
  </Modal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, reactive, ref } from 'vue'
import Modal from '../obsidian/Modal.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import SwatchPicker from '../obsidian/SwatchPicker.vue'
import IconPicker from '../obsidian/IconPicker.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import SelectMark from './SelectMark.vue'
import type { KitColor } from '@/constants/colors'
import type { SelectOption, SelectProperty } from '@/properties/select'

/**
 * One select property: its name, whether several options may be picked, and its options, each
 * opened in place to name, describe, colour and give an icon. Options are dragged by their grip
 * into the order the list shows them in.
 *
 * Renaming an option rewrites no note by itself: the notes still holding the old name are
 * counted under it, with a link to rename them too.
 */
const props = defineProps<{
  property: SelectProperty
  /** The other select properties' names, which this one may not take. */
  taken: string[]
  /** How many notes hold `value` under this property's name as it was opened. */
  uses: (value: string) => number
  /** Opened on this option, for a link that leads to one. */
  openAt?: number
}>()

const emit = defineEmits<{
  save: [property: SelectProperty]
  rename: [from: string, to: string]
  close: []
}>()

const draft = reactive<SelectProperty>({
  key: props.property.key,
  multiple: props.property.multiple,
  options: props.property.options.map((o) => ({ ...o })),
})
/** Each option's name when the window opened, to tell a rename from a new option. */
const originals = ref<(string | undefined)[]>(props.property.options.map((o) => o.value))
let nextId = 0
const ids = ref(draft.options.map(() => nextId++))
const open = ref<number | null>(props.openAt ?? null)
const pickingIcon = ref<number | null>(null)
const removing = ref<number | null>(null)
const dragged = ref<number | null>(null)

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

const nameError = computed(() => {
  const key = draft.key.trim()
  if (!key) return t('area.selectNameMissing')
  return props.taken.some((k) => same(k, key)) ? t('area.selectNameTaken', { key }) : ''
})

const optionError = (idx: number) => {
  const value = draft.options[idx].value.trim()
  if (!value) return t('area.selectOptionMissing')
  return draft.options.some((o, i) => i !== idx && same(o.value, value))
    ? t('area.selectOptionTwice', { value })
    : ''
}

/** Notes still holding the name this option had before it was renamed here. */
const stale = (idx: number) => {
  const was = originals.value[idx]
  const now = draft.options[idx].value
  return was && !nameError.value && !optionError(idx) && !same(was, now) ? props.uses(was) : 0
}
const rename = (idx: number) => {
  const was = originals.value[idx]
  if (!was || !stale(idx)) return
  emit('rename', was, draft.options[idx].value.trim())
}

const change = (patch: Partial<SelectProperty>) => Object.assign(draft, patch)
const setOption = (idx: number, patch: Partial<SelectOption>) =>
  Object.assign(draft.options[idx], patch)

const addOption = () => {
  draft.options.push({ value: '' })
  originals.value.push(undefined)
  ids.value.push(nextId++)
  open.value = draft.options.length - 1
}

const askRemove = (idx: number) => {
  const was = originals.value[idx]
  if (was && props.uses(was)) removing.value = idx
  else removeOption(idx)
}
const removeOption = (idx: number) => {
  draft.options.splice(idx, 1)
  originals.value.splice(idx, 1)
  ids.value.splice(idx, 1)
  open.value = null
  removing.value = null
}

const dragOver = (idx: number) => {
  const from = dragged.value
  if (from === null || from === idx) return
  for (const list of [draft.options, originals.value, ids.value] as unknown[][]) {
    const [moved] = list.splice(from, 1)
    list.splice(idx, 0, moved)
  }
  if (open.value === from) open.value = idx
  dragged.value = idx
}

const chooseIcon = (icon: string) => {
  if (pickingIcon.value !== null) setOption(pickingIcon.value, { icon })
  pickingIcon.value = null
}

const done = () => {
  emit('save', {
    key: draft.key.trim(),
    multiple: draft.multiple,
    options: draft.options.map((o) => ({ ...o, value: o.value.trim() })),
  })
  emit('close')
}
</script>

<style>
.abele-select-property__options {
  display: flex;
  flex-direction: column;
  padding-bottom: var(--size-4-2);
}

.abele-select-property__row {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  min-height: var(--size-4-9);
}

.abele-select-property__grip {
  display: inline-flex;
  color: var(--text-faint);
  cursor: grab;
  --icon-size: var(--icon-s);
}

.abele-select-property__option.is-dragged {
  opacity: 0.5;
}

.abele-select-property__main {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--size-2-2) var(--size-2-3);
  border-radius: var(--radius-s);
  cursor: var(--cursor);
}

.abele-select-property__main:hover,
.abele-select-property__option.is-open .abele-select-property__main {
  background-color: var(--background-modifier-hover);
}

.abele-select-property__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.abele-select-property__name,
.abele-select-property__desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-select-property__name {
  color: var(--text-normal);
}

.abele-select-property__desc {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-select-property__stale {
  padding-inline-start: calc(var(--icon-s) + var(--size-2-2) + var(--size-2-3));
  margin-inline-start: calc(var(--icon-s) + var(--size-4-2));
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-select-property__stale a {
  margin-inline-start: var(--size-4-1);
}

.abele-select-property__editor {
  /* The rule runs down from the middle of the option's mark, and the fields' names start where
     the option's name does: 16 px grip, 4 px gap, 6 px padding, half a 16 px mark. */
  margin-top: var(--size-4-2);
  margin-inline-start: calc(var(--icon-s) + var(--size-2-2) + var(--size-2-3) + var(--icon-s) / 2);
  padding-inline-start: calc(var(--size-4-4) - 1px);
  border-inline-start: 1px solid var(--background-modifier-border);
}

.abele-select-property__editor .setting-item {
  padding: var(--size-4-2) 0;
}

.abele-select-property__editor .setting-item:first-child {
  padding-top: 0;
}

/* A name with no description sits level with its field, not at the field's top edge. */
.abele-select-property__editor .setting-item-info {
  align-self: center;
}
</style>
