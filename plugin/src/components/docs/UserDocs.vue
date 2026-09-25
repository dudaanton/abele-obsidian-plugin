<template>
  <div ref="root" class="abele-user-docs" :class="{ 'abele-user-docs_narrow': narrow }">
    <div v-if="narrow" class="abele-user-docs__bar">
      <Icon
        class="abele-user-docs__menu"
        :icon="menuOpen ? 'x' : 'menu'"
        :tooltip="menuOpen ? 'Back to the page' : 'Contents and search'"
        @click="menuOpen = !menuOpen"
      />
      <span class="abele-user-docs__bar-title">{{ menuOpen ? 'Contents' : page.title }}</span>
    </div>

    <nav v-if="!narrow || menuOpen" class="abele-user-docs__nav">
      <Search v-model="query" placeholder="Search the documentation" />

      <div v-if="searching" class="abele-user-docs__results">
        <EmptyState v-if="!hits.length" text="Nothing in the documentation matches that." />
        <div
          v-for="hit in hits"
          :key="hit.page + '#' + hit.heading"
          class="abele-user-docs__hit"
          role="button"
          tabindex="0"
          @click="openHit(hit)"
          @keydown.enter.prevent="openHit(hit)"
        >
          <div class="abele-user-docs__hit-title">
            {{ hit.headingTitle ? `${hit.pageTitle} › ${hit.headingTitle}` : hit.pageTitle }}
          </div>
          <div class="abele-user-docs__hit-snippet">
            <template v-for="(part, i) in hit.snippet" :key="i">
              <mark v-if="part.hit">{{ part.text }}</mark>
              <span v-else>{{ part.text }}</span>
            </template>
          </div>
        </div>
      </div>

      <div v-else class="abele-user-docs__contents" role="tree">
        <TreeItem
          v-for="entry in pages"
          :key="entry.id"
          :text="entry.title"
          :path="entry.id"
          collapsible
          :collapsed="entry.id !== model.page"
          :active="entry.id === model.page && !model.heading"
          @click="go({ page: entry.id, heading: '' })"
        >
          <TreeItem
            v-for="section in entry.headings.filter((h) => h.level === 2)"
            :key="section.id"
            :text="section.title"
            :path="`${entry.id}#${section.id}`"
            :active="entry.id === model.page && section.id === model.heading"
            @click="go({ page: entry.id, heading: section.id })"
          />
        </TreeItem>
      </div>
    </nav>

    <article
      v-show="!narrow || !menuOpen"
      ref="article"
      class="abele-user-docs__article"
      @click.capture="onArticleClick"
    >
      <div class="abele-user-docs__page">
        <Markdown :text="page.rendered" as-document @rendered="onRendered" />
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
/**
 * The documentation for people: the contents and a search beside the page on a desktop, and on
 * a phone — or in any pane too narrow for both — the page alone, with the contents and the
 * search behind a menu button in a bar above it.
 *
 * What is open lives in `model`, which the view saves with the workspace, so a restart opens
 * the same page. The pages are `src/userdocs/`, rendered by Obsidian as any note is; a link
 * between them is an ordinary markdown link to a page id and is followed here rather than
 * handed to Obsidian, which would look for a note by that name.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Platform } from 'obsidian'
import Markdown from '../obsidian/Markdown.vue'
import Search from '../obsidian/Search.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import Icon from '../obsidian/Icon.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import {
  USER_DOCS,
  findPage,
  resolveDocLink,
  searchUserDocs,
  type DocTarget,
  type UserDocHit,
} from '@/userdocs'
import { slug } from '@/docs'

const props = defineProps<{ model: DocTarget }>()

const pages = USER_DOCS
const page = computed(() => findPage(props.model.page) ?? USER_DOCS[0])

const root = ref<HTMLElement>()
const article = ref<HTMLElement>()

/** Below this the contents and the page do not both fit, and the contents go behind a menu. */
const NARROW_BELOW = 640
const width = ref(0)
const narrow = computed(() => Platform.isPhone || (width.value > 0 && width.value < NARROW_BELOW))
const menuOpen = ref(false)

let observer: ResizeObserver | null = null
onMounted(() => {
  const el = root.value
  const win = el?.ownerDocument.defaultView
  if (!el || !win || typeof win.ResizeObserver === 'undefined') return
  observer = new win.ResizeObserver(([entry]) => (width.value = entry.contentRect.width))
  observer.observe(el)
})
onBeforeUnmount(() => observer?.disconnect())

const query = ref('')
const searching = computed(() => query.value.trim().length > 0)
const hits = computed(() => (searching.value ? searchUserDocs(query.value) : []))

/** The words of the result last opened, marked on its page until another page is picked. */
const marked = ref<string[]>([])

