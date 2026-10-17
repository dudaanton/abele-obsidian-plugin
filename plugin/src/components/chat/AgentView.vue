<template>
  <!-- The agent's own view where it stands in the answer, as tall as what is in it; under it a
       quiet line saying whose it is, and what can be done with it. -->
  <div class="abele-agent-view" :class="{ 'is-window': inWindow }">
    <div v-if="broken" class="abele-agent-view__broken">
      <span>This view can’t be shown.</span>
    </div>
    <pre v-if="broken || source" class="abele-agent-view__source"><code>{{ html }}</code></pre>
    <iframe
      v-if="!broken && !source"
      ref="frame"
      class="abele-agent-view__frame"
      :style="{ height: frameHeight }"
      title="View by the agent"
      sandbox="allow-same-origin"
      referrerpolicy="no-referrer"
      :srcdoc="documentHtml"
      @load="ready"
    />
    <div v-if="!inWindow" class="abele-agent-view__foot">
      <span class="abele-agent-view__whose">
        <Icon icon="layout-panel-top" size="xs" :interactive="false" />
        <span>View by the agent</span>
      </span>
      <span class="abele-agent-view__actions">
        <Icon
          v-if="!broken"
          :icon="source ? 'eye' : 'code-xml'"
          :active="source"
          size="xs"
          :tooltip="source ? 'Show the view' : 'Show its HTML'"
          @click="source = !source"
        />
        <Icon icon="copy" size="xs" tooltip="Copy its HTML" @click="copy" />
        <Icon
          v-if="!broken"
          icon="maximize-2"
          size="xs"
          tooltip="Open it larger, in a window"
          @click="opened = true"
        />
      </span>
    </div>
    <ObsidianModal v-if="opened" title="View by the agent" size="large" @close="opened = false">
      <AgentView :html="html" in-window />
    </ObsidianModal>
  </div>
</template>

<script setup lang="ts">
/**
 * A view an agent wrote in its answer, drawn in a frame of its own: no scripts, no forms, no way
 * into Obsidian. The frame shares the page's origin only so the plugin can measure it and read
 * its links; with scripts off nothing inside can use that. A link to a web page opens the browser,
 * a note link opens the note, and an «ask» link puts its question in the chat's field, unsent.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Notice } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import { ASK_EVENT, cleanViewHtml, readViewLink, themeOf, viewDocument } from '@/views/agentView'
import { GlobalStore } from '@/stores/GlobalStore'

defineOptions({ name: 'AgentView' })

const props = defineProps<{
  html: string
  /** Drawn in the larger window: as tall as the window allows, no line under it. */
  inWindow?: boolean
}>()

const frame = ref<HTMLIFrameElement | null>(null)
const source = ref(false)
const opened = ref(false)
const height = ref(0)
const theme = ref('')

// Nothing left to draw once what cannot run is taken out: the HTML is shown as code instead.
const broken = computed(() => {
  const clean = cleanViewHtml(props.html)
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  return !doc.body.textContent?.trim() && !doc.body.querySelector('img, svg, table, hr')
})
const documentHtml = computed(() => viewDocument(props.html, theme.value))
// Tall views scroll inside past a window's worth; in the larger window it fills what it has.
const frameHeight = computed(() =>
  props.inWindow ? '70vh' : height.value ? `min(${height.value}px, 32em)` : '8em'
)

let observer: ResizeObserver | null = null
let themeWatch: MutationObserver | null = null

function measure() {
  const doc = frame.value?.contentDocument
  if (doc?.documentElement) height.value = Math.ceil(doc.documentElement.scrollHeight)
}

function ready() {
  const doc = frame.value?.contentDocument
  if (!doc) return
  measure()
  const View = doc.defaultView?.ResizeObserver
  observer?.disconnect()
  if (View) {
    observer = new View(measure)
    observer.observe(doc.body)
  }
  // A picture that does not arrive leaves a quiet plate in its place, at the size the card gave it.
  const missing = (img: HTMLImageElement) => {
    // The frame's own document, which has none of Obsidian's helpers on its elements.
    // eslint-disable-next-line obsidianmd/prefer-create-el
    const plate = doc.createElement('div')
    plate.className = `${img.className} picture is-missing`.trim()
    plate.setAttribute('role', 'img')
    plate.setAttribute('aria-label', img.alt)
    img.replaceWith(plate)
    measure()
  }
  doc.querySelectorAll('img').forEach((img) => {
    img.addEventListener('load', measure)
    img.addEventListener('error', () => missing(img))
    if (img.complete && !img.naturalWidth && img.getAttribute('src')) missing(img)
  })
  doc.addEventListener('click', onClick)
}

function onClick(e: MouseEvent) {
  const a = (e.target as Element | null)?.closest?.('a')
  if (!a) return
  e.preventDefault()
  const link = readViewLink(a.getAttribute('href') ?? '')
  if (!link) return
  if (link.kind === 'web') window.open(link.url, '_blank', 'noopener')
  else if (link.kind === 'note')
    void GlobalStore.getInstance().app.workspace.openLinkText(link.path, '')
  else
    frame.value?.dispatchEvent(
      new CustomEvent(ASK_EVENT, { bubbles: true, composed: true, detail: { text: link.text } })
    )
}

async function copy() {
  await navigator.clipboard.writeText(props.html)
  new Notice('HTML copied')
}

onMounted(() => {
  // Obsidian keeps its theme on the body: the block may still be drawn off the page here, so the
  // theme is read from there rather than from where the view stands.
  const host = document.body
  theme.value = themeOf(host)
  // The theme changing redraws the view in it.
  themeWatch = new MutationObserver(() => (theme.value = themeOf(host)))
  themeWatch.observe(host, { attributes: true, attributeFilter: ['class', 'style'] })
})
onBeforeUnmount(() => {
  observer?.disconnect()
  themeWatch?.disconnect()
  frame.value?.contentDocument?.removeEventListener('click', onClick)
})
</script>

<style lang="scss">
.abele-agent-view {
  margin: var(--size-4-2) 0;
}

.abele-agent-view__frame {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  color-scheme: normal;
}

.abele-agent-view__broken {
  margin-bottom: var(--size-2-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-agent-view__source {
  max-height: 24em;
  overflow: auto;
}

// One quiet line under the view: whose it is, and what can be done with it, lit where a pointer
// is and always there on a phone.
.abele-agent-view__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
  margin-top: var(--size-2-3);
  // Room for the last glyph's focus ring inside the chat's edge.
  padding-inline-end: var(--size-2-2);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}

.abele-agent-view__whose {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-2);
}

.abele-agent-view__actions {
  display: inline-flex;
  gap: var(--size-2-1);
  visibility: hidden;

  .abele-agent-view:hover &,
  .abele-agent-view:focus-within &,
  .is-phone & {
    visibility: visible;
  }
}

.abele-agent-view.is-window {
  margin: 0;
}
</style>
