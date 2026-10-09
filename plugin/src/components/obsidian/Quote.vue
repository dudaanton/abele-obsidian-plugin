<template>
  <figure class="abele-quote">
    <blockquote
      class="abele-quote__text"
      :class="{ 'abele-quote__text_preview': long && !expanded }"
    >
      {{ text || 'No quoted text' }}
    </blockquote>
    <figcaption v-if="source || unresolved" class="abele-quote__source">
      {{ source }}<template v-if="unresolved"> · Source unavailable</template>
    </figcaption>
    <Icon
      v-if="long"
      :icon="expanded ? 'minus' : 'plus'"
      :text-right="expanded ? 'Collapse quote' : 'Expand quote'"
      :tooltip="expanded ? 'Collapse quote' : 'Expand quote'"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    />
  </figure>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue'
import Icon from './Icon.vue'
const props = defineProps<{ text: string; source?: string; unresolved?: boolean }>()
const expanded = ref(false)
const long = computed(() => props.text.length > 240 || props.text.split('\n').length > 3)
</script>
<style>
.abele-quote {
  margin: 0;
  min-width: 0;
}
.abele-quote__text {
  font-family: var(--font-text);
  font-size: var(--font-ui-small);
  line-height: var(--line-height-normal);
  color: var(--text-normal);
  border-inline-start: var(--size-2-1) solid var(--background-modifier-border);
  padding-inline-start: var(--size-4-3);
  margin: 0 0 var(--size-4-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
.abele-quote__text_preview {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
.abele-quote__source {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  overflow-wrap: anywhere;
}
</style>
