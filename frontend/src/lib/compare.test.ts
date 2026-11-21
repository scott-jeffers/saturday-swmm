import { describe, expect, it } from 'vitest'
import { changeSnapshot } from './compare'

const snap = (depths: number[], flows: number[]) => ({
  period: 3, node_ids: ['J1', 'J2'], link_ids: ['C1', 'C2'], node_depths: depths, link_flows: flows,
  node_depth_min: 0, node_depth_max: 0, link_flow_min: 0, link_flow_max: 0,
})

describe('changeSnapshot', () => {
  it('is current minus compared, flows by size, with symmetric extents', () => {
    const c = changeSnapshot(snap([1, 2], [-3, 4]), snap([1.5, 1], [5, 1]))!
    expect(c.node_depths).toEqual([-0.5, 1])
    expect(c.link_flows).toEqual([-2, 3]) // |−3| − |5|, |4| − |1|
    expect(c.node_depth_max).toBe(1)
    expect(c.node_depth_min).toBe(-1)
    expect(c.link_flow_max).toBe(3)
  })
  it('matches elements by id, not position', () => {
    const other = { ...snap([2, 9], [0, 0]), node_ids: ['J2', 'J1'] }
    expect(changeSnapshot(snap([1, 2], [0, 0]), other)!.node_depths).toEqual([-8, 0])
  })
  it('needs both runs', () => {
    expect(changeSnapshot(null, snap([1], [1]))).toBeNull()
  })
})
