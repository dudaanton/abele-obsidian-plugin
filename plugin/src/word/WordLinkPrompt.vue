<template>
  <!-- The ribbon's link: the words it goes on, one field for the address, Link. A link already on
       them is shown to change, and can be taken off from here as well. -->
  <Modal title="Link" @close="emit('close')">
    <Setting name="Address" :desc="words ? `On «${words}»` : 'On the whole paragraph'">
      <Input
        ref="field"
        class="abele-word-link__field"
        :model-value="address"
        placeholder="https://"
        aria-label="Link address"
        @update:model-value="address = $event"
        @keydown.enter="submit"
      />
    </Setting>
    <template #footer>
      <div class="abele-word-link__foot">
        <Button
          v-if="current"
          text="Remove link"
          quiet
          tooltip="Take the link off, keep the words"
          @click="emit('link', '')"
        />
        <span class="abele-word-link__gap" />
        <Button text="Cancel" tooltip="Close without linking" @click="emit('close')" />
        <Button
          text="Link"
          accent
          :disabled="!ready"
          :tooltip="ready ? 'Link the words to this address' : 'Link: type an address first'"
          @click="submit"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
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
