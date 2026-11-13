/** Keep a sidebar swipe on the exposed track, including with a wide mobile thumb. */
export function sliderTrackPoint(
  left: number,
  width: number,
  thumbCenter: number,
  thumbWidth: number,
  preferred: number
) {
  const point = [preferred, left + width / 2, left + width / 4, left + (width * 3) / 4].find(
    (x) => x > left && x < left + width && Math.abs(x - thumbCenter) > thumbWidth / 2 + 4
  )
  if (point === undefined) throw Error('The slider has no exposed track for a sidebar swipe')
  return point
}
