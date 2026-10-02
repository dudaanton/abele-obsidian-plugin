/** Development-only host probes. No canvas engine or production registration lives here. */
import {
  MarkdownRenderChild,
  Plugin,
  TextFileView,
  TFile,
  loadMermaid,
  type WorkspaceLeaf,
} from 'obsidian'

const DIR = 'Sample canvas probe'
const TYPE = 'abele-canvas-probe'
const PATH = `${DIR}/sample.canvas`
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

interface NativeNode {
  x: number
  y: number
  width: number
  height: number
  nodeEl: HTMLElement
  moveAndResize(rect: { x: number; y: number; width: number; height: number }): void
}
interface NativeView extends TextFileView {
  canvas: {
    nodes: Map<string, NativeNode>
    requestSave(): void
    zoomToFit(): void
  }
  save(): Promise<void>
}
interface GraphData {
  [key: string]: unknown
  nodes: Record<string, unknown>[]
  edges: Record<string, unknown>[]
}

function fixture(): GraphData {
  return {
    abele: {
      steps: [{ reveal: ['alpha', 'beta', 'flow'], focus: 'alpha', say: 'Sample explanation' }],
      ink: [
        {
          id: 'sample-ink',
          points: [
            [1, 2],
            [3, 4],
          ],
        },
      ],
      layout: { direction: 'LR' },
    },
    metadata: { startNode: 'alpha', frontmatter: { topic: 'sample' } },
    sampleExtension: { version: 1 },
    nodes: [
      {
        abele: { level: 1, ink: [{ points: [[2, 3]] }] },
        styleAttributes: { shape: 'diamond', border: 'dashed' },
        id: 'alpha',
        type: 'text',
        text: 'Alpha sample',
        x: 0,
        y: 0,
        width: 240,
        height: 140,
        textAlign: 'center',
        zIndex: 2,
        dynamicHeight: true,
        sampleExtension: 'node',
      },
      {
        id: 'beta',
        type: 'text',
        text: 'Beta sample',
        x: 360,
        y: 0,
        width: 240,
        height: 140,
        styleAttributes: { shape: 'database' },
      },
      {
        id: 'note',
        type: 'file',
        file: `${DIR}/sample-note.md`,
        subpath: '#Sample',
        x: 0,
        y: 260,
        width: 240,
        height: 140,
        portal: true,
        abele: { level: 2 },
      },
      {
        id: 'link',
        type: 'link',
        url: 'https://example.invalid/sample',
        x: 360,
        y: 260,
        width: 240,
        height: 140,
        abele: { hint: 'sample' },
      },
      {
        id: 'group',
        type: 'group',
        label: 'Sample level',
        x: -60,
        y: -60,
        width: 720,
        height: 540,
        collapsed: true,
        abele: { level: 0 },
      },
    ],
    edges: [
      {
        abele: { hint: 'flow' },
        styleAttributes: { path: 'dashed', arrow: 'triangle' },
        id: 'flow',
        fromNode: 'alpha',
        toNode: 'beta',
        fromSide: 'right',
        toSide: 'left',
        label: 'next',
        pathfindingMethod: 'square',
        fromFloating: true,
        toFloating: true,
        sampleExtension: 'edge',
      },
    ],
  }
}

/** Strip geometry only: every extension value, standard field and element must survive. */
function withoutGeometry(data: GraphData): GraphData {
  return {
    ...data,
    nodes: data.nodes.map(({ x: _x, y: _y, width: _w, height: _h, ...rest }) => rest),
  }
}

class ProbeView extends TextFileView {
  getViewType(): string {
    return TYPE
  }
  getDisplayText(): string {
    return 'Canvas compatibility probe'
  }
  getViewData(): string {
    return this.data
  }
  setViewData(data: string): void {
    this.data = data
    this.contentEl.empty()
    this.contentEl.createEl('p', { text: 'Abele canvas probe — read-only placeholder' })
  }
  clear(): void {
    this.data = ''
    this.contentEl.empty()
  }
}

