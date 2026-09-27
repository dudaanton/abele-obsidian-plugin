import { BasesView, Component, MarkdownRenderer, parseYaml, stringifyYaml, TFile } from 'obsidian'
import type { BasesEntry, BasesPropertyId, QueryController } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

/**
 * Reading the rows of a base the way Obsidian's own Bases engine finds them.
 *
 * The public API has no way to run a base's query outside a view: rows only exist inside a
 * `BasesView`, handed to it as `this.data`. So the base is rendered offscreen, as a ```` ```base ````
 * code block holding the file's own YAML with the chosen view's type swapped for one of the
 * plugin's own view ids. The factory registered for that id (`abele-chart`) looks at where it is
 * being put: inside a probe host it builds a `BaseProbeView`, which hands the rows over and draws
 * nothing, and everywhere else the ordinary chart. So no extra entry appears in the view picker,
 * and filters, formulas, sort and limit are the engine's, not an imitation of them.
 */

export const PROBE_CLASS = 'abele-data-probe'
/** The plugin's chart view id (`CHART_VIEW_ID`), whose factory builds the probe inside a probe host. */
export const PROBE_VIEW_TYPE = 'abele-chart'
const PROBE_ATTR = 'data-abele-probe'
/** How long a base may take to answer before the read is given up as failed. */
export const PROBE_TIMEOUT_MS = 15_000
/** Obsidian may update a view more than once as it settles; the last update inside this wins. */
const SETTLE_MS = 200

export interface ProbeResult {
  entries: BasesEntry[]
  /** The view's visible properties, in its order. */
  order: BasesPropertyId[]
}

type ProbeHandler = (result: ProbeResult) => void
const handlers = new Map<string, ProbeHandler>()
let nextId = 0

/** The handler waiting for rows in the probe host `el` sits in, if it sits in one. */
export function probeFor(el: HTMLElement): ProbeHandler | null {
  const host = el.closest(`.${PROBE_CLASS}`)
  const id = host?.getAttribute(PROBE_ATTR)
  return (id && handlers.get(id)) || null
}

export class BaseProbeView extends BasesView {
  type: string
  constructor(
    controller: QueryController,
    viewType: string,
    private readonly handler: ProbeHandler
  ) {
    super(controller)
    this.type = viewType
  }

  onDataUpdated(): void {
    this.handler({ entries: [...this.data.data], order: [...this.config.getOrder()] })
  }
}

/**
 * The `.base` file's YAML with only `viewName` left in it (the first view when none is named),
 * its type swapped for `probeType`. Everything above the views — filters, formulas, properties —
 * is kept as written, because the view's rows depend on it.
 */
export function probeYaml(source: string, viewName: string | undefined, probeType: string): string {
  const config = (parseYaml(source) ?? {}) as Record<string, unknown>
  const views = Array.isArray(config.views) ? (config.views as Record<string, unknown>[]) : []
  let view: Record<string, unknown> | undefined
  if (viewName) {
    view = views.find((v) => v?.name === viewName)
    if (!view) {
      const names = views.map((v) => String(v?.name ?? '')).filter(Boolean)
      throw new Error(
        `The base has no view named "${viewName}"${names.length ? `; its views: ${names.join(', ')}` : ''}.`
      )
    }
  } else {
    view = views[0] ?? { name: 'All' }
  }
  return stringifyYaml({ ...config, views: [{ ...view, type: probeType }] })
}

/** The names of a base's views, for the error that says which exist. */
export function baseViewNames(source: string): string[] {
  const config = (parseYaml(source) ?? {}) as Record<string, unknown>
  const views = Array.isArray(config.views) ? (config.views as Record<string, unknown>[]) : []
  return views.map((v) => String(v?.name ?? '')).filter(Boolean)
}

/** Runs the query of a view of a `.base` file and returns its rows, as the view would show them. */
export async function queryBase(
  file: TFile,
  viewName: string | undefined,
  probeType: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<ProbeResult> {
  const { app } = GlobalStore.getInstance()
  const bases = (
    app as unknown as {
      internalPlugins?: { getPluginById?: (id: string) => { enabled?: boolean } | null }
    }
  ).internalPlugins?.getPluginById?.('bases')
  if (bases && bases.enabled === false) {
    throw new Error('The Bases core plugin is switched off, so a base cannot be read.')
  }

  const yaml = probeYaml(await app.vault.cachedRead(file), viewName, probeType)
  const id = `probe-${++nextId}`
  const host = document.body.createDiv({ cls: PROBE_CLASS, attr: { [PROBE_ATTR]: id } })
  // Inside the viewport, because a base embed only runs its query once it is seen; invisible,
  // under everything and out of the way of the pointer.
  host.setCssStyles({
    position: 'fixed',
    left: '0',
    top: '0',
    width: '800px',
    height: '600px',
    opacity: '0',
    zIndex: '-1',
    pointerEvents: 'none',
    overflow: 'hidden',
  })
  const component = new Component()
  component.load()

  try {
    return await new Promise<ProbeResult>((resolve, reject) => {
      let settle: number | null = null
      const timer = window.setTimeout(() => {
        reject(
          new Error(
            `The base ${file.path} did not answer within ${timeoutMs / 1000} s. (${host.textContent?.slice(0, 120)})`
          )
        )
      }, timeoutMs)
      handlers.set(id, (result) => {
        if (settle !== null) window.clearTimeout(settle)
        settle = window.setTimeout(() => {
          window.clearTimeout(timer)
          resolve(result)
        }, SETTLE_MS)
      })
      MarkdownRenderer.render(app, '```base\n' + yaml + '```\n', host, file.path, component).catch(
        (e: unknown) => {
          window.clearTimeout(timer)
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      )
    })
  } finally {
    handlers.delete(id)
    component.unload()
    host.remove()
  }
}
