declare module 'dom-to-image-more' {
  interface Options {
    width?: number
    height?: number
    style?: Partial<CSSStyleDeclaration>
    quality?: number
    bgcolor?: string
    filter?: (node: Node) => boolean
  }

  function toPng(node: HTMLElement, options?: Options): Promise<string>
  function toJpeg(node: HTMLElement, options?: Options): Promise<string>
  function toBlob(node: HTMLElement, options?: Options): Promise<Blob>
  function toSvg(node: HTMLElement, options?: Options): Promise<string>
  function toCanvas(node: HTMLElement, options?: Options): Promise<HTMLCanvasElement>
  function toPixelData(node: HTMLElement, options?: Options): Promise<Uint8ClampedArray>

  export default { toPng, toJpeg, toBlob, toSvg, toCanvas, toPixelData }
}
