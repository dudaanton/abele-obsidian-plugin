<template>
  <component
    :is="Platform.isMobile ? Modal : 'section'"
    v-if="state.shown"
    :title="Platform.isMobile ? t('repository.referencesTitle') : undefined"
    :size="Platform.isMobile ? 'tall' : undefined"
    @close="state.shown = false"
  >
    <section
      class="abele-github-search abele-node-references"
      :class="{ 'abele-node-references_phone': Platform.isMobile }"
      data-node-references
    >
      <div class="abele-node-references__header">
        <span class="abele-github-search__summary">{{ summary }}</span>
        <Icon
          v-if="!Platform.isMobile"
          icon="x"
          :tooltip="t('streamB.closeCodeSearch.22b261')"
          @click="state.shown = false"
        />
      </div>
      <div v-if="state.message" role="status">{{ state.message }}</div>
      <div v-else-if="!state.loading && !state.count" class="search-empty-state">
        {{ t('repository.noReferences') }}
      </div>
      <CodeSearchResults
        :files="state.files"
        references
        :active="state.active"
        :definitions="state.definitions"
        @open="open"
      />
      <div v-if="state.omitted" class="abele-github-search__summary">
        {{
          t('repository.referencesMore', {
            count: state.omitted,
            number: state.omitted.toLocaleString(),
          })
        }}
      </div>
      <div v-if="state.loading" class="abele-github-search__progress" role="status">
        {{ t('repository.findingReferences') }}
      </div>
    </section>
  </component>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { Platform } from 'obsidian'
import { t } from '@/i18n'
import type { ReferenceResults } from '@/node/referenceResults'
import type { LspLocation } from '@/node/NodeLspDocument'
import CodeSearchResults from '../github/CodeSearchResults.vue'
import Modal from '../obsidian/Modal.vue'
import Icon from '../obsidian/Icon.vue'
const props = defineProps<{ state: ReferenceResults }>()
const emit = defineEmits<{ open: [location: LspLocation] }>()
const summary = computed(() =>
  t('repository.referencesSummary', {
    references: t('repository.referencesCount', {
      count: props.state.count,
      number: props.state.count.toLocaleString(),
    }),
    files: t('repository.referencesFiles', {
      count: props.state.fileCount,
      number: props.state.fileCount.toLocaleString(),
    }),
  })
)
function open(key: string) {
  const location = props.state.locations[key]
  if (!location) return
  props.state.active = key
  if (Platform.isMobile) props.state.shown = false
  emit('open', location)
}
</script>
<style>
.abele-node-references {
  flex-shrink: 0;
}
.abele-node-references__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.abele-node-references .abele-fold-heading {
  display: flex;
}
.abele-node-references .abele-fold-heading__text {
  flex: 1 1 auto;
  min-width: 0;
}
.abele-node-references .abele-fold-heading__count {
  margin-inline-start: auto;
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-node-references .abele-github-search__line.is-active {
  background: var(--background-modifier-hover);
}
.abele-node-references .abele-github-search__text {
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}
.abele-node-references_phone .abele-github-search__results {
  max-height: none;
  overflow: visible;
}
</style>
