import { build, transform } from 'esbuild'
import { posix } from 'node:path'

const TARGET = ['es2022', 'chrome91', 'safari15']
const IMPORT = '_imp__' // Same width as `import`, preserving the incoming source-map columns.
const inlineMap = (map) =>
  'data:application/json;charset=utf-8;base64,' +
  Buffer.from(JSON.stringify(map)).toString('base64')

/** Embed Rollup's chunks as cached CommonJS factories. Unlike inlineDynamicImports,
 * optional chunks keep both initialization and function allocation behind first use. */
export function singleFileLazyPlugin() {
  let production = false
  let sourcemap = false
  let intro = ''
  return {
    name: 'abele-single-file-lazy',
    enforce: 'post',
    configResolved(config) {
      production = config.mode === 'production'
      sourcemap = !!config.build.sourcemap
    },
    outputOptions(options) {
      intro = typeof options.intro === 'string' ? options.intro : ''
      return {
        ...options,
        format: 'es',
        inlineDynamicImports: false,
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        intro: '',
      }
    },
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const chunks = Object.values(bundle).filter((one) => one.type === 'chunk')
        const entries = chunks.filter((one) => one.isEntry)
        if (entries.length !== 1) throw new Error('Expected one plugin entry')
        const entry = entries[0]
        const names = new Set(chunks.map((one) => one.fileName))
        const files = new Map()
        const factories = await Promise.all(
          chunks.map(async (chunk, index) => {
            const imports = Object.fromEntries(
              [...chunk.imports, ...chunk.dynamicImports].flatMap((name) => {
                if (!names.has(name)) return []
                let relative = posix.relative(posix.dirname(chunk.fileName), name)
                if (!relative.startsWith('.')) relative = './' + relative
                return [[relative, name]]
              })
            )
            if (chunk.code.includes(IMPORT)) throw new Error('Embedded import identifier collision')
            const replacements = []
            const visit = (node) => {
              if (!node || typeof node !== 'object') return
              if (node.type === 'ImportExpression' && Object.hasOwn(imports, node.source.value))
                replacements.push(node.start)
              for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(visit)
                else if (value && typeof value === 'object') visit(value)
              }
            }
            visit(this.parse(chunk.code))
            let code = chunk.code
            for (const start of replacements.sort((a, b) => b - a))
              code = code.slice(0, start) + IMPORT + code.slice(start + 6)
            if (sourcemap && chunk.map) code += '\n//# sourceMappingURL=' + chunk.map.toUrl()
            const compiled = await transform(code, {
              format: 'cjs',
              target: TARGET,
              minify: production,
              legalComments: 'eof',
              sourcefile: chunk.fileName,
              sourcemap: sourcemap ? 'external' : false,
            })
            const path = `/factory-${index}.js`
            let wrapped = `export default function(module,exports,require,${IMPORT}){\n${compiled.code}\n}`
            if (sourcemap) {
              const map = JSON.parse(compiled.map)
              map.mappings = ';' + map.mappings
              wrapped += '\n//# sourceMappingURL=' + inlineMap(map)
            }
            files.set(path, wrapped)
            return { path, imports, name: chunk.fileName, index }
          })
        )
        files.set(
          '/entry.js',
          factories
            .map((one) => `import factory${one.index} from ${JSON.stringify(one.path)};`)
            .join('\n') +
            `
(function(nativeRequire){
const factories={${factories.map((one) => `${JSON.stringify(one.name)}:[factory${one.index},${JSON.stringify(one.imports)}]`).join(',')}};
const cache=Object.create(null), failures=new Map();
function load(name){
  if(failures.has(name)) throw failures.get(name);
  if(cache[name]) return cache[name].exports;
  const module={exports:{}}; cache[name]=module;
  const [factory,imports]=factories[name];
  try { factory(module,module.exports,key=>Object.prototype.hasOwnProperty.call(imports,key)?load(imports[key]):nativeRequire(key),key=>Promise.resolve().then(()=>load(imports[key]))); }
  catch(error){delete cache[name];failures.set(name,error);throw error;}
  return module.exports;
}
module.exports=load(${JSON.stringify(entry.fileName)});
})(require);`
        )
        const rendered = await build({
          entryPoints: ['/entry.js'],
          outfile: '/main.js',
          bundle: true,
          format: 'cjs',
          platform: 'neutral',
          target: TARGET,
          minify: production,
          legalComments: 'eof',
          write: false,
          sourcemap: sourcemap ? 'external' : false,
          banner: { js: intro },
          plugins: [
            {
              name: 'embedded-factories',
              setup(builder) {
                builder.onResolve({ filter: /.*/ }, (args) => {
                  if (!files.has(args.path))
                    throw new Error('Missing embedded factory: ' + args.path)
                  return { path: args.path, namespace: 'embedded' }
                })
                builder.onLoad({ filter: /.*/, namespace: 'embedded' }, (args) => ({
                  contents: files.get(args.path),
                  loader: 'js',
                }))
              },
            },
          ],
        })
        entry.code = rendered.outputFiles.find((one) => one.path.endsWith('.js')).text
        entry.map = null
        if (sourcemap) {
          const map = JSON.parse(rendered.outputFiles.find((one) => one.path.endsWith('.map')).text)
          entry.map = { ...map, toString: () => JSON.stringify(map), toUrl: () => inlineMap(map) }
        }
        entry.modules = Object.assign({}, ...chunks.map((one) => one.modules))
        entry.imports = [
          ...new Set(chunks.flatMap((one) => one.imports).filter((name) => !names.has(name))),
        ]
        entry.dynamicImports = []
        for (const chunk of chunks) if (chunk !== entry) delete bundle[chunk.fileName]
      },
    },
  }
}
