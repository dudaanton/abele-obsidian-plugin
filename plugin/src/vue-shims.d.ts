declare module '*.vue' {
  import { DefineComponent } from 'vue'
  // Vue's own shim shape: the empty object types stand for "props and emits unknown here".
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- see above
  const component: DefineComponent<{}, {}, any>
  export default component
}
