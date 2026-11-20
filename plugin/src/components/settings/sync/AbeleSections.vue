<template>
  <Section
    class="abele-sections"
    :title="t('sync.sections.title')"
    :desc="pluginSettings ? t('sync.sections.desc') : t('sync.sections.descOff')"
  >
    <!-- What arrived over this device's own change: the arrived version is in, this one kept. -->
    <Setting
      v-for="item in source.kept.value"
      :key="item.id"
      class="abele-sections__kept"
      :name="t('sync.sections.keptName', { section: labelOf(item.id), device: item.from })"
      :desc="
        item.choice
          ? t('sync.sections.againKept')
          : t('sync.sections.keptDesc', { when: formatWhen(new Date(item.at).toISOString()) })
      "
      :data-kept="item.id"
    >
      <Button
        :text="t('sync.sections.restore')"
        :tooltip="
          item.choice
            ? t('sync.sections.restore')
            : t('sync.sections.restoreTip', { section: labelOf(item.id) })
        "
        :loading="restoring === item.id"
        @click="restore(item.id)"
      />
    </Setting>

    <!-- Keys are said once, here; the rows only mark which sections they are about. -->
    <Setting
      v-if="pluginSettings && keyLine"
      class="abele-sections__keys"
      :name="keyLine.name"
      :desc="keyLine.desc"
      data-keys-line
    >
      <Button
        v-if="keyLine.action"
        :text="keyLine.action"
        :tooltip="keyLine.action"
        @click="source.openKeys()"
      />
    </Setting>

    <div class="abele-sections__head" :class="{ 'is-disabled': !pluginSettings }">
      <GroupHeading :label="t('sync.sections.list')">{{ chosenCount }}</GroupHeading>
      <Button
        v-if="pluginSettings"
        quiet
        class="abele-sections__all"
        :text="
          everything
            ? t('settings.TransferSettings.clear.83b12c22')
            : t('settings.TransferSettings.select_all.1fc9a387')
        "
        :tooltip="everything ? t('sync.sections.noneTip') : t('sync.sections.allTip')"
        @click="chooseAll(!everything)"
      />
    </div>
    <div class="abele-sections__tree" :class="{ 'is-disabled': !pluginSettings }" role="tree">
      <TreeItem
        v-for="page in pages"
        :key="page.title"
        :text="page.title"
        :flair="countOf(page.rows)"
        collapsible
        :collapsed="!open.has(page.title)"
        :disabled="!pluginSettings"
        :data-page="page.title"
        @click="fold(page.title)"
      >
        <template #leading>
          <input
            type="checkbox"
            class="abele-sections__check"
            :disabled="!pluginSettings"
            :checked="allOf(page.rows)"
            :indeterminate="someOf(page.rows) && !allOf(page.rows)"
            :data-indeterminate="someOf(page.rows) && !allOf(page.rows)"
            :aria-label="t('sync.sections.pageCheck', { page: page.title })"
            @click.stop
            @change="chooseMany(page.rows, !allOf(page.rows))"
          />
        </template>
        <!-- A folded page still says that something under it wants a look. -->
        <template
          v-if="pluginSettings && open.has(page.title) === false && page.rows.some(warned)"
          #end
        >
          <Icon
            icon="triangle-alert"
            color="orange"
            :interactive="false"
            :tooltip="t('sync.sections.pageWarn')"
          />
        </template>
        <TreeItem
          v-for="row in page.rows"
          :key="row.id"
          :text="row.label"
          :disabled="!pluginSettings"
          :data-section="row.id"
          @click="flip(row)"
        >
          <template #leading>
            <input
              type="checkbox"
              class="abele-sections__check"
              :disabled="!pluginSettings"
              :checked="chosen.has(row.id)"
              :aria-label="row.label"
              @click.stop
              @change="flip(row)"
            />
          </template>
          <template v-if="pluginSettings && chosen.has(row.id)" #end>
            <Icon
              v-if="missingNeeds(row).length"
              icon="triangle-alert"
              color="orange"
              :tooltip="
                t('sync.sections.needs', {
                  section: row.label,
                  needed: missingNeeds(row).map(labelOf).join(', '),
                })
              "
              data-needs
              @click.stop="chooseMany(missingNeeds(row).map(rowOf), true)"
            />
            <Icon
              v-if="row.keys"
              :icon="keyIcon()"
              :color="keyTrouble(row) ? 'orange' : undefined"
              :text-right="keyTrouble(row) && row.missing ? String(row.missing) : undefined"
              :interactive="false"
              :tooltip="keyTip(row)"
              data-keys
            />
          </template>
        </TreeItem>
      </TreeItem>
    </div>
  </Section>

  <ChoiceModal
    v-if="asking"
    phone-sheet
    :title="t('sync.sections.againTitle', { section: asking.label })"
    :message="[
      t('sync.sections.againBody', { section: asking.label }),
      t('sync.sections.againKept'),
    ]"
    :choices="[
      { value: null, text: t('sync.sections.cancel'), tooltip: t('sync.sections.cancelTip') },
      {
        value: 'device',
        text: t('sync.sections.takeDevice'),
        tooltip: t('sync.sections.takeDeviceTip'),
      },
      {
        value: 'vault',
        text: t('sync.sections.takeVault'),
        tooltip: t('sync.sections.takeVaultTip'),
        cta: true,
      },
    ]"
    @answer="(take) => answer(take as 'vault' | 'device')"
    @close="closeChoice"
  />
