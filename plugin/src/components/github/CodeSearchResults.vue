<template>
  <div class="abele-github-search__results">
    <div
      v-for="(file, index) in files"
      :key="file.path"
      class="abele-github-search__file"
      :data-reference-file="references ? file.path : undefined"
    >
      <Disclosure
        v-if="references"
        :model-value="expanded(file.path, index)"
        :label="file.path"
        :count="file.lines.length"
        @update:model-value="toggle(file.path, $event)"
      >
        <template #label><PathLabel :path="file.path" mode="full" :expandable="false" /></template>
        <template v-for="line in file.lines" :key="line.url">
          <ResultRow
            :line="line"
            references
            :active="active === line.url"
            :definition="definitions.includes(line.url)"
            @open="emit('open', line.url, $event)"
          />
        </template>
      </Disclosure>
      <template v-else>
        <div
          class="abele-github-search__path"
          role="button"
          tabindex="0"
          @click="emit('open', file.url, $event)"
          @keydown.enter="emit('open', file.url, $event)"
        >
          <span>{{ file.path }}</span
          ><Badge v-if="file.lines.length" :text="String(file.lines.length)" />
        </div>
        <ResultRow
          v-for="(line, i) in file.lines"
          :key="i"
          :line="line"
          @open="emit('open', line.url, $event)"
        />
      </template>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import type { ResultFile } from '@/repository/model'
import Disclosure from '../obsidian/Disclosure.vue'
import PathLabel from '../obsidian/PathLabel.vue'
import Badge from '../obsidian/Badge.vue'
import ResultRow from './CodeSearchResultRow.vue'
withDefaults(
  defineProps<{
    files: ResultFile[]
    references?: boolean
    active?: string
    definitions?: string[]
  }>(),
  { definitions: () => [], active: undefined }
)
const emit = defineEmits<{ open: [url: string, event: MouseEvent | KeyboardEvent] }>()
const folds = ref<Record<string, boolean>>({})
const expanded = (path: string, index: number) => folds.value[path] ?? index < 12
function toggle(path: string, open: boolean) {
  folds.value = { ...folds.value, [path]: open }
}
</script>
