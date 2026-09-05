<template>
  <template v-if="!n.hidden">
    <div
      v-if="n.type === 'stack'"
      class="abele-script-node__stack"
      :class="[`abele-script-node__stack_gap-${n.gap}`, n.cls]"
    >
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </div>

    <div
      v-else-if="n.type === 'row'"
      class="abele-script-node__row"
      :class="[
        `abele-script-node__row_gap-${n.gap}`,
        `abele-script-node__row_justify-${n.justify}`,
        { 'abele-script-node__row_nowrap': !n.wrap },
        n.cls,
      ]"
    >
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </div>

    <CardGrid v-else-if="n.type === 'grid'" :wide="n.wide" :stack="n.stack" :class="n.cls">
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </CardGrid>

    <Section v-else-if="n.type === 'section'" :title="n.title" :desc="n.desc" :class="n.cls">
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </Section>

    <div v-else-if="n.type === 'tabs'" class="abele-script-node__tabs" :class="n.cls">
      <Tabs :tabs="tabStrip" :model-value="activeTab" @update:model-value="pickTab" />
      <div class="abele-script-node__tab-content">
        <ScriptNode
          v-for="child in n.contentOf(activeTab)"
          :key="child.key"
          :node="child"
          :view="view"
        />
      </div>
    </div>

    <Setting v-else-if="n.type === 'setting'" :name="n.name" :desc="n.desc" :class="n.cls">
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </Setting>

    <Markdown
      v-else-if="n.type === 'markdown'"
      :text="n.file ? fileText : n.text"
      :file-path="n.file ?? n.filePath"
      :as-document="Boolean(n.file)"
      class="abele-script-node__markdown"
      :class="n.cls"
      @click="fire('click')"
    />

    <p
      v-else-if="n.type === 'text'"
      class="abele-script-node__text"
      :class="[
        { 'abele-script-node__text_muted': n.muted, 'abele-script-node__text_small': n.small },
        n.cls,
      ]"
    >
      {{ n.text }}
    </p>

    <Image
      v-else-if="n.type === 'image'"
      :src="n.src"
      :alt="n.alt"
      :fit="n.fit"
      :class="n.cls"
      @click="fire('click')"
    />

    <Table
      v-else-if="n.type === 'table'"
      :columns="n.columns"
      :rows="tableRows"
      :clickable="n.has('rowClick')"
      :class="n.cls"
      @row-click="(_row, i) => fire('rowClick', n.rows[i], i)"
    >
      <template #cell="{ value }">
        <ScriptNode v-if="isNode(value)" :key="value.key" :node="value" :view="view" />
        <template v-else>{{ value ?? '' }}</template>
      </template>
    </Table>

    <Badge v-else-if="n.type === 'badge'" :text="n.text" :accent="n.accent" :class="n.cls" />

    <EmptyState v-else-if="n.type === 'empty'" :text="n.text" :class="n.cls" />

    <Button
      v-else-if="n.type === 'button'"
      :text="n.text"
      :icon="n.icon"
      :accent="n.accent"
      :warning="n.warning"
      :disabled="n.disabled"
      :tooltip="n.tooltip"
      :class="n.cls"
      @click="fire('click')"
    />

    <Icon
      v-else-if="n.type === 'icon'"
      :icon="n.icon"
      :tooltip="n.tooltip"
      :disabled="n.disabled"
      :class="n.cls"
      @click="fire('click')"
    />

    <Input
      v-else-if="n.type === 'input'"
      :model-value="n.value"
      :placeholder="n.placeholder"
      :as-text-area="n.textarea"
      :rows="n.rows"
      :disabled="n.disabled"
      :class="n.cls"
      @update:model-value="
        (v: string) => {
          n.value = v
          fire('input', v)
        }
      "
      @change="fire('change', n.value)"
      @keydown.enter="!n.textarea && fire('enter', n.value)"
    />

    <Dropdown
      v-else-if="n.type === 'select'"
      :options="options"
      :model-value="selectValue"
      :class="n.cls"
      @update:model-value="
        (v: string) => {
          n.value = v
          fire('change', v)
        }
      "
    />

    <div v-else-if="n.type === 'checkbox'" class="abele-script-node__checkbox" :class="n.cls">
      <Checkbox :is-enabled="n.checked" @toggle="toggle" />
      <span v-if="n.label" class="abele-script-node__checkbox-label" @click="toggle">
        {{ n.label }}
      </span>
    </div>

    <Search
      v-else-if="n.type === 'search'"
      :model-value="n.value"
      :placeholder="n.placeholder"
      :suggester="suggester"
      :class="n.cls"
      @update:model-value="
        (v: string) => {
          n.value = v
          fire('change', v)
        }
      "
    />

    <Card
      v-else-if="n.type === 'card'"
      :title="n.title ?? ''"
      :cover="n.cover"
      :large="n.large"
      :subtitle="n.subtitle"
      :description="n.description"
      :meta="n.meta"
      :selected="n.selected"
      :clickable="n.has('click')"
      :class="n.cls"
      @click="fire('click')"
    >
      <template v-if="n.badges.length" #badges>
        <ScriptNode v-for="child in n.badges" :key="child.key" :node="child" :view="view" />
      </template>
      <template v-if="n.actions.length" #actions>
        <ScriptNode v-for="child in n.actions" :key="child.key" :node="child" :view="view" />
      </template>
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </Card>

    <ScriptHtml v-else-if="n.type === 'html'" :node="n" :view="view" />
  </template>
