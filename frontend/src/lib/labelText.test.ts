import { describe, expect, it } from 'vitest'
import { linkLabel, nodeLabel } from './labelText'

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
