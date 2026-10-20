<template>
  <Modal
    :title="t('debug.launchTitle')"
    :size="Platform.isMobile ? 'tall' : 'default'"
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
      <Setting v-if="stopOnEntrySupported" :name="t('debug.stopAtStart')">
        <Checkbox
          :is-enabled="stopAtStart"
          :disabled="busy"
          :aria-label="t('debug.stopAtStart')"
          @toggle="stopAtStart = !stopAtStart"
        />
      </Setting>
      <div v-if="error" role="alert" class="mod-warning">
        <p>{{ error }}</p>
        <p v-if="output" class="abele-debug-launch__error">{{ output }}</p>
      </div>
      <Disclosure v-if="technical" v-model="expanded" :label="t('kit.details')">
        <pre class="abele-debug-launch__error">{{ technical }}</pre>
      </Disclosure>
    </Section>
    <template #footer>
      <Button :text="t('kit.cancel')" :disabled="busy" @click="emit('close')" />
      <Button accent :text="t('debug.launchTitle')" :disabled="busy || !path.trim()" @click="run" />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Platform } from 'obsidian'
import { t } from '@/i18n'
import Modal from '@/components/obsidian/Modal.vue'
import Section from '@/components/obsidian/Section.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Input from '@/components/obsidian/Input.vue'
import Button from '@/components/obsidian/Button.vue'
import Disclosure from '@/components/obsidian/Disclosure.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import { parseLaunchArguments } from './launchArguments'
import { z } from 'zod'

const DiagnosticsSchema = z.object({
  code: z.string().optional(),
  details: z.object({ stdout: z.string().optional(), stderr: z.string().optional() }).optional(),
})

const props = defineProps<{
  program: string
  launch: (path: string, argv: string[], stopOnEntry?: boolean) => Promise<unknown>
  stopOnEntrySupported?: boolean
  argumentsFor?: (path: string) => string
  rememberArguments?: (path: string, text: string) => void
}>()
const emit = defineEmits<{ close: [] }>()
const path = ref(props.program)
const stopAtStart = ref(false)
const argumentsText = ref(props.argumentsFor?.(props.program) ?? '')
watch(path, (value) => {
  argumentsText.value = props.argumentsFor?.(value.trim()) ?? ''
})
const busy = ref(false)
const error = ref('')
const output = ref('')
const technical = ref('')
const expanded = ref(false)
async function run() {
  if (busy.value) return
  error.value = ''
  output.value = ''
  technical.value = ''
  expanded.value = false
  let argv: string[]
  try {
    argv = parseLaunchArguments(argumentsText.value)
  } catch {
    error.value = t('debug.launchArgsInvalid')
    return
  }
  busy.value = true
  try {
    if (props.stopOnEntrySupported) await props.launch(path.value.trim(), argv, stopAtStart.value)
    else await props.launch(path.value.trim(), argv)
    props.rememberArguments?.(path.value.trim(), argumentsText.value)
    emit('close')
  } catch (e) {
    console.debug('[debugger] Program not started', e)
    const diagnostics = DiagnosticsSchema.safeParse(e)
    const details = diagnostics.success ? diagnostics.data.details : undefined
    technical.value = [
      ...new Set(
        [
          diagnostics.success ? diagnostics.data.code : undefined,
          e instanceof Error ? e.message : String(e),
        ].filter(Boolean)
      ),
    ].join('\n')
    error.value = technical.value.includes('debugger_startup_handoff_lost')
      ? t('debug.launchExitedEarly')
      : t('debug.launchFailedPlain')
    output.value = [details?.stdout, details?.stderr].filter(Boolean).join('\n')
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
