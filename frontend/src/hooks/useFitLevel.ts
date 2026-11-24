import { useLayoutEffect, useRef, useState } from 'react'

/**
 * How much a bar has to tighten to fit: 0 = everything at full size, up to `max`.
 * The bar's items must not shrink (shrink-0) at the levels being tested, so that
 * running out of room shows as overflow. Steps up while the bar overflows, and back
 * down when it has grown wide enough for the level before (remembered from when that
 * level overflowed), so it never flickers between two levels.
 *
 * `content` changes when what's in the bar changes (another mode, a longer name):
 * then it measures again from the top.
 *
 * Returns the level and a callback ref for the bar (it may mount later than the page).
 */
export function useFitLevel(max: number, content: unknown): [number, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [level, setLevel] = useState(0)
  const need = useRef<number[]>([])
  const key = useRef(content)

  useLayoutEffect(() => {
    if (key.current !== content) {
      key.current = content
      need.current = []
      if (level !== 0) {
        setLevel(0)
        return
      }
    }
    if (!el) return
    const check = () => {
      const over = el.scrollWidth > el.clientWidth + 1
      if (over) need.current[level] = el.scrollWidth
      if (over && level < max) setLevel(level + 1)
      else if (!over && level > 0 && need.current[level - 1] != null && el.clientWidth >= need.current[level - 1]!) setLevel(level - 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    // Text changing inside (a longer name) can overflow without the bar resizing.
    const mo = new MutationObserver(check)
    mo.observe(el, { subtree: true, childList: true, characterData: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [el, level, max, content])

  return [level, setEl]
}
