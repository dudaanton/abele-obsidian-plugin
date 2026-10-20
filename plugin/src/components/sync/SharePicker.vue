<template>
  <div class="abele-share-picker">
    <div v-if="modelValue.length" class="abele-share-picker__picked">
      <div
        v-for="item in modelValue"
        :key="item.id"
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
      :model-value="''"
      :placeholder="full ? `A share holds up to ${SHARE_LIMIT} items` : placeholder"
      :make-suggest="makeSuggest"
      :disabled="full || disabled"
      :autofocus="autofocus"
      label="Find a folder, group or file"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * What goes into a share: Obsidian's pills above the field, each the item's kind as a glyph, its
 * name and where it lies, with a way to take it out; the field finds more by typing. Full at
 * `SHARE_LIMIT`, the field goes quiet and says why.
 */
import { computed } from 'vue'
import Icon from '../obsidian/Icon.vue'
import Search from '../obsidian/Search.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { ShareItemSuggest } from '@/helpers/suggesters/ShareItemSuggest'
import { SHARE_LIMIT, itemGlyph, itemName, itemPlace, type ShareItem } from '@/sync/shareSets'

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

const makeSuggest = (inputEl: HTMLInputElement) =>
  new ShareItemSuggest(GlobalStore.getInstance().app, inputEl, {
    choices: () => props.choices,
    taken,
    onPick: (item) =>
      emit(
        'update:modelValue',
        item.kind === 'vault'
          ? [item]
          : [...props.modelValue.filter((one) => one.kind !== 'vault'), item]
      ),
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
