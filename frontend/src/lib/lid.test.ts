import { describe, expect, it } from 'vitest'
import { newDesign, parseLidControls, parseLidUsage, serializeLidControls, serializeLidUsage } from './lid'

const rows = (lines: string[]) => lines.map((l) => ({ values: l.split(/\s+/), comment: '' }))

describe('LID controls', () => {
  const src = rows([
    'RainGarden RG',
    'RainGarden SURFACE 6 0.2 0.1 1 5',
    'RainGarden SOIL 18 0.5 0.2 0.1 0.5 10 3.5',
    'Porous PP',
    'Porous SURFACE 0 0 0.012 1 5',
    'Porous PAVEMENT 6 0.15 0 100 0',
    'Porous STORAGE 12 0.75 0.5 0',
    'Porous DRAIN 0 0.5 6 6',
    'Porous REMOVALS TSS 80 TP 40',
  ])

  it('round-trips designs and keeps removals', () => {
    const d = parseLidControls(src)
    expect(d.map((x) => [x.name, x.type])).toEqual([
      ['RainGarden', 'RG'],
      ['Porous', 'PP'],
    ])
    expect(d[1]!.layers.REMOVALS).toEqual(['TSS', '80', 'TP', '40'])
    expect(serializeLidControls(d).map((r) => r.values.join(' '))).toEqual(src.map((r) => r.values.join(' ')))
  })

  it('makes a new design with every layer its type needs', () => {
    const d = newDesign('BR1', 'BC', false)
    expect(Object.keys(d.layers)).toEqual(['SURFACE', 'SOIL', 'STORAGE', 'DRAIN'])
    expect(d.layers.SOIL![0]).toBe('304.8') // 12 in → mm
  })

  it('round-trips usage and drops empty optional tail', () => {
    const u = parseLidUsage(rows(['S1 RainGarden 4 50 0 0 25 1 * * 0', 'S2 Porous 1 300 0 0 100 0']))
    expect(u[0]!.number).toBe('4')
    const back = serializeLidUsage(u).map((r) => r.values.join(' '))
    expect(back).toEqual(['S1 RainGarden 4 50 0 0 25 1 * * 0', 'S2 Porous 1 300 0 0 100 0'])
  })
})
