<template>
  <!-- A value's shape as a tree of its keys: the type quiet beside each, a list's length, one
       example at a leaf. A leaf can be followed through the run or marked. -->
  <div
    class="abele-trace-shape"
    role="tree"
    :aria-label="t('streamC.23b76a0744ebb96e', { v1: String(name) })"
  >
    <ShapeRow
      v-for="(child, i) in roots"
      :key="i"
      :node="child"
      :path="pathOf('$', child)"
      :depth="0"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

// The shape is worked out on the node and is small by design: keys and types, how long the lists
// are, which keys only some elements have, one example per leaf. Deep levels start folded.
import { computed, defineComponent, h, reactive, type PropType } from 'vue'
import TreeItem from '../../obsidian/TreeItem.vue'
import Icon from '../../obsidian/Icon.vue'
import type { ShapeNode } from './types'

const props = withDefaults(
  defineProps<{
    name: string
    shape: ShapeNode
    /** Levels shown open at first. */
    open?: number
  }>(),
  { open: 2 }
)

const emit = defineEmits<{
  (e: 'follow', path: string, value: string): void
  (e: 'mark', path: string): void
  (e: 'open', path: string): void
}>()

const roots = computed(() => props.shape.children ?? [props.shape])
const pathOf = (base: string, node: ShapeNode) =>
  !node.key ? base : node.key === '[*]' ? `${base}[*]` : `${base}.${node.key}`

const folded = reactive(new Set<string>())
const opened = reactive(new Set<string>())
const isFolded = (path: string, depth: number) =>
  depth >= props.open ? !opened.has(path) : folded.has(path)
function toggle(path: string, depth: number) {
  if (depth >= props.open) opened.has(path) ? opened.delete(path) : opened.add(path)
  else folded.has(path) ? folded.delete(path) : folded.add(path)
}

const ShapeRow = defineComponent({
  name: 'ShapeRow',
  props: {
    node: { type: Object as PropType<ShapeNode>, required: true },
    path: { type: String, required: true },
    depth: { type: Number, required: true },
  },
  setup(p) {
    return () => {
      const n = p.node
      const kids = n.children ?? []
      const type = `${n.type}${n.count !== undefined ? ` · ${n.count}` : ''}`
      return h(
        TreeItem,
        {
          class: ['abele-trace-shape__row', { 'abele-trace-shape__row_optional': n.optional }],
          text: n.key ?? props.name,
          note: n.example,
          flair: n.optional ? t('streamC.cc51eb26f24923b7', { v1: String(type) }) : type,
          collapsible: kids.length > 0,
          collapsed: isFolded(p.path, p.depth),
          role: 'treeitem',
          onClick: () => (kids.length ? toggle(p.path, p.depth) : emit('open', p.path)),
        },
        {
          actions: () => [
            n.example !== undefined
              ? h(Icon, {
                  icon: 'footprints',
                  size: 'xs',
                  tooltip: t('streamC.297efed4c9a10886'),
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation()
                    emit('follow', p.path, n.example)
                  },
                })
              : null,
            kids.length
              ? null
              : h(Icon, {
                  icon: 'flag',
                  size: 'xs',
                  tooltip: t('streamC.430b28d66460bdf6'),
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation()
                    emit('mark', p.path)
                  },
                }),
          ],
          default: () =>
            kids.map((c, i) =>
              h(ShapeRow, { key: i, node: c, path: pathOf(p.path, c), depth: p.depth + 1 })
            ),
        }
      )
    }
  },
})
</script>

<style lang="scss">
.abele-trace-shape .tree-item-inner {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
body.is-phone .abele-trace-shape .tree-item-inner {
  font-size: inherit;
}
.abele-trace-shape .abele-trace-shape__row_optional > .tree-item-self .tree-item-inner {
  color: var(--text-muted);
}
.abele-trace-shape .abele-tree-item__text {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-trace-shape .abele-tree-item__note {
  margin-inline-start: var(--size-4-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-trace-shape .tree-item-flair {
  font-size: var(--font-ui-smaller);
}
</style>