function go(target: DocTarget, terms: string[] = []) {
  marked.value = terms
  const samePage = target.page === props.model.page
  props.model.page = target.page
  props.model.heading = target.heading
  menuOpen.value = false
  // Another page scrolls once it has rendered; on this one there is nothing to wait for.
  if (samePage) void nextTick(() => place())
}

function openHit(hit: UserDocHit) {
  go({ page: hit.page, heading: hit.heading }, hit.terms)
}

function onArticleClick(event: MouseEvent) {
  const link = (event.target as HTMLElement | null)?.closest?.('a.internal-link')
  if (!link) return
  // A page of these docs, or nothing: a name here is never a note of the vault.
  event.preventDefault()
  event.stopPropagation()
  const target = resolveDocLink(link.getAttribute('data-href') ?? '', props.model.page)
  if (target) go(target)
}

function onRendered() {
  const el = article.value
  if (!el) return
  // Obsidian draws a link to a note it cannot find as unresolved — faded. Every link between
  // these pages is one of those to Obsidian, and a working link should not look broken.
  for (const link of el.querySelectorAll('a.internal-link')) {
    if (resolveDocLink(link.getAttribute('data-href') ?? '', props.model.page)) {
      link.classList.remove('is-unresolved')
    }
  }
  if (marked.value.length) markWords(el, marked.value)
  place()
}

/** Scrolls to the heading asked for, or to the first marked word under it, or to the top. */
function place() {
  const el = article.value
  if (!el) return
  const heading = props.model.heading ? findHeading(el, props.model.heading) : null
  const mark = firstMarkAfter(el, heading)
  const target = mark ?? heading
  if (!target) {
    el.scrollTop = 0
    return
  }
  const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
  el.scrollTop = Math.max(0, top - (mark ? el.clientHeight / 3 : 0))
}

function findHeading(el: HTMLElement, id: string): HTMLElement | null {
  for (const h of el.querySelectorAll<HTMLElement>('h2, h3')) {
    if (slug(h.textContent ?? '') === id) return h
  }
  return null
}

function firstMarkAfter(el: HTMLElement, heading: HTMLElement | null): HTMLElement | null {
  for (const mark of el.querySelectorAll<HTMLElement>('mark.abele-user-docs__mark')) {
    if (!heading) return mark
    if (heading.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING) return mark
  }
  return null
}

/** Wraps every occurrence of the words in the page's text in a mark, as the results show them. */
function markWords(el: HTMLElement, terms: string[]) {
  const doc = el.ownerDocument
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'giu'
  )
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  for (const node of nodes) {
    const text = node.data
    const matches = [...text.matchAll(pattern)]
    if (!matches.length) continue
    const fragment = doc.win.createFragment()
    let last = 0
    for (const match of matches) {
      const at = match.index ?? 0
      fragment.append(text.slice(last, at))
      fragment.append(doc.win.createEl('mark', { cls: 'abele-user-docs__mark', text: match[0] }))
      last = at + match[0].length
    }
    fragment.append(text.slice(last))
    node.replaceWith(fragment)
  }
}
</script>

<style lang="scss">
/* The tab's own content box: the page scrolls inside the component, not the tab around it. */
.view-content.abele-user-docs-view {
  padding: 0;
  overflow: hidden;
}

.abele-user-docs-view__mount {
  height: 100%;
}

.abele-user-docs {
  display: flex;
  height: 100%;
  min-height: 0;
}

.abele-user-docs_narrow {
  flex-direction: column;
}

.abele-user-docs__bar {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3);
  border-bottom: 1px solid var(--background-modifier-border);
}

.abele-user-docs__bar-title {
  font-weight: var(--font-semibold);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-user-docs__nav {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  flex: 0 0 18em;
  min-height: 0;
  padding: var(--size-4-3);
  border-right: 1px solid var(--background-modifier-border);
  overflow-y: auto;
}

.abele-user-docs_narrow .abele-user-docs__nav {
  flex: 1 1 auto;
  border-right: none;
}

.abele-user-docs__hit {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  padding: var(--size-4-2);
  border-radius: var(--radius-s);
  cursor: var(--cursor);

  &:hover,
  &:focus-visible {
    background: var(--background-modifier-hover);
  }
}

.abele-user-docs__hit-title {
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);
  color: var(--text-normal);
}

.abele-user-docs__hit-snippet {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  line-height: var(--line-height-tight);

  mark {
    background: var(--text-highlight-bg);
    color: var(--text-normal);
  }
}

.abele-user-docs__article {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}

.abele-user-docs__page {
  max-width: var(--file-line-width);
  margin: 0 auto;
  padding: var(--size-4-4) var(--size-4-8) var(--size-4-12);
  user-select: text;
}

.abele-user-docs_narrow .abele-user-docs__page {
  padding: var(--size-4-3) var(--size-4-4) var(--size-4-12);
}

.abele-user-docs__mark {
  background: var(--text-highlight-bg);
  color: inherit;
}
</style>