</template>

<script setup lang="ts">
/**
 * One node of a script's view, as the kit component it stands for.
 *
 * The switch is the whole point: a script says `Button`, the plugin's own `Button.vue` is
 * what appears, and the view cannot help looking like the rest of the plugin. Every handler
 * goes through `view.run`, which reports a throw into the view's error strip rather than
 * letting it take the tree down; `onErrorCaptured` does the same for a render error.
 */
import { computed, onErrorCaptured, onMounted, onUnmounted, ref, watch } from 'vue'
import { TFile, type EventRef } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import type { View } from '@/scripting/view/View'
import { isNode, type ViewNode } from '@/scripting/view/components'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import CardGrid from './obsidian/CardGrid.vue'
import Section from './obsidian/Section.vue'
import Tabs from './obsidian/Tabs.vue'
import Setting from './obsidian/Setting.vue'
import Markdown from './obsidian/Markdown.vue'
import Image from './obsidian/Image.vue'
import Table from './obsidian/Table.vue'
import Badge from './obsidian/Badge.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import Input from './obsidian/Input.vue'
import Dropdown from './obsidian/Dropdown.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Search from './obsidian/Search.vue'
import Card from './obsidian/Card.vue'
import ScriptHtml from './ScriptHtml.vue'

const props = defineProps<{ node: ViewNode; view: View }>()

/**
 * The template switches on `type` and reads the props of whichever class that is. One loose
 * alias instead of a cast per branch: the component is keyed by the node, so `n` never
 * changes identity while it lives.
 */
const n = props.node as ViewNode & Record<string, any>

const fire = (event: string, ...args: unknown[]) =>
  void props.view.run(() => props.node.emit(event, ...args))

onErrorCaptured((err) => {
  props.view.report(err)
  return false
})

// ── tabs ──
const tabStrip = computed(() =>
  n.type === 'tabs'
    ? n.tabs.map(
        ({
          id,
          label,
          icon,
          tooltip,
        }: {
          id: string
          label: string
          icon?: string
          tooltip?: string
        }) => ({ id, label, ...(icon ? { icon } : {}), ...(tooltip ? { tooltip } : {}) })
      )
    : []
)
const pickTab = (id: string) => {
  n.active = id
  fire('change', id)
}

/**
 * An `active` that names no tab, or a `value` that is not among the options, is a script's
 * mistake rather than a reason to draw nothing: the first one is shown, and the strip says so
 * once for this instance. A watch rather than a report inside the computed, so the strip is
 * written from a side effect and not from a render.
 */
