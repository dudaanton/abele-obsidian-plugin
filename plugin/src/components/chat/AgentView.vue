<template>
  <!-- The agent's own view where it stands in the answer, as tall as what is in it; under it a
       quiet line saying whose it is, and what can be done with it. -->
  <div ref="host" class="abele-agent-view" :class="{ 'is-window': inWindow }">
    <div v-if="broken" class="abele-agent-view__broken">
      <span>{{ t('streamB.thisViewCanTBeShown.46bc81') }}</span>
    </div>
    <pre v-if="broken || source" class="abele-agent-view__source"><code>{{ html }}</code></pre>
    <div v-if="!broken && !source" ref="stage" class="abele-agent-view__stage">
      <iframe
        key="frame"
        ref="frame"
        class="abele-agent-view__frame"
        :style="{ height: frameHeight, maxHeight: inWindow ? undefined : '32em' }"
        :title="t('streamB.viewByTheAgent.d4be6b')"
        tabindex="-1"
        sandbox="allow-same-origin"
        referrerpolicy="no-referrer"
        :srcdoc="documentHtml"
        @load="ready"
      />
      <div ref="hitLayer" class="abele-agent-view__hits" />
    </div>
    <div v-if="!inWindow" class="abele-agent-view__foot">
      <span class="abele-agent-view__whose">
        <Icon icon="layout-panel-top" size="xs" :interactive="false" />
        <span>{{ t('streamB.viewByTheAgent.d4be6b') }}</span>
      </span>
      <span class="abele-agent-view__actions">
        <Icon
          v-if="!broken"
          :icon="source ? 'eye' : 'code-xml'"
          :active="source"
          size="xs"
          :tooltip="source ? t('streamB.showTheView.e1a4b3') : t('streamB.showItsHtml.ca58f6')"
          @click="source = !source"
        />
        <Icon icon="copy" size="xs" :tooltip="t('streamB.copyItsHtml.fd15f2')" @click="copy" />
        <Icon
          v-if="!broken"
          icon="maximize-2"
          size="xs"
          :tooltip="t('streamB.openItLargerInAWindow.4ed25d')"
          @click="opened = true"
        />
      </span>
    </div>
    <ObsidianModal
      v-if="opened"
      :title="t('streamB.viewByTheAgent.d4be6b')"
      size="tall"
      @close="opened = false"
    >
      <AgentView :html="html" in-window @ask="ask" />
    </ObsidianModal>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/**
 * A view an agent wrote in its answer, drawn in a frame of its own: no scripts, no forms, no way
 * into Obsidian. The frame shares the page's origin only so the plugin can measure it and read
 * its links; with scripts off nothing inside can use that. A link to a web page opens the browser,
 * a note link opens the note, and an «ask» link puts its question in the chat's field, unsent.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Notice } from 'obsidian'
import { openExternal } from '@/helpers/openExternal'
import Icon from '../obsidian/Icon.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import { createLinkHitTarget } from '../obsidian/linkHitTarget'
import {
  ASK_EVENT,
  cleanViewHtml,
  readViewLink,
  themeOf,
  viewDocument,
  viewLinkTargets,
} from '@/views/agentView'
import { GlobalStore } from '@/stores/GlobalStore'

defineOptions({ name: 'AgentView' })

const props = defineProps<{
  html: string
  /** Drawn in the larger window: as tall as the window allows, no line under it. */
  inWindow?: boolean
}>()
const emit = defineEmits<{ ask: [text: string] }>()
const host = ref<HTMLElement | null>(null)

const frame = ref<HTMLIFrameElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const hitLayer = ref<HTMLElement | null>(null)
const links = shallowRef<ReturnType<typeof viewLinkTargets>>([])
const offscreenRect = { left: 0, top: 0, width: 1, height: 1 }
const controls = new Map<string, ReturnType<typeof createLinkHitTarget>>()
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
  props.inWindow ? '70vh' : height.value ? `${height.value}px` : '8em'
)

let observer: ResizeObserver | null = null
let themeWatch: MutationObserver | null = null
let releaseLinks: (() => void) | undefined
let animation: number | undefined
let visibility: IntersectionObserver | undefined
let visible = true

function stopTracking() {
  if (animation !== undefined) window.cancelAnimationFrame(animation)
  animation = undefined
  visibility?.disconnect()
  observer?.disconnect()
  releaseLinks?.()
  releaseLinks = undefined
  links.value = []
  for (const control of controls.values()) control.destroy()
  controls.clear()
}

