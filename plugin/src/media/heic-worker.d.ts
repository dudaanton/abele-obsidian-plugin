declare module 'heic-to/next' {
  export { heicTo } from 'heic-to'
}

declare module 'virtual:heic-worker' {
  const source: string
  export default source
}
