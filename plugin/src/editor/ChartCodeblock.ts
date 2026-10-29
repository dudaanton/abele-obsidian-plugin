import { MarkdownPostProcessorContext, MarkdownRenderChild, parseYaml } from 'obsidian'
import ChartBlock from '@/components/ChartBlock.vue'
import { mountKit } from '@/components/obsidian/mount'
import type { ChartConfig } from './chartOption'
import { buildEchartsOption } from './chartOption'
import { printChart } from '@/bases/echarts'
import { isPrintMode } from '@/markdown/printMode'

/** Keeps the chart for exactly as long as the render that drew it. */
class ChartRenderChild extends MarkdownRenderChild {
  constructor(
    el: HTMLElement,
    private readonly dispose: () => void
  ) {
    super(el)
  }

  onunload(): void {
    this.dispose()
  }
}

/**
 * Owned by the render, as the map and the diagram are: a chat message, a script view or a
 * reading view closed around the block unloads it. Watching the parent for the block's own
 * removal missed every one of those — an ancestor went, the parent's children stayed — and
 * ECharts keeps each live chart in a registry of its own, so none of them was ever freed.
 */
function mountChart(
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  props: { config?: ChartConfig; error?: string }
): void {
  if (isPrintMode(el)) {
    try {
      if (props.error || !props.config) el.textContent = props.error ?? 'No series defined'
      else printChart(el, buildEchartsOption(props.config), props.config.height || 300)
    } catch (error) {
      el.textContent = `Chart error: ${String(error)}`
    }
    return
  }
  const mount = mountKit(el, ChartBlock, props)
  ctx.addChild(new ChartRenderChild(el, mount.unmount))
}

export function registerChartCodeblock(
  registerFn: (
    language: string,
    handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void
  ) => void
): void {
  registerFn('abele-chart', (source, el, ctx) => {
    let config: ChartConfig

    try {
      // Auto-quote formula values that contain YAML-breaking characters (: ? etc.)
      const safeSource = source.replace(
        /^(\s*formula:\s*)(.+)$/gm,
        (_match, prefix: string, value: string) => {
          const trimmed = value.trim()
          if (
            (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))
          ) {
            return prefix + trimmed
          }
          return `${prefix}"${trimmed.replace(/"/g, '\\"')}"`
        }
      )
      config = parseYaml(safeSource) as ChartConfig
    } catch (e) {
      return mountChart(el, ctx, { error: `YAML parse error: ${e}` })
    }

    if (!config || !config.series?.length)
      return mountChart(el, ctx, { error: 'No series defined' })
    mountChart(el, ctx, { config })
  })
}
