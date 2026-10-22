<template>
  <Disclosure
    class="abele-node-bypass-help"
    :label="t('streamB.permissionNodeOptIn')"
    v-model="expanded"
  >
    <div class="abele-node-bypass-command">
      <Input :model-value="command" readonly :aria-label="t('streamB.permissionNodeOptIn')" />
      <Icon icon="copy" :tooltip="t('streamB.permissionCopyCommand')" @click="copy" />
    </div>
  </Disclosure>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { t } from '@/i18n'
import Disclosure from './obsidian/Disclosure.vue'
import Input from './obsidian/Input.vue'
import Icon from './obsidian/Icon.vue'
const expanded = ref(false)
const command = 'abele-node service flags set --allow-bypass on'
const copy = () => navigator.clipboard.writeText(command)
</script>
<style scoped>
.abele-node-bypass-help {
  width: 100%;
  min-width: 0;
}
.abele-node-bypass-command :deep(.abele-obsidian-input) {
  flex: 1;
  min-width: 0;
}
.abele-node-bypass-command {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}
.abele-node-bypass-command :deep(input) {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
</style>
