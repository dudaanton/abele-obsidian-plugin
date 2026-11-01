// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'vite'
import { runInNewContext } from 'node:vm'
import { schemaPurityPlugin } from '../../scripts/schema-purity.mjs'

it('omits unreachable schema construction while keeping reachable validation and its callbacks', async () => {
  const source = '/sample/node_modules/@abele/sync-sdk/dist/internal/protocol/sample.js'
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'sample-schema',
        resolveId(id) {
          if (id === '/sample/entry.js' || id === source) return id
        },
        load(id) {
          if (id === '/sample/entry.js') return `export { UsedSchema } from '${source}'`
          if (id === source)
            return `const z={string(){globalThis.created++;return {parse(value){if(typeof value!=='string')throw new Error('invalid');return value}}}}; export const UsedSchema=z.string(); export const UnusedSchema=z.string();`
        },
      },
      schemaPurityPlugin(),
    ],
    build: { write: false, minify: false, lib: { entry: '/sample/entry.js', formats: ['cjs'] } },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) => one.output)
  const module = { exports: {} as any },
    ctx = { module, exports: module.exports, created: 0 }
  runInNewContext(outputs.find((one) => one.type === 'chunk')!.code, ctx)
  expect(ctx.created).toBe(1)
  expect(module.exports.UsedSchema.parse('sample')).toBe('sample')
  expect(() => module.exports.UsedSchema.parse(3)).toThrow('invalid')
})

it('never annotates parsing, global hooks, or calls inside validation callbacks', () => {
  const source = `const SampleSchema = z.string().refine(value => { z.string(); return value !== 'invalid' }); const parsed = SampleSchema.parse('sample'); z.config({}); SampleSchema.register(registry)`
  const result = schemaPurityPlugin().transform(source, '/sample/src/schemas.ts')
  expect(result.code).toContain('/* @__PURE__ */z.string()')
  expect(result.code).toContain("value => { z.string(); return value !== 'invalid' }")
  expect(result.code).toContain("const parsed = SampleSchema.parse('sample')")
  expect(result.code).toContain('z.config({})')
  expect(result.code).toContain('SampleSchema.register(registry)')
})

it('does not parse non-JavaScript source formats as a TypeScript module', () => {
  expect(
    schemaPurityPlugin().transform('const SampleSchema = z.string()', '/sample/src/Form.vue')
  ).toBeNull()
})
