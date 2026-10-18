<template>
  <!-- Only while a base is pinned: choosing one is a glyph in the header, nothing to show here. -->
  <div v-if="pin" class="abele-github-base">
    <template v-if="pin">
      <Badge
        :text="t('repository.base', { ref: pin.enteredRef, sha: pin.baseSha.slice(0, 7) })"
        :title="pin.baseSha"
      />
      <Badge
        v-if="targetSha"
        :text="t('repository.target', { sha: targetSha.slice(0, 7) })"
        :title="targetSha"
      />
      <Button
        :text="t('repository.changeBase')"
        icon="git-compare"
        :tooltip="t('repository.chooseBase')"
        @click="choose"
      />
      <Button
        :text="t('repository.unpin')"
        icon="pin-off"
        :tooltip="t('repository.restoreViews')"
        @click="pins.unpin(repo, source?.identity)"
      />
      <Button
        v-if="file"
        :text="original ? t('repository.showComparison') : t('repository.originalFile')"
        icon="file-text"
        :tooltip="t('repository.switchTab')"
        @click="emit('original', !original)"
      />
    </template>
  </div>
</template>
<script setup lang="ts">
import { t } from '@/i18n'
import Button from '../obsidian/Button.vue'
import Badge from '../obsidian/Badge.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { basePins, type BasePin, type Repository } from '@/github/comparison/pins'
import { BasePicker } from '@/github/comparison/BasePicker'
import type { GithubClient } from '@/github/client'
import { useRepositorySource } from '@/repository/context'
const props = defineProps<{
  repo: Repository
  client?: GithubClient
  pin: BasePin | null
  targetSha?: string
  file: boolean
  original?: boolean
}>()
const emit = defineEmits<{ original: [value: boolean] }>()
const app = GlobalStore.getInstance().app,
  pins = basePins(app)
const source = useRepositorySource(
  () => props.client,
  () => props.repo
)
const choose = () => new BasePicker(app, source.value, props.repo).open()
defineExpose({ choose })
</script>
<style lang="scss">
.abele-github-base {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
  min-width: 0;
  > * {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  button {
    height: auto;
    min-height: var(--input-height);
  }
}
.abele-github-base-picker .suggestion-note {
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
