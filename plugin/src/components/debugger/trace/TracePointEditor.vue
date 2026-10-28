<template>
  <!-- A record point set up under its line: what it takes, as Obsidian lists a property's values,
       when it fires, and a line saying why it is there. Enter keeps it, Escape leaves it as it
       was; the glyphs at the end say the same, for a finger. -->
  <div
    ref="root"
    class="abele-trace-point"
    role="group"
    :aria-label="t('streamC.f40baf3eaf35ae5a', { v1: String(line) })"
    @keydown.esc.prevent="emit('cancel')"
  >
    <span class="abele-trace-point__label">{{ t('streamC.8b862ba45dceddf7') }}</span>
    <div class="abele-trace-point__field">
      <div class="multi-select-container abele-trace-point__take">
        <div v-for="name in take" :key="name" class="multi-select-pill">
          <div class="multi-select-pill-content">{{ name }}</div>
          <Icon
            icon="x"
            :tooltip="t('streamC.f7f1471b20393db0')"
            class="multi-select-pill-remove-button"
            @click="drop(name)"
          />
        </div>
        <input
          ref="adding"
          v-model="added"
          class="multi-select-input"
          :placeholder="take.length ? t('settings.nodes.add') : t('streamC.deff2140ae9298d6')"
          :aria-label="t('streamC.658c0b04dc2be861')"
          spellcheck="false"
          autocomplete="off"
          @keydown.backspace="!added && take.length && drop(take[take.length - 1])"
        />
      </div>
      <div v-if="offered.length" class="abele-trace-point__offered">
        <button
          v-for="name in offered"
          :key="name"
          type="button"
          class="abele-trace-point__offer"
          :aria-label="t('streamC.45859579bad18461', { v1: String(name) })"
          @click="add(name)"
        >
          + {{ name }}
        </button>
      </div>
    </div>

    <span class="abele-trace-point__label">{{
      t('settings.scripts.AutomationsEditor.when.cf9c7aa2')
    }}</span>
    <Input
      v-model="when"
      class="abele-trace-point__code"
      :placeholder="t('streamC.de9f057a471cdb8d')"
      :aria-label="t('streamC.f6ec2c568705e307')"
      spellcheck="false"
      autocomplete="off"
      @keydown.enter.prevent="save"
    />

    <span class="abele-trace-point__label">{{
      t('settings.ai.AgentEditorModal.note.d8da2c49')
    }}</span>
    <Input
      v-model="note"
      :placeholder="t('streamC.50024c1448c282ff')"
      :aria-label="t('streamC.9ec399c83d2d2aaa')"
      @keydown.enter.prevent="save"
    />

    <div class="abele-trace-point__glyphs">
      <Icon icon="trash-2" :tooltip="t('streamC.267100ec1a3fd5ae')" @click="emit('remove')" />
      <Icon icon="circle" :tooltip="t('streamC.6d124d50562f4c8c')" @click="emit('to-breakpoint')" />
      <span class="abele-trace-point__gap" />
      <Icon icon="x" :tooltip="t('streamC.6bba1520238f0cc2')" @click="emit('cancel')" />
      <Icon icon="check" :tooltip="t('streamC.f0b24b84e41d1522')" @click="save" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

// What a record point takes, set up where it is: the names the editor sees on its line are
// offered under the field, an expression is typed in with `as` for its name. Only what is named
// is taken: with nothing named a pass is a step with its place and no values.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '../../obsidian/Icon.vue'
import Input from '../../obsidian/Input.vue'
import type { DebugBreakpoint } from '../types'

const props = defineProps<{
  line: number
  point?: DebugBreakpoint
  /** The names in scope on the line, offered to take. */
  inScope?: string[]
}>()

const emit = defineEmits<{
  (e: 'save', point: { take: string[]; when?: string; note?: string }): void
  (e: 'cancel'): void
  (e: 'remove'): void
  (e: 'to-breakpoint'): void
}>()

const take = ref<string[]>([...(props.point?.take ?? [])])
const when = ref(props.point?.when ?? '')
const note = ref(props.point?.note ?? '')
const added = ref('')
const adding = ref<HTMLInputElement>()
const offered = computed(() => (props.inScope ?? []).filter((n) => !take.value.includes(n)))

function add(name: string) {
  const n = name.trim()
  if (n && !take.value.includes(n)) take.value.push(n)
  added.value = ''
  adding.value?.focus()
}
const drop = (name: string) => (take.value = take.value.filter((n) => n !== name))
const save = () => {
  // Keep includes the expression still being typed, just as selecting a suggestion does.
  add(added.value)
  emit('save', {
    take: [...take.value],
    when: when.value.trim() || undefined,
    note: note.value.trim() || undefined,
  })
}

const root = ref<HTMLElement>()
let keyWindow: Window | null = null
const keydown = (event: KeyboardEvent) => {
  if (!root.value?.contains(event.target as Node) || event.isComposing) return
  if (event.key !== 'Enter' && event.key !== 'Escape') return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (event.key === 'Escape') return emit('cancel')
  if (event.target === adding.value && added.value.trim()) add(added.value)
  else save()
}
onMounted(() => {
  keyWindow = root.value?.ownerDocument.defaultView ?? null
  keyWindow?.addEventListener('keydown', keydown, true)
  adding.value?.focus({ preventScroll: true })
  const scroller = root.value?.closest('.cm-scroller')
  const left = scroller?.scrollLeft
  root.value?.scrollIntoView({ block: 'nearest' })
  if (scroller && left !== undefined) scroller.scrollLeft = left
})
onBeforeUnmount(() => keyWindow?.removeEventListener('keydown', keydown, true))
</script>

<style lang="scss">
.abele-trace-point {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: var(--size-4-2) var(--size-4-3);
  max-width: 40em;
  font-size: var(--font-ui-small);
}
.abele-trace-point__label {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-trace-point__field {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  min-width: 0;
}
.abele-trace-point__take,
.abele-trace-point__code input,
.abele-trace-point__take .multi-select-input {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
.abele-trace-point__take .multi-select-input {
  flex: 1 1 8em;
  min-width: 8em;
}
.abele-trace-point__offered {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2);
}
// An offered name reads as a pill not yet taken: the same shape, faint, a plus before it.
.abele-trace-point .abele-trace-point__offer {
  height: auto;
  padding: var(--size-2-1) var(--size-4-2);
  border: var(--border-width) dashed var(--background-modifier-border);
  border-radius: var(--radius-s);
  background: none;
  box-shadow: none;
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }
}
.abele-trace-point__glyphs {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: var(--size-2-2);
}
.abele-trace-point__gap {
  flex: 1 1 auto;
}
</style>