function syncLinks() {
  const el = frame.value
  const doc = el?.contentDocument
  if (!el || !doc) return
  const next = viewLinkTargets(doc, el.clientWidth, el.clientHeight)
  const signature = (items: typeof next) =>
    JSON.stringify(items.map(({ href, label, rects }) => ({ href, label, rects })))
  if (signature(next) !== signature(links.value)) links.value = next
  const layer = hitLayer.value
  if (!layer || !stage.value) return
  // Markdown post-processing can move or normalize rendered DOM. Repair native nodes
  // directly instead of retaining virtual nodes whose host anchors may have disappeared.
  if (layer.parentElement !== stage.value) stage.value.appendChild(layer)
  const active = new Set<string>()
  next.forEach((link, index) => {
    const rects = link.rects.length ? link.rects : [offscreenRect]
    rects.forEach((rect, part) => {
      const key = `${index}:${part}`
      active.add(key)
      let control = controls.get(key)
      if (!control) {
        control = createLinkHitTarget(layer)
        control.element.classList.add('abele-agent-view__hit')
        controls.set(key, control)
      }
      control.update({
        href: link.href,
        label: link.label,
        secondary: part > 0,
        offscreen: !link.rects.length,
        rect,
        onFocus: () => revealLink(link),
      })
      if (control.element.parentElement !== layer) layer.appendChild(control.element)
    })
  })
  for (const [key, control] of controls) {
    if (!active.has(key)) {
      control.destroy()
      controls.delete(key)
    }
  }
}

function revealLink(link: ReturnType<typeof viewLinkTargets>[number]) {
  if (!link.rects.length) {
    link.element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    syncLinks()
  }
}

watch(
  [documentHtml, source, frame],
  () => {
    stopTracking()
    if (!source.value && frame.value) ready()
  },
  { flush: 'post' }
)

function measure() {
  const doc = frame.value?.contentDocument
  // The root includes the iframe viewport, so measuring it prevents a taller view shrinking.
  if (doc?.body)
    height.value = Math.ceil(
      Math.max(doc.body.scrollHeight, doc.body.getBoundingClientRect().height)
    )
}

function ready() {
  stopTracking()
  if (!frame.value) return
  const doc = frame.value?.contentDocument
  if (!doc?.body) {
    animation = window.requestAnimationFrame(ready)
    return
  }
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
  syncLinks()
  if (stage.value) releaseLinks = bindLinks(stage.value)
  visible = true
  // WebKit does not deliver sandboxed-frame input events to parent-installed listeners.
  // Read layout from the parent instead, including native iframe scrolling. Hidden views
  // suspend their frame loop rather than reading layout throughout a long conversation.
  const track = () => {
    animation = undefined
    if (!visible) return
    if (frame.value?.contentDocument !== doc) {
      ready()
      return
    }
    syncLinks()
    animation = window.requestAnimationFrame(track)
  }
  if (typeof IntersectionObserver !== 'undefined' && frame.value) {
    visibility = new IntersectionObserver(([entry]) => {
      if (frame.value?.contentDocument !== doc) {
        ready()
        return
      }
      visible = entry.isIntersecting
      if (visible && animation === undefined) animation = window.requestAnimationFrame(track)
      else if (!visible && animation !== undefined) {
        window.cancelAnimationFrame(animation)
        animation = undefined
      }
    })
    visibility.observe(frame.value)
  }
  animation = window.requestAnimationFrame(track)
}

function routeLink(anchor: Element) {
  const link = readViewLink(anchor.getAttribute('data-abele-href') ?? '')
  if (!link) return
  if (link.kind === 'web') openExternal(link.url, '_blank', 'noopener')
  else if (link.kind === 'note')
    void GlobalStore.getInstance().app.workspace.openLinkText(link.path, '')
  else ask(link.text)
}