class EmbedProbe extends MarkdownRenderChild {
  private readonly styles = new Map<Element, string | null>()
  private observer: MutationObserver | null = null
  onload(): void {
    const hideNative = () => {
      for (const child of Array.from(this.containerEl.children)) {
        if (child.matches('.abele-canvas-probe-embed')) continue
        if (!this.styles.has(child)) this.styles.set(child, child.getAttribute('style'))
        // Native CSS overrides [hidden], and the minimap arrives after the initial render.
        const native = child as HTMLElement | SVGElement
        native.setCssStyles({ display: 'none' })
      }
    }
    hideNative()
    this.containerEl.createEl('p', {
      cls: 'abele-canvas-probe-embed',
      text: 'Abele canvas embed probe',
    })
    this.observer = new MutationObserver(hideNative)
    this.observer.observe(this.containerEl, { childList: true, subtree: true })
  }
  onunload(): void {
    this.observer?.disconnect()
    this.containerEl.querySelector('.abele-canvas-probe-embed')?.remove()
    for (const [child, style] of this.styles) {
      if (style === null) child.removeAttribute('style')
      else child.setAttribute('style', style)
    }
    this.styles.clear()
  }
}

export function createCanvasProbe(owner: Plugin) {
  const { app } = owner
  let host: Plugin | null = null
  let owned = false
  let layout: ReturnType<typeof app.workspace.getLayout> | null = null
  let nativeLeaf: WorkspaceLeaf | null = null
  const optedOut = new WeakSet<WorkspaceLeaf>()
  let adopting = false
  let enabled = false
  let timer = 0
  let observer: MutationObserver | null = null
  const original = fixture()
  const file = (path: string) => {
    const f = app.vault.getAbstractFileByPath(path)
    if (!(f instanceof TFile)) throw new Error(`Missing probe file: ${path}`)
    return f
  }
  const read = async (path = PATH): Promise<GraphData> =>
    JSON.parse(await app.vault.read(file(path)))
  const openNative = async (path = PATH) => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file(path))
    await app.workspace.revealLeaf(leaf)
    nativeLeaf = leaf
    await wait(500)
    if (leaf.view.getViewType() !== 'canvas') throw new Error('Native Canvas did not open')
    return leaf.view as NativeView
  }
  const adopt = async () => {
    if (!enabled || adopting) return
    adopting = true
    try {
      for (const leaf of app.workspace.getLeavesOfType('canvas')) {
        if (optedOut.has(leaf) || !(leaf.view as NativeView).file?.path.startsWith(`${DIR}/`))
          continue
        const state = leaf.getViewState()
        await leaf.setViewState({ ...state, type: TYPE })
      }
    } finally {
      adopting = false
    }
  }
  const schedule = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout((): void => void adopt(), 30)
  }
  const closeProbeLeaves = () => {
    app.workspace.iterateAllLeaves((leaf) => {
      if (
        (leaf.view as TextFileView).file?.path.startsWith(`${DIR}/`) ||
        leaf.view.getViewType() === TYPE
      )
        leaf.detach()
    })
    nativeLeaf = null
  }
  const api = {
    async setup() {
      if (host) throw new Error('Probe already running')
      if (app.vault.getAbstractFileByPath(DIR))
        throw new Error('Probe folder already exists; refusing to overwrite it')
      layout = app.workspace.getLayout()
      class ProbePlugin extends Plugin {
        onload(): void {}
      }
      host = new ProbePlugin(app, {
        id: TYPE,
        name: 'Canvas probe',
        description: 'Development-only compatibility probe',
        version: '0.0.0',
        minAppVersion: '1.0.0',
        author: '',
      })
      host.load()
      host.registerView(TYPE, (leaf) => new ProbeView(leaf))
      host.registerEvent(app.workspace.on('file-open', schedule))
      host.registerEvent(app.workspace.on('layout-change', schedule))
      host.register(() => window.clearTimeout(timer))
      await app.vault.createFolder(DIR)
      owned = true
      await app.vault.create(`${DIR}/sample-note.md`, '## Sample\n\nSample note content.')
      await app.vault.create(PATH, JSON.stringify(original, null, 2))
      await app.vault.create(
        `${DIR}/rename.canvas`,
        JSON.stringify({
          nodes: [
            {
              id: 'file',
              type: 'file',
              file: `${DIR}/sample-note.md`,
              x: 0,
              y: 0,
              width: 240,
              height: 140,
            },
            {
              id: 'text',
              type: 'text',
              text: '[[sample-note#Sample]]',
              x: 300,
              y: 0,
              width: 240,
              height: 140,
            },
          ],
          edges: [],
        })
      )
      await app.vault.create(`${DIR}/embed.md`, `![[${PATH}]]\n`)
      const view = await openNative()
      view.canvas.zoomToFit()
      await wait(500)
      return { ready: true, path: PATH, keys: Object.keys(original) }
    },
    /** For a physical drag: take the start point near the card's top, outside editable text. */
    dragTarget() {
      const node = (nativeLeaf?.view as NativeView).canvas.nodes.get('alpha')
      const rect = node.nodeEl.getBoundingClientRect()
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + 12,
        dx: 45,
        dy: 45,
        before: { x: node.x, y: node.y },
      }
    },
    async moveAndRead() {
      const view = nativeLeaf?.view as NativeView
      const node = view.canvas.nodes.get('alpha')
      node.moveAndResize({ x: node.x + 80, y: node.y + 50, width: node.width, height: node.height })
      view.canvas.requestSave()
      await view.save()
      return api.readMoved()
    },
    async readMoved() {
      const view = nativeLeaf?.view as NativeView
      view.canvas.requestSave()
      await view.save()
      const after = await read()
      const moved = after.nodes.find((n) => n.id === 'alpha')
      return {
        before: withoutGeometry(original),
        after: withoutGeometry(after),
        moved: moved.x !== 0 || moved.y !== 0,
        order: {
          fileBefore: Object.keys(original),
          fileAfter: Object.keys(after),
          nodeBefore: Object.keys(original.nodes[0]),
          nodeAfter: Object.keys(moved),
          edgeBefore: Object.keys(original.edges[0]),
          edgeAfter: Object.keys(after.edges[0]),
        },
        raw: await app.vault.read(file(PATH)),
      }
    },
    async unknownType() {
      const unknown = {
        id: 'future',
        type: 'sample-future-node',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        abele: { hint: 'future' },
      }
      const path = `${DIR}/unknown.canvas`
      await app.vault.create(
        path,
        JSON.stringify({ ...original, nodes: [...original.nodes, unknown] })
      )
      const view = await openNative(path)
      view.canvas.nodes.get('alpha').moveAndResize({ x: 100, y: 50, width: 240, height: 140 })
      view.canvas.requestSave()
      await view.save()
      const after = await read(path)
      return {
        kept: after.nodes.some((n) => n.id === 'future'),
        ids: after.nodes.map((n) => n.id),
        after,
      }
    },
    async rename() {
      closeProbeLeaves()
      await wait(500)
      await app.fileManager.renameFile(file(`${DIR}/sample-note.md`), `${DIR}/sample-renamed.md`)
      let data = await read(`${DIR}/rename.canvas`)
      for (let n = 0; n < 50 && data.nodes[0].file !== `${DIR}/sample-renamed.md`; n++) {
        await wait(100)
        data = await read(`${DIR}/rename.canvas`)
      }
      return { file: data.nodes[0].file, text: data.nodes[1].text }
    },
    async swap() {
      enabled = true
      const leaf = app.workspace.getLeaf('tab')
      await leaf.openFile(file(PATH))
      await wait(800)
      const adopted = leaf.view.getViewType()
      optedOut.add(leaf)
      await leaf.setViewState({ type: 'canvas', state: { file: PATH }, active: true })
      await wait(800)
      const native = leaf.view.getViewType()
      const next = app.workspace.getLeaf('tab')
      await next.openFile(file(PATH))
      await wait(800)
      const again = next.view.getViewType()
      enabled = false
      closeProbeLeaves()
      return { adopted, native, again }
    },
    async embed() {
      const claimed = new WeakSet<HTMLElement>()
      host.registerMarkdownPostProcessor((el, ctx) => {
        const candidates = el.matches('.internal-embed[src]')
          ? [el]
          : Array.from(el.querySelectorAll<HTMLElement>('.internal-embed[src]'))
        for (const embed of candidates)
          if (embed.getAttribute('src') === PATH && !claimed.has(embed)) {
            claimed.add(embed)
            ctx.addChild(new EmbedProbe(embed))
          }
      })
      // Native Live Preview embeds do not travel through markdown post-processors.
      const scan = () => {
        for (const embed of Array.from(
          document.querySelectorAll<HTMLElement>('.cm-editor .internal-embed[src]')
        )) {
          if (embed.getAttribute('src') !== PATH || claimed.has(embed)) continue
          claimed.add(embed)
          const child = new EmbedProbe(embed)
          host.addChild(child)
        }
      }
      observer = new MutationObserver(scan)
      observer.observe(document.body, { childList: true, subtree: true })
      const leaf = app.workspace.getLeaf('tab')
      await leaf.setViewState({
        type: 'markdown',
        state: { file: `${DIR}/embed.md`, mode: 'preview' },
        active: true,
      })
      await app.workspace.revealLeaf(leaf)
      await wait(1200)
      const nativeHidden = () => {
        const box = leaf.view.containerEl.querySelector('.abele-canvas-probe-embed')?.parentElement
        return (
          !!box &&
          Array.from(box.children)
            .filter((child) => !child.matches('.abele-canvas-probe-embed'))
            .every((child) => child.getBoundingClientRect().height === 0)
        )
      }
      const reading = !!leaf.view.containerEl.querySelector('.abele-canvas-probe-embed')
      const readingNativeHidden = nativeHidden()
      await leaf.setViewState({
        type: 'markdown',
        state: { file: `${DIR}/embed.md`, mode: 'source', source: false },
        active: true,
      })
      await wait(1200)
      const live = !!leaf.view.containerEl.querySelector('.cm-editor .abele-canvas-probe-embed')
      return { reading, live, readingNativeHidden, liveNativeHidden: nativeHidden() }
    },
    async mermaid() {
      const mermaid = await loadMermaid()
      const graph = await mermaid.mermaidAPI.getDiagramFromText(
        'flowchart LR\nsubgraph level[Sample level]\nalpha[Alpha] -->|next| beta{Beta}\nend\nbeta --> gamma[Gamma]'
      )
      const db = graph.db
      const vertices = db.getVertices()
      return {
        nodes: (vertices instanceof Map
          ? Array.from(vertices.keys())
          : Object.keys(vertices)
        ).sort(),
        edges: db
          .getEdges()
          .map(
            (e: { start: string; end: string; text: string }) => `${e.start}->${e.end}:${e.text}`
          ),
        groups: db.getSubGraphs().map((g: { id: string }) => g.id),
      }
    },
    async cleanup() {
      enabled = false
      observer?.disconnect()
      observer = null
      closeProbeLeaves()
      host?.unload()
      host = null
      await wait(500)
      const dir = owned ? app.vault.getAbstractFileByPath(DIR) : null
      if (dir) await app.fileManager.trashFile(dir)
      owned = false
      if (layout) await app.workspace.changeLayout(layout)
      layout = null
      return { cleaned: true }
    },
  }
  owner.register(() => {
    observer?.disconnect()
    window.clearTimeout(timer)
    host?.unload()
  })
  return api
}
