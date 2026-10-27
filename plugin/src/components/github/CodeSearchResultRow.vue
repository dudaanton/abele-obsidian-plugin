<template>
  <div
    class="abele-github-search__line"
    :class="{ 'is-active': active }"
    :data-reference-row="references ? line.url : undefined"
    role="button"
    tabindex="0"
    :aria-current="active ? 'location' : undefined"
    @click="emit('open', $event)"
    @keydown.enter="emit('open', $event)"
  >
    <span class="abele-github-search__number">{{ line.label }}</span>
    <Icon
      v-if="definition"
      icon="locate"
      size="xs"
      :interactive="false"
      :tooltip="t('repository.referenceDefinition')"
      :title="t('repository.referenceDefinition')"
    />
    <code class="abele-github-search__text"
      >{{ before
      }}<mark
        :class="references ? 'search-result-file-matched-text' : 'abele-github-search__match'"
        >{{ match }}</mark
      >{{ after }}</code
    >
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { ResultLine } from '@/repository/model'
import Icon from '../obsidian/Icon.vue'
import { t } from '@/i18n'
const props = defineProps<{
  line: ResultLine
  active?: boolean
  definition?: boolean
  references?: boolean
}>()
const emit = defineEmits<{ open: [event: MouseEvent | KeyboardEvent] }>()
const before = computed(() =>
  props.line.column < 0 || !props.line.length
    ? props.line.text
    : props.line.text.slice(0, props.line.column)
)
const match = computed(() =>
  props.line.column < 0
    ? ''
    : props.line.text.slice(props.line.column, props.line.column + props.line.length)
)
const after = computed(() =>
  props.line.column < 0 || !props.line.length
    ? ''
    : props.line.text.slice(props.line.column + props.line.length)
)
</script>
