/** A renderer can finish emitting after its book has been replaced in the tab. */
export function onReaderEvent(
  target: EventTarget,
  name: string,
  current: () => boolean,
  listener: (event: Event) => void
): void {
  target.addEventListener(name, (event) => {
    if (current()) listener(event)
  })
}