</template>

<script setup lang="ts">
/**
 * Abele's own settings, section by section, under Obsidian's "Plugin settings": which of them
 * this device takes from the others. Grouped the way the settings' left column and Transfer
 * group them, a page a row with how much of it is ticked, so twenty-odd sections fold into five.
 *
 * What a section needs is said by a code at the row's end, its words in the tooltip: a key it
 * points at, a key that cannot travel, a section it names that stays behind. What to do about
 * keys is said once, above the list.
 */
import { computed, ref } from 'vue'
import { Notice } from 'obsidian'
import { t } from '@/i18n'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import TreeItem from '../../obsidian/TreeItem.vue'
import GroupHeading from '../../obsidian/GroupHeading.vue'
import ChoiceModal from '../../obsidian/ChoiceModal.vue'
import { pageOf, pageTitles } from '@/transfer/pages'
import type { SectionId } from '@/transfer/types'
import type { AbeleSectionRow, AbeleSectionsSource } from '@/sync/abeleSections'
import { formatWhen } from '@/sync/format'

const props = defineProps<{
  source: AbeleSectionsSource
  /** Obsidian's "Plugin settings" switch: off, nothing of Abele's travels and the list rests. */
  pluginSettings: boolean
}>()

const chosen = computed(() => props.source.chosen.value)
const rows = computed(() => props.source.rows.value)
const rowOf = (id: SectionId) => rows.value.find((row) => row.id === id)
const labelOf = (id: SectionId) => rows.value.find((row) => row.id === id)?.label ?? id

const pages = computed(() =>
  pageTitles()
    .map((title) => ({ title, rows: rows.value.filter((row) => pageOf(row.id) === title) }))
    .filter((page) => page.rows.length)
)

const open = ref(new Set<string>())
const fold = (title: string) => {
  const next = new Set(open.value)
  if (!next.delete(title)) next.add(title)
  open.value = next
}
defineExpose({ fold })

const allOf = (list: AbeleSectionRow[]) => list.every((row) => chosen.value.has(row.id))
const someOf = (list: AbeleSectionRow[]) => list.some((row) => chosen.value.has(row.id))
const everything = computed(() => allOf(rows.value))

/** All of a page is its size alone; part of it is "2 of 7", the way Transfer counts. */
const countOf = (list: AbeleSectionRow[]) => {
  const count = list.filter((row) => chosen.value.has(row.id)).length
  return count === list.length
    ? String(list.length)
    : t('settings.TransferSettings.value_of_value.ca6c5e5f', {
        value0: String(count),
        value1: String(list.length),
      })
}
const chosenCount = computed(() => countOf(rows.value))

const missingNeeds = (row: AbeleSectionRow) =>
  (row.needs ?? []).filter((id) => !chosen.value.has(id))

const keyTrouble = (row: AbeleSectionRow) => props.source.keys.value !== 'on' || row.missing > 0
const keyIcon = () => (props.source.keys.value === 'locked' ? 'lock' : 'key-round')
const warned = (row: AbeleSectionRow) =>
  chosen.value.has(row.id) && (missingNeeds(row).length > 0 || (row.keys > 0 && keyTrouble(row)))

