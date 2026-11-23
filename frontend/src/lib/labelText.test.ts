import { describe, expect, it } from 'vitest'
import { elementLabel, linkLabel, nodeLabel } from './labelText'

describe('map label text', () => {
  const node = { id: 'MH1', elevation: 76.96, max_depth: 6.25 }
  it('labels nodes', () => {
    expect(nodeLabel(node, 'id', true)).toBe('MH1')
    expect(nodeLabel(node, 'invert', true)).toBe('IE 76.96')
    expect(nodeLabel(node, 'rim', true)).toBe('RIM 83.21')
    expect(nodeLabel(node, 'max_depth', false)).toBe('6.25 m')
  })
  it('labels links, including slope from the end inverts', () => {
    const link = { id: 'C1', diameter: 1.5, length: 200, roughness: 0.013, from_node: 'A', to_node: 'B', in_offset: 0, out_offset: 0.5 }
    const elev = (id: string) => ({ A: 10, B: 8 })[id]
    expect(linkLabel(link, 'size', true, elev)).toBe('18 in')
    expect(linkLabel(link, 'size', false, elev)).toBe('1,500 mm')
    expect(linkLabel(link, 'slope', true, elev)).toBe('0.75 %')
    expect(linkLabel(link, 'roughness', true, elev)).toBe('n 0.013')
    expect(linkLabel({ ...link, from_node: 'X' }, 'slope', true, elev)).toBe('')
  })
})

describe('elementLabel', () => {
  const elev = () => undefined
  it('labels every SWMM element kind', () => {
    expect(elementLabel({ object_type: 'subcatchment', id: 'S1', area: 4.25 }, 'area', true, elev)).toBe('4.25 ac')
    expect(elementLabel({ object_type: 'subcatchment', id: 'S1', pct_imperv: 62 }, 'pct_imperv', false, elev)).toBe('62 % imp.')
    expect(elementLabel({ object_type: 'subcatchment', id: 'S1', outlet: 'J3' }, 'outlet', true, elev)).toBe('J3')
    expect(elementLabel({ object_type: 'link', link_kind: 'pump', id: 'P1', pump_curve: 'PC1' }, 'pump_curve', true, elev)).toBe('PC1')
    expect(elementLabel({ object_type: 'link', link_kind: 'weir', id: 'W1', crest_height: 1.5 }, 'crest_height', false, elev)).toBe('1.5 m')
    expect(elementLabel({ object_type: 'node', node_kind: 'outfall', id: 'O1', type: 'FREE' }, 'outfall_type', true, elev)).toBe('FREE')
    expect(elementLabel({ object_type: 'node', id: 'J1', elevation: 10 }, 'invert', true, elev)).toBe('IE 10')
    expect(elementLabel({ object_type: 'node', id: 'J1' }, 'none', true, elev)).toBe('')
  })
})