const activeTab = computed<string>(() => {
  if (n.type !== 'tabs') return ''
  const ids = n.tabs.map((t: { id: string }) => t.id)
  return ids.includes(n.active) ? n.active : (ids[0] ?? '')
})
const selectValue = computed<string>(() => {
  if (n.type !== 'select') return ''
  const values = n.options.map((o: { value: string }) => o.value)
  return values.includes(n.value) ? n.value : (values[0] ?? '')
})
function reportOnce(what: string, asked: () => string, shown: () => string) {
  let reported = false
  watch(
    () => asked() !== shown(),
    (bad) => {
      if (!bad || reported) return
      reported = true
      props.view.report(new Error(`${what} "${asked()}"; showing "${shown()}"`))
    },
    { immediate: true }
  )
}
if (n.type === 'tabs') {
  reportOnce(
    'Tabs: no tab has id',
    () => n.active,
    () => activeTab.value
  )
}
if (n.type === 'select') {
  reportOnce(
    'Select: no option has value',
    () => n.value,
    () => selectValue.value
  )
}

// ── table ──
/**
 * A row given as an array is matched to the columns in order. The constructor does this for
 * the rows it is given; rows assigned afterwards arrive here as they are, so the same is done
 * on the way to the kit. The kit's row-click hands back the copy, which is why the handler
 * above looks the script's own row up by index.
 */
const tableRows = computed<Record<string, unknown>[]>(() =>
  n.type === 'table'
    ? n.rows.map((r: unknown) =>
        Array.isArray(r)
          ? Object.fromEntries(
              n.columns.map((c: { key: string }, i: number) => [c.key, (r as unknown[])[i] ?? ''])
            )
          : r
      )
    : []
)

// ── select / search ──
const options = computed(() =>
  n.type === 'select'
    ? n.options.map((o: { value: string; label: string }) => ({ value: o.value, display: o.label }))
    : []
)
const suggester = computed(() =>
  n.suggest === 'file' ? FileSuggest : n.suggest === 'folder' ? FolderSuggest : undefined
)

// ── checkbox ──
const toggle = () => {
  n.checked = !n.checked
  fire('change', n.checked)
}

// ── markdown from a file ──
const fileText = ref('')
let modifyRef: EventRef | null = null
let readGen = 0

/** Two `modify` events close together can resolve out of order; only the latest read lands. */
async function readNote(path: string) {
  const gen = ++readGen
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  const text = file instanceof TFile ? await app.vault.cachedRead(file) : `File not found: ${path}`
  if (gen === readGen) fileText.value = text
}

if (n.type === 'markdown') {
  watch(
    () => n.file,
    (file) => {
      if (file) void readNote(file)
    },
    { immediate: true }
  )
  onMounted(() => {
    modifyRef = GlobalStore.getInstance().app.vault.on('modify', (file) => {
      if (file.path === n.file) void readNote(file.path)
    })
  })
  onUnmounted(() => {
    if (modifyRef) GlobalStore.getInstance().app.vault.offref(modifyRef)
  })
}
</script>

<style lang="scss">
.abele-script-node__stack,
.abele-script-node__tab-content {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}

.abele-script-node__stack_gap-none {
  gap: 0;
}

.abele-script-node__stack_gap-small {
  gap: var(--size-4-1);
}

.abele-script-node__stack_gap-large {
  gap: var(--size-4-6);
}

.abele-script-node__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-script-node__row_gap-none {
  gap: 0;
}

.abele-script-node__row_gap-small {
  gap: var(--size-4-1);
}

.abele-script-node__row_gap-large {
  gap: var(--size-4-4);
}

.abele-script-node__row_justify-center {
  justify-content: center;
}

.abele-script-node__row_justify-end {
  justify-content: flex-end;
}

.abele-script-node__row_justify-between {
  justify-content: space-between;
}

.abele-script-node__row_nowrap {
  flex-wrap: nowrap;
}

.abele-script-node__tabs {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}

.abele-script-node__text {
  margin: 0;
}

.abele-script-node__text_muted {
  color: var(--text-muted);
}

.abele-script-node__text_small {
  font-size: var(--font-ui-smaller);
}

.abele-script-node__checkbox {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-script-node__checkbox-label {
  cursor: var(--cursor-link);
}
</style>
