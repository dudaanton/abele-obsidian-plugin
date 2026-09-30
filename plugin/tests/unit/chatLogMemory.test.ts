import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformSync } from 'esbuild'

// String equality cannot reveal a V8 SlicedString's parent. Inspect an isolated heap instead
// of asserting RSS/GC thresholds or depending on undocumented native-syntax intrinsics.
const source = transformSync(readFileSync(resolve(__dirname, '../../src/ai/ChatLog.ts'), 'utf8'), {
  loader: 'ts',
  format: 'cjs',
}).code

function retainedLineTypes(kind: 'rewrite' | 'append'): { metadata: string; messages: string[] } {
  const script = `
    const module = { exports: {} };
    new Function('module', 'exports', ${JSON.stringify(source)})(module, module.exports);
    const { ChatLogWriter, parseChat, serializeChat } = module.exports;
    const writer = new ChatLogWriter();
    const state = {
      metadata: { type: 'abele-chat', title: 'Sample metadata '.repeat(16) },
      messages: [{ id: 'sample-user', role: 'user', content: 'Sample visible message '.repeat(16), timestamp: 1 }],
      internalMessages: [],
    };
    if (${JSON.stringify(kind)} === 'append') {
      writer.adopt(parseChat(serializeChat(state)));
      state.metadata.title = 'Sample changed metadata '.repeat(16);
      state.messages[0].content = 'Sample changed message '.repeat(16);
    }
    state.internalMessages.push({ role: 'toolResult', toolCallId: 'sample-call', toolName: 'read',
      content: [{ type: 'text', text: 'Sample large tool result '.repeat(32768) }], timestamp: 2 });
    const plan = writer.plan(state);
    if (plan.kind !== ${JSON.stringify(kind)}) throw new Error('Unexpected write plan');
    writer.commit(state, plan);
    // Reach the writer through a named root. Only inspect its retained lines, not temporary
    // strings elsewhere in the heap (including the deliberately still-live write plan).
    globalThis.__sampleChatWriter = writer;
    (async () => {
      let data = '';
      for await (const chunk of require('node:v8').getHeapSnapshot()) data += chunk;
      const heap = JSON.parse(data);
      const fields = heap.snapshot.meta.node_fields;
      const edgeFields = heap.snapshot.meta.edge_fields;
      const stride = fields.length, edgeStride = edgeFields.length;
      const typeAt = fields.indexOf('type'), nameAt = fields.indexOf('name'), countAt = fields.indexOf('edge_count');
      const edgeTypeAt = edgeFields.indexOf('type'), edgeNameAt = edgeFields.indexOf('name_or_index'), toAt = edgeFields.indexOf('to_node');
      const nodeTypes = heap.snapshot.meta.node_types[typeAt];
      const edgeTypes = heap.snapshot.meta.edge_types[edgeTypeAt];
      const edgesOf = new Map();
      let edge = 0;
      for (let node = 0; node < heap.nodes.length; node += stride) {
        const edges = [];
        for (let i = 0; i < heap.nodes[node + countAt]; i++, edge += edgeStride) {
          const type = edgeTypes[heap.edges[edge + edgeTypeAt]];
          const rawName = heap.edges[edge + edgeNameAt];
          edges.push({ name: type === 'element' || type === 'hidden' ? rawName : heap.strings[rawName], to: heap.edges[edge + toAt] });
        }
        edgesOf.set(node, edges);
      }
      const root = [...edgesOf.values()].flat().find(e => e.name === '__sampleChatWriter');
      if (!root) throw new Error('Writer root not found');
      const property = (node, name) => {
        const edge = edgesOf.get(node).find(e => e.name === name);
        if (!edge) throw new Error('Retained property not found: ' + name);
        return edge.to;
      };
      const kindOf = node => nodeTypes[heap.nodes[node + typeAt]];
      const nameOf = node => heap.strings[heap.nodes[node + nameAt]];
      const metadata = property(root.to, 'metaLine');
      const table = property(property(root.to, 'messageLines'), 'table');
      const messages = edgesOf.get(table).filter(e => nameOf(e.to).startsWith('{"k":"msg"') || kindOf(e.to) === 'sliced string' || kindOf(e.to) === 'concatenated string').map(e => kindOf(e.to));
      if (messages.length !== 1) throw new Error('Retained message line not found');
      process.stdout.write(JSON.stringify({ metadata: kindOf(metadata), messages }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `
  return JSON.parse(
    execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    })
  )
}

describe('committed chat log memory', () => {
  it.each(['rewrite', 'append'] as const)(
    'retains standalone lines, not slices of the %s buffer',
    (kind) => {
      expect(retainedLineTypes(kind)).toEqual({ metadata: 'string', messages: ['string'] })
    }
  )
})
