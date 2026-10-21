<template>
  <span
    v-if="device && device !== localDevice"
    class="abele-call-place"
    :title="t('node.tools.runner', { device })"
  >
    <Icon icon="monitor-smartphone" size="xs" :interactive="false" />
    <span>{{ t('node.tools.callPlace', { device }) }}</span>
  </span>
</template>
<script setup lang="ts">
import { obsidianDeviceName } from '@/node/obsidianDevice'
import { t } from '@/i18n'
import Icon from '../obsidian/Icon.vue'
defineProps<{ device?: string }>()
const localDevice = obsidianDeviceName()
</script>
<style lang="scss">
.abele-call-place {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  white-space: nowrap;
  min-width: 0;
  max-width: 45%;

  > .abele-obsidian-icon {
    flex-shrink: 0;
  }
  > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