function keyTip(row: AbeleSectionRow): string {
  const keys = row.keys
  if (props.source.keys.value === 'off') return t('sync.sections.keyOff', { count: keys })
  if (props.source.keys.value === 'locked') return t('sync.sections.keyLocked', { count: keys })
  if (row.missing) return t('sync.sections.keyMissing', { count: row.missing, of: keys })
  return t('sync.sections.keyOn', { count: keys })
}

/** The one line about keys, when the ticked sections point at keys that cannot all travel. */
const keyLine = computed(() => {
  const ticked = rows.value.filter((row) => chosen.value.has(row.id) && row.keys > 0)
  if (!ticked.length) return null
  const keys = ticked.reduce((sum, row) => sum + row.keys, 0)
  const missing = ticked.reduce((sum, row) => sum + row.missing, 0)
  const state = props.source.keys.value
  if (state === 'off')
    return {
      name: t('sync.sections.keysOffName'),
      desc: t('sync.sections.keysOffDesc', { count: keys }),
      action: t('sync.sections.keysOffAction'),
    }
  if (state === 'locked')
    return {
      name: t('sync.sections.keysLockedName'),
      desc: t('sync.sections.keysLockedDesc', { count: keys }),
      action: t('sync.sections.keysLockedAction'),
    }
  if (missing)
    return {
      name: t('sync.sections.keysMissingName', { count: missing }),
      desc: t('sync.sections.keysMissingDesc'),
      action: '',
    }
  return null
})

const asking = ref<AbeleSectionRow | null>(null)
/** Standalone capture hosts can end together with their nested question. */
const emit = defineEmits<{ choiceClosed: [] }>()

function closeChoice(): void {
  asking.value = null
  emit('choiceClosed')
}

async function flip(row: AbeleSectionRow): Promise<void> {
  if (!props.pluginSettings) return
  if (chosen.value.has(row.id)) return props.source.choose(row.id, false)
  // Coming back after a while apart: the two copies may differ, and only the person knows which
  // one is right. Nothing to ask when they are the same.
  if (await props.source.differs(row.id)) asking.value = row
  else await props.source.choose(row.id, true)
}

async function answer(take: 'vault' | 'device'): Promise<void> {
  const row = asking.value
  if (!row) return
  await props.source.choose(row.id, true, take)
}

async function chooseMany(list: (AbeleSectionRow | undefined)[], on: boolean): Promise<void> {
  // Many at once never asks: a whole page coming back takes the vault's, as a new device does.
  for (const row of list)
    if (row && chosen.value.has(row.id) !== on) await props.source.choose(row.id, on, 'vault')
}
const chooseAll = (on: boolean) => chooseMany(rows.value, on)

const restoring = ref<SectionId | null>(null)
async function restore(id: SectionId): Promise<void> {
  restoring.value = id
  try {
    await props.source.restore(id)
    new Notice(t('sync.sections.restored', { section: labelOf(id) }))
  } finally {
    restoring.value = null
  }
}
</script>

<style lang="scss">
.abele-sections__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--size-4-2);
  margin-top: var(--size-4-4);
  margin-bottom: var(--size-2-2);

  .abele-group-heading {
    flex: 1;
    justify-content: flex-start;
  }

  .abele-group-heading__summary {
    color: var(--text-faint);
    font-weight: var(--font-normal);
  }
}

.abele-sections .abele-obsidian-button.abele-sections__all {
  flex: none;
  font-size: var(--font-ui-small);
  // The quiet button's end overhang would spend 6px of the reserved scrollbar clearance.
  margin-right: 0;
}

.abele-sections__tree {
  margin-bottom: var(--size-4-4);

  // A code at a page's end keeps the step glyphs keep from the count beside them.
  .abele-tree-item__flair + * {
    margin-inline-start: var(--size-4-2);
  }
}

// A finger's height on a phone, taken back by margins, as the "not synced" list does.
body.is-phone .abele-sections .abele-sections__all {
  min-height: var(--touch-size-l, 2.75rem);
  margin-block: calc((1lh - var(--touch-size-l, 2.75rem)) / 2);
}

// Resting with "Plugin settings" off: seen, so it is found, but not pressed.
.abele-sections__tree.is-disabled,
.abele-sections__head.is-disabled {
  opacity: var(--abele-disabled-opacity, 0.5);
}
</style>
