import { z } from 'zod'
import type { AgentTool, AgentToolResult } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { scopeOf, type ToolContext } from '../toolContext'
import { guardChatWrite } from './chatWriteGuard'
import { canvasPath, ObsidianCanvasStore } from '@/canvas/obsidianStore'
import type { CanvasWriteTool, CanvasProposalOwner } from '@/canvas/documentRegistry'
import {
  createCanvasGraph,
  graphInputSchema,
  planCanvasEdit,
  planCanvasLayout,
} from '@/canvas/core/service'
import { CanvasEditError, operationSchema } from '@/canvas/core/edit'
import { layoutOptionsSchema } from '@/canvas/core/layout'
import { canvasOutline } from '@/canvas/core/read'
import { editCanvasSteps, stepOperationSchema } from '@/canvas/core/steps'
import { serializeCanvas } from '@/canvas/core/model'
import { lintCanvas } from '@/canvas/core/lint'
import { bundledMermaid } from '@/canvas/mermaidAdapter'
import { canvasPicture, hostMetrics } from '@/canvas/pictureAdapter'
import { exportCanvas, exportPath } from '@/canvas/exportAdapter'

const path = z.string().describe('Exact vault-relative .canvas path')
const revision = z
  .string()
  .min(1)
  .describe(
    'Revision from canvas_read or the last successful canvas write; stale revisions are refused'
  )
const recoveryInputSchema = z
  .object({
    path,
    revision,
    recovery: z.enum(['retry', 'reapply', 'discard']),
    proposal: z.string().min(1),
  })
  .strict()