function bindLinks(doc: HTMLElement): () => void {
  type Contact = { anchor: Element; x: number; y: number; id: number; moved: boolean; at: number }
  let pointer: Contact | undefined
  let touch: Contact | undefined
  let recent: { anchor: Element; type: string; at: number } | undefined
  const anchorOf = (event: Event) => {
    const node = event.target as Node | null
    const el = node?.nodeType === 3 ? node.parentElement : (node as Element | null)
    return el?.closest?.('[data-abele-href]') ?? null
  }
  const start = (anchor: Element, x: number, y: number, id: number): Contact => {
    recent = undefined
    return { anchor, x, y, id, moved: false, at: Date.now() }
  }
  const move = (contact: Contact | undefined, x: number, y: number) => {
    if (contact && Math.hypot(x - contact.x, y - contact.y) > 10) contact.moved = true
  }
  const suppressed = (anchor: Element) => recent?.anchor === anchor && Date.now() - recent.at < 800
  const finish = (event: Event, contact: Contact | undefined) => {
    if (!contact) return
    const valid =
      !contact.moved && Date.now() - contact.at < 700 && anchorOf(event) === contact.anchor
    if (!valid) {
      recent = { anchor: contact.anchor, type: 'cancel', at: Date.now() }
      return
    }
    event.preventDefault()
    // A single tap may produce pointerup, touchend and a compatibility click.
    if (suppressed(contact.anchor) && recent?.type !== event.type) return
    recent = { anchor: contact.anchor, type: event.type, at: Date.now() }
    routeLink(contact.anchor)
  }
  const listeners: [string, EventListener][] = []
  const listen = (type: string, handler: EventListener) => {
    doc.addEventListener(type, handler, { capture: true, passive: false })
    listeners.push([type, handler])
  }
  listen('click', (event) => {
    const anchor = anchorOf(event)
    if (!anchor) return
    event.preventDefault()
    const mouse = event as MouseEvent
    if (mouse.button !== 0 || suppressed(anchor)) return
    routeLink(anchor)
  })
  listen('keydown', (event) => {
    const key = event as KeyboardEvent
    const anchor = anchorOf(event)
    if (!anchor || key.key !== 'Enter') return
    event.preventDefault()
    if (key.repeat) return
    recent = { anchor, type: 'keydown', at: Date.now() }
    routeLink(anchor)
  })
  listen('pointerdown', (event) => {
    const e = event as PointerEvent
    const anchor = anchorOf(e)
    pointer = undefined
    if (!anchor || e.button !== 0 || !e.isPrimary) return
    recent = undefined
    if (e.pointerType !== 'mouse') pointer = start(anchor, e.clientX, e.clientY, e.pointerId)
  })
  listen('pointermove', (event) => {
    const e = event as PointerEvent
    if (pointer?.id === e.pointerId) move(pointer, e.clientX, e.clientY)
  })
  listen('pointerup', (event) => {
    const e = event as PointerEvent
    if (pointer?.id !== e.pointerId) return
    move(pointer, e.clientX, e.clientY)
    finish(e, pointer)
    pointer = undefined
  })
  listen('touchstart', (event) => {
    const e = event as TouchEvent
    const anchor = anchorOf(e)
    touch = undefined
    if (e.touches.length !== 1) {
      if (pointer) pointer.moved = true
      return
    }
    const point = e.touches[0]
    if (anchor) touch = start(anchor, point.clientX, point.clientY, point.identifier)
  })
  listen('touchmove', (event) => {
    const e = event as TouchEvent
    const point = Array.from(e.touches).find((point) => point.identifier === touch?.id)
    if (point) move(touch, point.clientX, point.clientY)
  })
  listen('touchend', (event) => {
    const e = event as TouchEvent
    const point = Array.from(e.changedTouches).find((point) => point.identifier === touch?.id)
    if (!point) return
    move(touch, point.clientX, point.clientY)
    finish(e, touch)
    touch = undefined
  })
  const cancel = () => {
    const contact = pointer ?? touch
    if (contact) recent = { anchor: contact.anchor, type: 'cancel', at: Date.now() }
    pointer = undefined
    touch = undefined
  }
  for (const type of ['pointercancel', 'touchcancel', 'scroll']) listen(type, cancel)
  return () => {
    for (const [type, handler] of listeners) doc.removeEventListener(type, handler, true)
  }
}

function ask(text: string) {
  // The enlarged view is teleported outside the chat; route through its original owner.
  if (props.inWindow) emit('ask', text)
  else
    host.value?.dispatchEvent(
      new CustomEvent(ASK_EVENT, { bubbles: true, composed: true, detail: { text } })
    )
}

async function copy() {
  await navigator.clipboard.writeText(props.html)
  new Notice(t('streamB.htmlCopied.29ef6b'))
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
  stopTracking()
  themeWatch?.disconnect()
  releaseLinks?.()
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

.abele-agent-view__stage {
  position: relative;
  overflow: hidden;
}

.abele-agent-view__hits {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
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
