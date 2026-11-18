<template>
  <div
    ref="root"
    class="abele-share-picker"
    :data-searching="phone && focused && !!query.trim()"
    :data-share-picker-mode="phone ? 'inline' : 'native'"
    :data-platform-phone="Platform.isPhone"
    :data-platform-mobile="Platform.isMobile"
    :data-source-count="choices.length"
    :data-source-paths="JSON.stringify(choices.slice(0, 10).map((item) => item.path))"
    :data-source-matches="
      JSON.stringify(
        choices
          .filter((item) => item.path.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 10)
          .map((item) => item.path)
      )
    "
  >
    <div v-if="modelValue.length" class="abele-share-picker__picked">
      <div
        v-for="item in modelValue"
        :key="item.kind + ':' + item.id"
        class="multi-select-pill abele-share-picker__pill"
        :class="{ 'is-faint': notes?.[item.id]?.faint }"
        :data-path="item.path"
      >
        <div class="multi-select-pill-content abele-share-picker__pill-content">
          <Icon :icon="itemGlyph(item)" no-hover class="abele-share-picker__glyph" />
          <span>{{ itemName(item) }}</span>
          <span v-if="notes?.[item.id] || itemPlace(item)" class="abele-share-picker__place">{{
            notes?.[item.id]?.text ?? itemPlace(item)
          }}</span>
        </div>
        <Icon
          icon="x"
          :disabled="disabled"
          :tooltip="`Take ${itemName(item)} out`"
          class="multi-select-pill-remove-button"
          @click="
            !disabled &&
            emit(
              'update:modelValue',
              modelValue.filter((one) => one.id !== item.id)
            )
          "
        />
      </div>
    </div>
    <!-- What the field finds, one kind at a time: the glyphs as Obsidian's search toggles. -->
    <div class="abele-share-picker__find">
      <div
        class="abele-share-picker__kinds"
        role="group"
        :aria-label="t('sync.scopePicker.findKind')"
      >
        <Icon
          v-for="one in KINDS"
          :key="one.kind"
          :data-scope-kind="one.kind"
          :icon="one.icon"
          :tooltip="one.tooltip"
          :active="kind === one.kind"
          :disabled="full || disabled"
          @click="switchKind(one.kind)"
        />
      </div>
      <Search
        :model-value="phone ? query : ''"
        :placeholder="
          full
            ? (fullText ?? `A share holds up to ${SHARE_LIMIT} items`)
            : (placeholder ?? t(`sync.scopePicker.${kind}.add`))
        "
        :make-suggest="phone ? undefined : makeSuggest"
        :disabled="full || disabled"
        :autofocus="autofocus"
        :label="t(`sync.scopePicker.${kind}.find`)"
        @update:model-value="query = $event"
        @focusin="focused = true"
        @focusout="focused = false"
      />
    </div>
    <!-- Keep phone results in the sheet's scrollable body, never in a second native drawer. -->
    <div
      v-if="phone && focused && !full && !disabled"
      ref="list"
      class="suggestion abele-share-picker__results"
      role="listbox"
      :aria-label="t(`sync.scopePicker.${kind}.title`)"
      data-keeps-focus
      @scroll="updateMore"
    >
      <EmptyState
        v-if="!results.length"
        variant="no-matches"
        :text="t(`sync.scopePicker.${kind}.empty`)"
      />
      <div
        v-for="item in results"
        :key="item.kind + ':' + item.id"
        class="suggestion-item mod-complex"
        :data-share-kind="item.kind"
        :data-share-path="item.path"
        role="option"
        :aria-selected="false"
        :aria-disabled="!!coveredBy(item, covers())"
        :class="{ 'is-disabled': !!coveredBy(item, covers()) }"
        tabindex="0"
        @mousedown.prevent
        @click="pick(item)"
        @keydown.enter.prevent="pick(item)"
      >
        <SuggestionRow
          :icon="itemGlyph(item)"
          :title="itemName(item)"
          :note="item.kind === 'vault' ? (vaultNote ?? 'For your own devices') : itemPlace(item)"
          :title-class="coveredBy(item, covers()) ? 'abele-share-pick__covered' : undefined"
          :aux="
            coveredBy(item, covers())
              ? [
                  {
                    flair: 'In ' + itemName(coveredBy(item, covers())!),
                    cls: 'abele-share-pick__in',
                  },
                ]
              : membersOf(item)
                ? [{ flair: membersOf(item)!, cls: 'abele-share-pick__in' }]
                : undefined
          "
        />
      </div>
    </div>
    <p
      v-if="phone && focused && !full && !disabled && moreResults"
      class="setting-item-description abele-share-picker__more"
    >
      {{ t('sync.scrollResults') }}
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * What goes into a share: Obsidian's pills above the field, each the item's kind as a glyph, its
 * name and where it lies, with a way to take it out; the field finds more by typing. Full at
 * `SHARE_LIMIT`, the field goes quiet and says why.
 */
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { t } from '@/i18n'
import { Platform } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import Search from '../obsidian/Search.vue'
import SuggestionRow from '../obsidian/SuggestionRow.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { ShareItemSuggest, matchingShareItems } from '@/helpers/suggesters/ShareItemSuggest'
import { KEYBOARD_EVENTS, fullHeight, keyboardVar } from '@/modal/keyboard'
import { revealDelta, KEYBOARD_GAP } from '@/modal/keyboardLift'
import {
  SHARE_LIMIT,
  coveredBy,
  itemGlyph,
  itemName,
  itemPlace,
  type ShareItem,
} from '@/sync/shareSets'

