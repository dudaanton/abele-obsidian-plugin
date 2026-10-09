<template>
  <figure class="abele-quote">
    <EmptyState v-if="!text" text="No quoted text" />
    <blockquote
      v-else-if="!long || !expanded"
      :id="textId"
      class="abele-quote__text"
      :class="{ 'abele-quote__text_preview': long && !expanded }"
    >
      {{ text || 'No quoted text' }}
    </blockquote>
    <Disclosure
      v-if="long"
      v-model="expanded"
      :target-id="textId"
      :label="expanded ? 'Collapse quote' : 'Expand quote'"
      ><blockquote class="abele-quote__text">{{ text }}</blockquote></Disclosure
    >
    <figcaption v-if="source || unresolved" class="abele-quote__source">
      {{ source
      }}<template v-if="unresolved"
        ><template v-if="source"> · </template>Source unavailable</template
      >
    </figcaption>
  </figure>
</template>
<script setup lang="ts">
import { ref, computed, useId } from 'vue'
import Disclosure from './Disclosure.vue'
import EmptyState from './EmptyState.vue'
const props = defineProps<{ text: string; source?: string; unresolved?: boolean }>()
const expanded = ref(false)
const textId = `abele-quote-${useId()}`
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
  padding-inline-start: var(--size-4-2);
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
