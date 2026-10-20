<template>
  <Modal
    :title="t('debug.launchTitle')"
    size="tall"
    close-in-footer
    :can-close="() => !busy"
    @close="emit('close')"
  >
    <Section>
      <Setting :name="t('debug.launchProgram')" :desc="t('debug.launchProgramHint')">
        <Input v-model="path" :disabled="busy" :aria-label="t('debug.launchProgram')" />
      </Setting>
      <Setting :name="t('debug.launchArgs')" :desc="t('debug.launchArgsHint')">
        <Input v-model="argumentsText" :disabled="busy" :aria-label="t('debug.launchArgs')" />
      </Setting>
      <p v-if="error" role="alert" class="abele-debug-launch__error mod-warning">{{ error }}</p>
    </Section>
    <template #footer>
      <Button :text="t('kit.cancel')" :disabled="busy" @click="emit('close')" />
      <Button accent :text="t('debug.launchTitle')" :disabled="busy || !path.trim()" @click="run" />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { t } from '@/i18n'
import Modal from '@/components/obsidian/Modal.vue'
import Section from '@/components/obsidian/Section.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Input from '@/components/obsidian/Input.vue'
import Button from '@/components/obsidian/Button.vue'
import { parseLaunchArguments } from './launchArguments'
import { z } from 'zod'

const DiagnosticsSchema = z.object({
  details: z.object({ stdout: z.string().optional(), stderr: z.string().optional() }).optional(),
})

const props = defineProps<{
  program: string
  launch: (path: string, argv: string[]) => Promise<unknown>
}>()
const emit = defineEmits<{ close: [] }>()
const path = ref(props.program)
const argumentsText = ref('')
const busy = ref(false)
const error = ref('')
async function run() {
  if (busy.value) return
  error.value = ''
  let argv: string[]
  try {
    argv = parseLaunchArguments(argumentsText.value)
  } catch {
    error.value = t('debug.launchArgsInvalid')
    return
  }
  busy.value = true
  try {
    await props.launch(path.value.trim(), argv)
    emit('close')
  } catch (e) {
    console.debug('[debugger] Program not started', e)
    const diagnostics = DiagnosticsSchema.safeParse(e)
    const output = diagnostics.success ? diagnostics.data.details : undefined
    error.value = t('debug.launchFailed', {
      detail: [e instanceof Error ? e.message : String(e), output?.stdout, output?.stderr]
        .filter(Boolean)
        .join('\n'),
    })
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.abele-debug-launch__error {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