const props = defineProps<{
  modelValue: ShareItem[]
  choices: ShareItem[]
  /** Already in the share, beside what is being picked now: covered the same way. */
  inShare?: ShareItem[]
  placeholder?: string
  /** How many notes name this one as their group, said beside each group: 0 is «no notes yet». */
  members?: (item: ShareItem) => number | undefined
  /** The whole vault is a default to replace, not a choice that covers the rest. */
  vaultGivesWay?: boolean
  /** The vault's quiet words in the list; unset, it is for your own devices. */
  vaultNote?: string
  /** The field's words once full, where the picker is not a share. */
  fullText?: string
  /** Quiet words in a chosen item's pill instead of where it lies; faint when it is gone. */
  notes?: Record<string, { text: string; faint?: boolean }>
  disabled?: boolean
  autofocus?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [items: ShareItem[]]
  searching: [active: boolean]
}>()

const taken = () => [...(props.inShare ?? []), ...props.modelValue]
const membersOf = (item: ShareItem) => {
  const n = item.kind === 'group' ? props.members?.(item) : undefined
  if (n === undefined) return ''
  return n ? t('sync.scopePicker.noteCount', { count: n }) : t('sync.scopePicker.noNotes')
}

type FindKind = 'folder' | 'group' | 'file'
const KINDS: { kind: FindKind; icon: string; tooltip: string }[] = [
  { kind: 'folder', icon: 'folder', tooltip: t('sync.scopePicker.folder.tip') },
  { kind: 'group', icon: 'group', tooltip: t('sync.scopePicker.group.tip') },
  { kind: 'file', icon: 'file', tooltip: t('sync.scopePicker.file.tip') },
]
const kind = ref<FindKind>('folder')
/** The vault is listed with the folders: it is the folder above them all. */
const ofKind = (item: ShareItem) =>
  item.kind === kind.value || (kind.value === 'folder' && item.kind === 'vault')
const shown = computed(() => props.choices.filter(ofKind))
/** Lists the other kind at once, for what is already typed. */
function switchKind(next: FindKind) {
  kind.value = next
  const input = root.value?.querySelector('input')
  if (!input) return
  input.focus()
  if (!phone) input.dispatchEvent(new Event('input'))
}
/** With `vaultGivesWay`, a chosen vault holds nothing back: picking anything replaces it. */
const covers = () => (props.vaultGivesWay ? taken().filter((one) => one.kind !== 'vault') : taken())
const full = computed(() => taken().length >= SHARE_LIMIT)
// Use the host's mobile layout as well as its narrower phone flag, like the dialog shell.
const phone =
  Platform.isPhone ||
  Platform.isMobile ||
  document.body.classList.contains('is-mobile') ||
  document.body.classList.contains('is-phone')
