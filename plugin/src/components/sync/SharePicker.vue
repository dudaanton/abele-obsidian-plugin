<template>
  <div
    ref="root"
    class="abele-share-picker"
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
        :data-path="item.path"
      >
        <div class="multi-select-pill-content abele-share-picker__pill-content">
          <Icon :icon="itemGlyph(item)" no-hover class="abele-share-picker__glyph" />
          <span>{{ itemName(item) }}</span>
          <span v-if="itemPlace(item)" class="abele-share-picker__place">{{
            itemPlace(item)
          }}</span>
        </div>
        <Icon
          icon="x"
          :tooltip="`Take ${itemName(item)} out`"
          class="multi-select-pill-remove-button"
          @click="
            emit(
              'update:modelValue',
              modelValue.filter((one) => one.id !== item.id)
            )
          "
        />
      </div>
    </div>
    <Search
      :model-value="phone ? query : ''"
      :placeholder="full ? `A share holds up to ${SHARE_LIMIT} items` : placeholder"
      :make-suggest="phone ? undefined : makeSuggest"
      :disabled="full || disabled"
      :autofocus="autofocus"
      label="Find a folder, group or file"
      @update:model-value="query = $event"
      @focusin="focused = true"
      @focusout="focused = false"
    />
    <!-- Keep phone results in the sheet's scrollable body, never in a second native drawer. -->
    <div
      v-if="phone && focused && !full && !disabled"
      ref="list"
      class="suggestion abele-share-picker__results"
      role="listbox"
      aria-label="Folders, groups and files"
      data-keeps-focus
    >
      <EmptyState
        v-if="!results.length"
        variant="no-matches"
        text="No matching folders, groups or files."
      />
      <div
        v-for="item in results"
        :key="item.kind + ':' + item.id"
        class="suggestion-item mod-complex"
        :data-share-kind="item.kind"
        :data-share-path="item.path"
        role="option"
        :aria-selected="false"
        :aria-disabled="!!coveredBy(item, taken())"
        :class="{ 'is-disabled': !!coveredBy(item, taken()) }"
        tabindex="0"
        @mousedown.prevent
        @click="pick(item)"
        @keydown.enter.prevent="pick(item)"
      >
        <SuggestionRow
          :icon="itemGlyph(item)"
          :title="itemName(item)"
          :note="item.kind === 'vault' ? 'For your own devices' : itemPlace(item)"
          :title-class="coveredBy(item, taken()) ? 'abele-share-pick__covered' : undefined"
          :aux="
            coveredBy(item, taken())
              ? [
                  {
                    flair: 'In ' + itemName(coveredBy(item, taken())!),
                    cls: 'abele-share-pick__in',
                  },
                ]
              : undefined
          "
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * What goes into a share: Obsidian's pills above the field, each the item's kind as a glyph, its
 * name and where it lies, with a way to take it out; the field finds more by typing. Full at
 * `SHARE_LIMIT`, the field goes quiet and says why.
 */
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
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
  disabled?: boolean
  autofocus?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [items: ShareItem[]] }>()

const taken = () => [...(props.inShare ?? []), ...props.modelValue]
const full = computed(() => taken().length >= SHARE_LIMIT)
// Use the host's mobile layout as well as its narrower phone flag, like the dialog shell.
const phone =
  Platform.isPhone ||
  Platform.isMobile ||
  document.body.classList.contains('is-mobile') ||
  document.body.classList.contains('is-phone')
const query = ref('')
const focused = ref(false)
const list = ref<HTMLElement>()
const root = ref<HTMLElement>()
const results = computed(() => matchingShareItems(props.choices, taken(), query.value))
const pick = (item: ShareItem) => {
  if (props.disabled || full.value || coveredBy(item, taken())) return
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
  for (const event of KEYBOARD_EVENTS) win?.removeEventListener(event, reveal)
  win?.visualViewport?.removeEventListener('resize', reveal)
})

const makeSuggest = (inputEl: HTMLInputElement) =>
  new ShareItemSuggest(GlobalStore.getInstance().app, inputEl, {
    choices: () => props.choices,
    taken,
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
