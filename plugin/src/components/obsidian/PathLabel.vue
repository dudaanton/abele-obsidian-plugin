<template>
  <Disclosure
    v-if="mode !== 'full' && mode !== 'file' && expandable"
    v-model="opened"
    class="abele-path-label abele-path-label_expandable"
    :class="{ 'abele-path-label_missing': missing }"
    :label="compact"
  >
    <template #label
      ><span class="abele-path-label__path">{{ compact }}</span
      ><span v-if="missing" class="abele-path-label__state">{{
        t('kit.deviceMissing')
      }}</span></template
    >
    <span v-if="workspace" class="abele-path-label__workspace">{{
      t('kit.workspace', { name: workspace })
    }}</span>
    <div class="abele-path-label__full">{{ path }}</div>
    <div class="abele-path-label__actions">
      <Icon
        v-if="copyable"
        icon="copy"
        :tooltip="t('kit.copyPath')"
        @click="emit('copy', path)"
      /><Icon
        v-if="revealable"
        icon="folder"
        :tooltip="t('kit.reveal')"
        :disabled="missing"
        :disabled-reason="t('kit.targetMissing')"
        @click="emit('reveal', path)"
      />
    </div>
  </Disclosure>
  <span
    v-else
    class="abele-path-label"
    :class="{ 'abele-path-label_missing': missing, 'abele-path-label_full': mode === 'full' }"
    ><span v-if="workspace" class="abele-path-label__workspace">{{
      t('kit.workspace', { name: workspace })
    }}</span
    ><template v-if="mode === 'file'"
      ><span v-if="folder" class="abele-path-label__folder">{{ folder }}</span
      ><span class="abele-path-label__filename">{{ filename }}</span></template
    >
    <span
      v-else
      class="abele-path-label__path"
      :class="{ 'abele-path-label__full': mode === 'full' }"
      >{{ mode === 'full' ? path : compact }}</span
    ><span v-if="missing" class="abele-path-label__state">{{ t('kit.deviceMissing') }}</span></span
  >
</template>
<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import Disclosure from './Disclosure.vue'
import Icon from './Icon.vue'
const props = withDefaults(
  defineProps<{
    path: string
    mode?: 'basename' | 'context' | 'full' | 'file'
    workspace?: string
    missing?: boolean
    copyable?: boolean
    revealable?: boolean
    expandable?: boolean
  }>(),
  { mode: 'context', expandable: true }
)
const emit = defineEmits<{ copy: [path: string]; reveal: [path: string] }>()
// Folded to its folder, unfolded to the whole path and what can be done with it: the kit's own
// fold, as every list title's, not one of its own.
const opened = ref(false)
const folder = computed(() =>
  props.path.slice(0, Math.max(props.path.lastIndexOf('/'), props.path.lastIndexOf('\\')) + 1)
)
const filename = computed(() => props.path.slice(folder.value.length))
const compact = computed(() => {
  const index = Math.max(props.path.lastIndexOf('/'), props.path.lastIndexOf('\\'))
  return props.mode === 'basename'
    ? props.path.slice(index + 1) || props.path
    : index < 0
      ? t('kit.vaultRoot')
      : props.path.slice(0, index) || props.path.slice(0, 1)
})
</script>
<style>
.abele-path-label__folder {
  color: var(--text-muted);
  margin-inline-end: var(--size-4-1);
}
.abele-path-label__filename {
  color: var(--text-normal);
}
.abele-path-label {
  min-width: 0;
  color: var(--abele-text-meta-color);
  font-size: var(--abele-text-meta-size);
  overflow-wrap: anywhere;
}
.abele-path-label__workspace,
.abele-path-label__state {
  display: block;
}
/* Folded, the missing file is said on the same line as its folder, so it is seen unopened. */
.abele-fold-heading__text > .abele-path-label__state {
  display: inline;
}
.abele-fold-heading__text > .abele-path-label__state::before {
  content: ' · ';
}
.abele-path-label__full {
  display: block;
  user-select: text;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.abele-path-label__actions {
  display: flex;
  gap: var(--size-4-1);
}
</style>
