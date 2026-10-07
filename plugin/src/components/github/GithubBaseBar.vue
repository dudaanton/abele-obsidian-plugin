<template>
  <div class="abele-github-base">
    <template v-if="pin">
      <Badge :text="`Base: ${pin.enteredRef} · ${pin.baseSha.slice(0, 7)}`" :title="pin.baseSha" />
      <Badge v-if="targetSha" :text="`Target: ${targetSha.slice(0, 7)}`" :title="targetSha" />
      <Button
        text="Change base"
        icon="git-compare"
        tooltip="Choose another frozen comparison base"
        @click="choose"
      />
      <Button
        text="Unpin"
        icon="pin-off"
        tooltip="Restore original repository file views"
        @click="pins.unpin(repo)"
      />
      <Button
        v-if="file"
        :text="original ? 'Show comparison' : 'Original file'"
        icon="file-text"
        tooltip="Switch this tab only, keeping the repository base"
        @click="emit('original', !original)"
      />
    </template>
    <Button
      v-else
      text="Compare against…"
      icon="git-compare"
      tooltip="Pin a comparison base for this repository on this device"
      @click="choose"
    />
  </div>
</template>
<script setup lang="ts">
import Button from '../obsidian/Button.vue'
import Badge from '../obsidian/Badge.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { basePins, type BasePin, type Repository } from '@/github/comparison/pins'
import { BasePicker } from '@/github/comparison/BasePicker'
import type { GithubClient } from '@/github/client'
const props = defineProps<{
  repo: Repository
  client: GithubClient
  pin: BasePin | null
  targetSha?: string
  file: boolean
  original?: boolean
}>()
const emit = defineEmits<{ original: [value: boolean] }>()
const app = GlobalStore.getInstance().app,
  pins = basePins(app)
const choose = () => new BasePicker(app, props.client, props.repo).open()
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