function proposalOwner(ctx: ToolContext | undefined, tool: CanvasWriteTool): CanvasProposalOwner {
  return { actor: JSON.stringify([ctx?.session?.id ?? null, ctx?.agentId ?? null]), tool }
}
async function recoverProposal(
  tool: CanvasWriteTool,
  key: string,
  params: z.output<typeof recoveryInputSchema>,
  signal?: AbortSignal,
  ctx?: ToolContext
): Promise<AgentToolResult> {
  const result = await new ObsidianCanvasStore(GlobalStore.getInstance().app).recover(
    key,
    params.revision,
    params.proposal,
    params.recovery,
    proposalOwner(ctx, tool),
    signal
  )
  return {
    ...answer({
      path: key,
      revision: result.revision,
      recovered: result.recovery,
      warnings: lintCanvas(result.after),
      ...(result.warning ? { storageWarning: result.warning } : {}),
    }),
    details: {
      path: key,
      diff: { old: serializeCanvas(result.before), new: serializeCanvas(result.after) },
    },
  }
}
const recoveryHelp =
  ' A failed agent proposal is reported by canvas_read(state.recovery). To recover it explicitly, use this same tool with {path,revision,recovery:retry|reapply|discard,proposal}, without ordinary edit/layout/step arguments. Retry publishes only on its unchanged baseline; reapply reruns its structured operation on the latest baseline; discard does not write the file. The original agent/chat and this tool permission are required; human drafts are never recovered implicitly.'
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
function toolParameters(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { io: 'input' })
  if (!json.anyOf) return json
  // Providers require an object root. The Zod union still enforces the exact command/recovery alternatives.
  const { anyOf, ...rest } = json
  const properties = Object.assign({}, ...anyOf.map((alternative) => alternative.properties ?? {}))
  return {
    ...rest,
    type: 'object',
    properties,
    required: ['path', 'revision'],
    additionalProperties: false,
  }
}
function nestedIssues(issues: z.ZodError['issues']): z.ZodError['issues'] {
  return issues.flatMap((issue) => [
    issue,
    ...(issue.code === 'invalid_union' ? nestedIssues(issue.errors.flat()) : []),
  ])
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
    parameters: toolParameters(schema),
    execute: async (_id, params, signal, ctx) => {
      signal?.throwIfAborted()
      let parsed: z.output<T>
      try {
        parsed = schema.parse(params)
      } catch (error) {
        if (name === 'canvas_edit' && error instanceof z.ZodError) {
          const path = nestedIssues(error.issues).find(
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
      'Read a JSON Canvas diagram and its write revision by stable ids, as a compact outline with group hierarchy, edges, free line/arrow primitives (lines with stable ids, geometry and style), stored steps and deterministic lint. detail=full includes geometry and all retained extension fields. region filters the outline; step (one-based) shows cumulative revealed content and camera/narration. Works without an open tab; read-only. Open Abele sessions expose pending graph content and state (generation, dirty, busy, conflict, native writer presence and failed-proposal recovery instructions); a pending read never commits text. Node/edge array order preserves stacking, not identity.',
      z
        .object({
          path,
          detail: z.enum(['outline', 'full']).default('outline'),
          step: z.number().int().positive().optional(),
          region: region.optional(),
        })
        .strict(),
      async (params, _signal, ctx) => {
        const key = scoped(params.path, ctx),
          store = new ObsidianCanvasStore(GlobalStore.getInstance().app)
        const snapshot = await store.snapshot(key)
        return answer({
          ...canvasOutline(snapshot.graph, params, hostMetrics()),
          revision: snapshot.revision,
          ...(snapshot.state ? { state: snapshot.state } : {}),
        })
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
            revision: (await new ObsidianCanvasStore(GlobalStore.getInstance().app).snapshot(key))
              .revision,
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
      'Pass revision from canvas_read or the last successful write; stale file/native/Abele session state is refused before any agent change; pending human drafts remain unsaved and block writes. Apply a single validated atomic batch by id: add_node {node:{id,kind,label,...}}, update {id,patch}, move {ids,dx,dy} (nodes and free lines; group descendants move once), add_line {line:{version:1,id,from:{x,y},to:{x,y},fromEnd?:none|arrow,toEnd?:none|arrow,label?,color?}}, remove {id}, connect {edge:{id,fromNode,toNode,...}}, group {id,label?,ids}, ungroup {id}, collapse {id,collapsed}, style {id,styleAttributes}. Unknown ids report the op index and suggestions; no partial writes. New unpositioned nodes auto-layout. Styles/abele updates merge retained fields. Removing a group promotes its children; removing a node removes incident edges. One shared Abele session or native Canvas undo item when open. Own Ask mode.' +
        recoveryHelp,
      z.union([
        z.object({ path, revision, ops: z.array(operationSchema).min(1) }).strict(),
        recoveryInputSchema,
      ]),
      async (params, signal, ctx) => {
        const key = scoped(params.path, ctx)
        guardChatWrite(key)
        if ('recovery' in params) return recoverProposal('canvas_edit', key, params, signal, ctx)
        // Tool arguments are JSON; approval queues can wrap retained patch fields in Vue proxies.
        const operations = JSON.parse(JSON.stringify(params.ops)) as typeof params.ops
        const result = await new ObsidianCanvasStore(GlobalStore.getInstance().app).change(
          key,
          params.revision,
          (graph) => planCanvasEdit(graph, operations, hostMetrics()),
          signal,
          proposalOwner(ctx, 'canvas_edit')
        )
        return {
          ...answer({
            path: key,
            revision: result.revision,
            warnings: lintCanvas(result.after),
            ...(result.warning ? { storageWarning: result.warning } : {}),
          }),
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
      'Pass revision from canvas_read or the last successful write; a changed version is refused and must be reread. Lay out the diagram automatically: layered (dagre), tree, radial, or grid; direction LR/RL/TB/BT. scope is a group id; keep pins ids (a kept group pins its whole subtree). Nested groups are laid out one level at a time. Other extension data survives. Own Ask mode, one Abele session or native undo item; pending drafts block writes. Review warnings then inspect a region or node with look_at_canvas.' +
        recoveryHelp,
      z.union([layoutOptionsSchema.extend({ path, revision }), recoveryInputSchema]),
      async (params, signal, ctx) => {
        const key = scoped(params.path, ctx)
        guardChatWrite(key)
        if ('recovery' in params) return recoverProposal('canvas_layout', key, params, signal, ctx)
        const { path: _path, revision: _revision, ...options } = params
        const result = await new ObsidianCanvasStore(GlobalStore.getInstance().app).change(
          key,
          params.revision,
          (graph) => planCanvasLayout(graph, options, hostMetrics()),
          signal,
          proposalOwner(ctx, 'canvas_layout')
        )
        return {
          ...answer({
            path: key,
            revision: result.revision,
            warnings: lintCanvas(result.after),
            ...(result.warning ? { storageWarning: result.warning } : {}),
          }),
          details: {
            path: key,
            diff: { old: serializeCanvas(result.before), new: serializeCanvas(result.after) },
          },
        }
      }
    ),
    definition(
      'canvas_steps',
      'Define canvas walkthrough',
      'Define an ordered explanation under abele.steps, by stable step and diagram ids. Pass the revision from canvas_read. Atomic ops: replace {steps}, upsert {step,before?:stepId|null}, remove {id}, move {id,before:stepId|null}. Each step has {id,reveal:ids[],say:string,highlight?:ids[],focus?:nodeOrEdgeId|{x,y,width,height}}. Reveal is cumulative; a group reveals its descendants, connections appear when both endpoints are visible. Highlight never reveals hidden nodes. before=null appends; upsert without before updates in place. Abele session or native Canvas undo is one batch; pending drafts block writes. Own Ask mode; scope and write guards apply. Aim for at most seven new cards per step; inspect with look_at_canvas(step=1-based number).' +
        recoveryHelp,
      z.union([
        z.object({ path, revision, ops: z.array(stepOperationSchema).min(1) }).strict(),
        recoveryInputSchema,
      ]),
      async (params, signal, ctx) => {
        const key = scoped(params.path, ctx)
        guardChatWrite(key)
        if ('recovery' in params) return recoverProposal('canvas_steps', key, params, signal, ctx)
        const operations = structuredClone(params.ops)
        const result = await new ObsidianCanvasStore(GlobalStore.getInstance().app).change(
          key,
          params.revision,
          (graph) => editCanvasSteps(graph, operations),
          signal,
          proposalOwner(ctx, 'canvas_steps')
        )
        return {
          ...answer({
            path: key,
            revision: result.revision,
            steps: result.after.abele?.steps,
            warnings: lintCanvas(result.after),
            ...(result.warning ? { storageWarning: result.warning } : {}),
          }),
          details: {
            path: key,
            diff: { old: serializeCanvas(result.before), new: serializeCanvas(result.after) },
          },
        }
      }
    ),
    definition(
      'canvas_export',
      'Export whole canvas',
      'Export a captured complete canvas revision to a new PNG, raster-backed SVG, or single-page raster PDF. Independent of camera and walkthrough step. Local note and image assets are read only within scope; missing or oversized assets produce warnings. maxSide defaults 4096 (64–4096). Output is an exact new vault-relative attachment path with matching extension; existing files are never overwritten. Does not save drafts or change the source. Own Ask permission authorizes creating this output; success adds it to chat scope. Returns captured revision, bounds, dimensions and warnings. SVG contains PNG pixels, not editable vectors; PDF contains a JPEG image, not selectable text.',
      z
        .object({
          path,
          output: z.string(),
          format: z.enum(['png', 'svg', 'pdf']),
          maxSide: z.number().int().min(64).max(4096).default(4096),
        })
        .strict(),
      async (params, signal, ctx) => {
        const key = scoped(params.path, ctx),
          output = exportPath(params.output, params.format)
        guardChatWrite(output)
        const result = await exportCanvas(GlobalStore.getInstance().app, {
          ...params,
          path: key,
          output,
          inScope: (path) => scopeOf(ctx).isInScope(path),
          signal,
        })
        scopeOf(ctx).addFile(result.file.path)
        const { file, ...details } = result
        return {
          ...answer({ path: file.path, source: key, ...details }),
          details: { path: file.path },
        }
      }
    ),
    definition(
      'look_at_canvas',
      'Look at canvas',
      'See a diagram as a PNG, all of it, a one-based step with its camera/highlights/narration, or a crop by node id or region {x,y,width,height}. maxSide defaults 2048 (64–4096). Comes with deterministic overlap, edge-crossing, text/image clipping, isolation, missing-step-id and crowded-step warnings. Paints local note text and images only when in scope, using the host theme. Remote images are not fetched. A large diagram is unreadable as one picture: inspect node/region crops and fix lint first. Read-only, own On mode.',
      z
        .object({
          path,
          region: region.optional(),
          node: z.string().optional(),
          step: z.number().int().positive().optional(),
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
            say: picture.say,
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