const query = ref('')
const focused = ref(false)
const moreResults = ref(false)
function updateMore() {
  const el = list.value
  moreResults.value = !!el && el.scrollHeight > el.clientHeight + el.scrollTop + 1
}
watch([focused, query], () => emit('searching', phone && focused.value && !!query.value.trim()))
const list = ref<HTMLElement>()
let listObserver: ResizeObserver | undefined
watch(list, (element) => {
  listObserver?.disconnect()
  if (element && typeof ResizeObserver !== 'undefined') {
    listObserver = new ResizeObserver(updateMore)
    listObserver.observe(element)
  }
  void nextTick(updateMore)
})
const root = ref<HTMLElement>()
const results = computed(() =>
  matchingShareItems(shown.value, taken(), query.value, props.vaultGivesWay)
)
const pick = (item: ShareItem) => {
  if (props.disabled || full.value || coveredBy(item, covers())) return
  emit(
    'update:modelValue',
    item.kind === 'vault'
      ? [item]
      : [...props.modelValue.filter((one) => one.kind !== 'vault'), item]
  )
  query.value = ''
}
// Use the sheet's existing keyboard scroll room, including when the keyboard finishes opening.
const reveal = () => {
  void nextTick(() => {
    const row = list.value?.firstElementChild
    const field = root.value?.querySelector('input')
    const box = root.value?.closest('.modal-content')
    const view = root.value?.ownerDocument.defaultView
    if (!row || !field || !box || !view) return
    row.scrollIntoView({ block: 'nearest' })
    const bounds = box.getBoundingClientRect()
    const viewport = view.visualViewport
    const floor = Math.min(
      bounds.bottom,
      fullHeight(view) - keyboardVar(field.ownerDocument),
      viewport ? viewport.offsetTop + viewport.height : view.innerHeight
    )
    const delta = revealDelta(
      { top: field.getBoundingClientRect().top, bottom: row.getBoundingClientRect().bottom },
      Math.max(bounds.top, viewport?.offsetTop ?? 0) + KEYBOARD_GAP,
      floor - KEYBOARD_GAP
    )
    box.scrollTop += delta
    updateMore()
  })
}
watch([results, focused], reveal)
let win: Window | null = null
onMounted(() => {
  if (!phone) return
  win = root.value?.ownerDocument.defaultView ?? null
  if (!win) return
  for (const event of KEYBOARD_EVENTS) win.addEventListener(event, reveal)
  win.visualViewport?.addEventListener('resize', reveal)
})
onBeforeUnmount(() => {
  listObserver?.disconnect()
  for (const event of KEYBOARD_EVENTS) win?.removeEventListener(event, reveal)
  win?.visualViewport?.removeEventListener('resize', reveal)
})

const makeSuggest = (inputEl: HTMLInputElement) =>
  new ShareItemSuggest(GlobalStore.getInstance().app, inputEl, {
    choices: () => shown.value,
    taken,
    covers,
    vaultNote: props.vaultNote,
    members: membersOf,
    replaceWithVault: props.vaultGivesWay,
    onPick: pick,
  })
</script>

<style lang="scss">
.abele-share-picker {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
}

.abele-share-picker__picked {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
}

.abele-share-picker__results {
  max-height: var(--popover-max-height);
  overflow-y: auto;
  flex-shrink: 0;
}

// A pill holds a name and where it lies; long paths wrap inside it rather than past the field.
.abele-share-picker__pill {
  max-width: 100%;
  height: auto;
}

.abele-share-picker__pill-content {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--size-4-1);
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

.abele-share-picker__find {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  min-width: 0;

  > .abele-obsidian-search {
    flex: 1 1 auto;
    min-width: 0;
  }
}

.abele-share-picker__kinds {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--size-2-1);
}

// Chosen once and gone from this vault since: kept, faint, its note says so.
.abele-share-picker__pill.is-faint .abele-share-picker__pill-content {
  color: var(--text-faint);
}

.abele-share-picker__glyph {
  --icon-size: var(--icon-xs);
  color: var(--text-muted);
}

.abele-share-picker__place {
  color: var(--text-faint);
  font-size: var(--font-smallest);
}

// A picker row already inside a folder of the share: there, faint, and not taken.
.suggestion-item.is-disabled {
  cursor: default;

  .abele-share-pick__covered {
    color: var(--text-faint);
  }
}

.abele-share-pick__in {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
</style>
