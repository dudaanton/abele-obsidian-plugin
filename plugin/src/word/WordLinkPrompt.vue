<template>
  <!-- The ribbon's link: the words it goes on, one field for the address, Link. A link already on
       them is shown to change, and can be taken off from here as well. -->
  <Modal :title="t('settings.CalendarsSettings.link.a6a32dbc')" @close="emit('close')">
    <Setting
      :name="t('settings.nodes.address')"
      :desc="
        words ? t('streamC.ad608dd2dd23cc0c', { v1: String(words) }) : t('streamC.3db686ec30bc2c1e')
      "
    >
      <Input
        ref="field"
        class="abele-word-link__field"
        :model-value="address"
        placeholder="https://"
        :aria-label="t('streamC.13844ffc728705a2')"
        @update:model-value="address = $event"
        @keydown.enter="submit"
      />
    </Setting>
    <template #footer>
      <div class="abele-word-link__foot">
        <Button
          v-if="current"
          :text="t('streamC.4953f897094826d3')"
          quiet
          :tooltip="t('streamC.c4c3db6cdb0f52b7')"
          @click="emit('link', '')"
        />
        <span class="abele-word-link__gap" />
        <Button
          :text="t('kit.cancel')"
          :tooltip="t('streamC.4756b05203a5e674')"
          @click="emit('close')"
        />
        <Button
          :text="t('settings.CalendarsSettings.link.a6a32dbc')"
          accent
          :disabled="!ready"
          :tooltip="ready ? t('streamC.3c7194acaa7d998d') : t('streamC.cca707d56b5cea7f')"
          @click="submit"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import { computed, onMounted, ref } from 'vue'
import Modal from '@/components/obsidian/Modal.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Input from '@/components/obsidian/Input.vue'
import Button from '@/components/obsidian/Button.vue'

const props = defineProps<{
  /** The selected words, cut short by the caller if long; none means the whole paragraph. */
  words?: string
  /** The address already on them. */
  current?: string
}>()
const emit = defineEmits<{ link: [url: string]; close: [] }>()

const address = ref(props.current ?? '')
const ready = computed(() => {
  const url = address.value.trim()
  return !!url && url !== props.current
})
// Leaving the field and pressing Link both send it; the window closes after the first.
let sent = false
const submit = () => {
  if (!ready.value || sent) return
  sent = true
  emit('link', address.value.trim())
}

const field = ref<InstanceType<typeof Input>>()
onMounted(() => {
  const el = field.value?.inputRef as HTMLInputElement | undefined
  el?.focus()
  el?.select()
})
</script>

<style lang="scss">
.abele-word-link__field {
  width: 100%;
}

.abele-word-link__foot {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  width: 100%;
}

.abele-word-link__gap {
  flex: 1 1 auto;
}
</style>
