import { z } from 'zod'
import type { AgentTool, AgentToolResult } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { scopeOf, type ToolContext } from '../toolContext'
import { guardChatWrite } from './chatWriteGuard'
import { canvasPath, ObsidianCanvasStore } from '@/canvas/obsidianStore'
import {
  createCanvasGraph,
  graphInputSchema,
  planCanvasEdit,
  planCanvasLayout,
} from '@/canvas/core/service'
import { CanvasEditError, operationSchema } from '@/canvas/core/edit'
import { layoutOptionsSchema } from '@/canvas/core/layout'
import { canvasOutline } from '@/canvas/core/read'
import { serializeCanvas } from '@/canvas/core/model'
import { lintCanvas } from '@/canvas/core/lint'
import { bundledMermaid } from '@/canvas/mermaidAdapter'
import { canvasPicture, hostMetrics } from '@/canvas/pictureAdapter'

const path = z.string().describe('Exact vault-relative .canvas path')
const region = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict()
const answer = (value: unknown): AgentToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
})
function scoped(input: string, ctx?: ToolContext): string {
  const key = canvasPath(input)
  if (!scopeOf(ctx).isInScope(key))
    throw new Error(`Access denied: ${key} is outside this chat's scope`)
  return key
}
function definition<T extends z.ZodType>(
  name: string,
  label: string,
  description: string,
  schema: T,
  run: (params: z.output<T>, signal?: AbortSignal, ctx?: ToolContext) => Promise<AgentToolResult>
): AgentTool {
  return {
    name,
    label,
    category: 'Canvas',
    description,
    parameters: z.toJSONSchema(schema, { io: 'input' }),
    execute: async (_id, params, signal, ctx) => {
      signal?.throwIfAborted()
      let parsed: z.output<T>
      try {
        parsed = schema.parse(params)
      } catch (error) {
        if (name === 'canvas_edit' && error instanceof z.ZodError) {
          const path = error.issues.find(
            (issue) => issue.path[0] === 'ops' && typeof issue.path[1] === 'number'
          )?.path
          if (path) throw new CanvasEditError(path[1] as number, error)
        }
        throw error
      }
      return run(parsed, signal, ctx)
    },
  }
}
export function createCanvasTools(): AgentTool[] {
  return [
    definition(
      'canvas_read',
      'Read canvas',
      'Read a JSON Canvas diagram by stable ids, as a compact outline with group hierarchy, edges, stored steps and deterministic lint. detail=full includes geometry and all retained extension fields. region filters the outline. Works without an open tab; read-only. Array/key order is never identity.',
      z
        .object({
          path,
          detail: z.enum(['outline', 'full']).default('outline'),
          region: region.optional(),
        })
        .strict(),
      async (params, _signal, ctx) => {
        const key = scoped(params.path, ctx),
          store = new ObsidianCanvasStore(GlobalStore.getInstance().app)
        return answer(canvasOutline(await store.read(key), params, hostMetrics()))
      }
    ),
    definition(
      'canvas_create',
      'Create canvas',
      'Create a new .canvas from from.graph {nodes:[{id,kind:text|note|link|group|shape,label,file?,url?,shape?,parent?}],edges:[{id,fromNode,toNode,label?}]} or from.mermaid (a flowchart string), never both. Uses automatic layered dagre layout and fitted labels. Shape is an Advanced Canvas shape on a standard text node; never invent node types. Title is stored as metadata.frontmatter.title. Refuses an existing file. Own Ask mode like other writes.',
      z
        .object({
          path,
          title: z.string().default('Diagram'),
          from: z.union([
            z.object({ graph: graphInputSchema }).strict(),
            z.object({ mermaid: z.string().min(1) }).strict(),
          ]),
        })
        .strict(),
      async (params, signal, ctx) => {
        const key = canvasPath(params.path)
        guardChatWrite(key)
        const graph = await createCanvasGraph(
          params.from,
          params.title,
          bundledMermaid,
          hostMetrics()
        )
        signal?.throwIfAborted()
        await new ObsidianCanvasStore(GlobalStore.getInstance().app).create(key, graph, signal)
        scopeOf(ctx).addFile(key)
        return {
          ...answer({
            path: key,
            nodes: graph.nodes.length,
            edges: graph.edges.length,
            warnings: lintCanvas(graph),
          }),
          details: { path: key, diff: { old: '', new: serializeCanvas(graph) } },
        }
      }
    ),
    definition(
      'canvas_edit',
      'Edit canvas',
      'Apply a single validated atomic batch by id: add_node {node:{id,kind,label,...}}, update {id,patch}, remove {id}, connect {edge:{id,fromNode,toNode,...}}, group {id,label?,ids}, ungroup {id}, collapse {id,collapsed}, style {id,styleAttributes}. Unknown ids report the op index and suggestions; no partial writes. New unpositioned nodes auto-layout. Styles/abele updates merge retained fields. Removing a group promotes its children; removing a node removes incident edges. One native Canvas undo item when open. Own Ask mode.',
      z.object({ path, ops: z.array(operationSchema).min(1) }).strict(),
      async (params, signal, ctx) => {
        const key = scoped(params.path, ctx)
        guardChatWrite(key)
        const result = await new ObsidianCanvasStore(GlobalStore.getInstance().app).change(
          key,
          (graph) => planCanvasEdit(graph, params.ops, hostMetrics()),
          signal
        )
        return {
          ...answer({ path: key, warnings: lintCanvas(result.after) }),
          details: {
            path: key,
            diff: { old: serializeCanvas(result.before), new: serializeCanvas(result.after) },
          },
        }
      }
    ),
    definition(
      'canvas_layout',
      'Lay out canvas',
      'Lay out the diagram automatically: layered (dagre), tree, radial, or grid; direction LR/RL/TB/BT. scope is a group id; keep pins ids (a kept group pins its whole subtree). Nested groups are laid out one level at a time. Other extension data survives. Own Ask mode, one native undo item. Review warnings then inspect a region or node with look_at_canvas.',
      layoutOptionsSchema.extend({ path }),
      async (params, signal, ctx) => {
        const key = scoped(params.path, ctx)
        guardChatWrite(key)
        const { path: _path, ...options } = params
        const result = await new ObsidianCanvasStore(GlobalStore.getInstance().app).change(
          key,
          (graph) => planCanvasLayout(graph, options, hostMetrics()),
          signal
        )
        return {
          ...answer({ path: key, warnings: lintCanvas(result.after) }),
          details: {
            path: key,
            diff: { old: serializeCanvas(result.before), new: serializeCanvas(result.after) },
          },
        }
      }
    ),
    definition(
      'look_at_canvas',
      'Look at canvas',
      'See a diagram as a PNG, all of it or a crop by node id or region {x,y,width,height}. maxSide defaults 2048 (64–4096). Comes with deterministic overlap, edge-crossing, text/image clipping, isolation, missing-step-id and crowded-step warnings. Paints local note text and images only when in scope, using the host theme. Remote images are not fetched. A large diagram is unreadable as one picture: inspect node/region crops and fix lint first. Read-only, own On mode.',
      z
        .object({
          path,
          region: region.optional(),
          node: z.string().optional(),
          maxSide: z.number().min(64).max(4096).default(2048),
        })
        .strict(),
      async (params, signal, ctx) => {
        const key = scoped(params.path, ctx),
          app = GlobalStore.getInstance().app
        const graph = await new ObsidianCanvasStore(app).read(key)
        const picture = await canvasPicture(
          app,
          graph,
          key,
          params,
          (path) => scopeOf(ctx).isInScope(path),
          signal
        )
        return {
          ...answer({
            path: key,
            region: picture.region,
            width: picture.canvas.width,
            height: picture.canvas.height,
            visible: picture.visible,
            warnings: picture.warnings,
          }),
          injectMessages: [
            {
              role: 'user',
              timestamp: Date.now(),
              content: [
                { type: 'text', text: `[Canvas: ${key}]` },
                { type: 'image_url', image_url: { url: picture.canvas.toDataURL('image/png') } },
              ],
            },
          ],
        }
      }
    ),
  ]
}
