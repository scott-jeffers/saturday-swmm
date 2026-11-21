import { describe, expect, it } from 'vitest'
import { hoursLabel, parseControls, replaceRule, rulesByTarget } from './controls'

const BELLINGE = `RULE VACIADO_ON
IF NODE G71F06R DEPTH < 0.36
AND NODE G72K020 DEPTH < 0.40
AND PUMP P1 TIMECLOSED > 00:02
THEN PUMP P1 STATUS = ON
RULE GATE
; close the gate in rain
IF NODE G72K020 DEPTH > 0.43
OR SIMULATION TIME > 12
THEN ORIFICE OR1 SETTING = 0
AND PUMP P1 STATUS = OFF
ELSE ORIFICE OR1 SETTING = 1
PRIORITY 2`

describe('control rules', () => {
  it('reads rules, conditions and actions', () => {
    const d = parseControls(BELLINGE)
    expect(d.rules.map((r) => r.name)).toEqual(['VACIADO_ON', 'GATE'])
    const [a, b] = d.rules
    expect(a.errors).toEqual([])
    expect(a.conditions[2]).toMatchObject({ join: 'AND', left: { object: 'PUMP', id: 'P1', attr: 'TIMECLOSED' }, op: '>', right: '00:02' })
    expect(b.conditions[1]).toMatchObject({ join: 'OR', left: { object: 'SIMULATION', attr: 'TIME' } })
    expect(b.actions.map((x) => `${x.branch} ${x.target.id} ${x.value}`)).toEqual(['THEN OR1 0', 'THEN P1 OFF', 'ELSE OR1 1'])
    expect(b.priority).toBe(2)
    expect(b.errors).toEqual([])
  })

  it('reports mistakes in plain words', () => {
    const d = parseControls('RULE X\nIF NODE J9 DEPTH 3\nTHEN NODE J1 STATUS = ON', { nodes: new Set(['J1']) })
    expect(d.rules[0].errors.join(' ')).toMatch(/comparison/)
    expect(d.rules[0].errors.join(' ')).toMatch(/actions change a PUMP/)
    const u = parseControls('RULE Y\nIF NODE J9 DEPTH > 3\nTHEN PUMP P1 STATUS = ON', { nodes: new Set(['J1']), links: new Set(['P1']) })
    expect(u.rules[0].errors).toEqual(['Line 2: there is no node J9 in the model.'])
  })

  it('compares two variables and uses declared names', () => {
    const d = parseControls('VARIABLE N1_D = NODE N1 DEPTH\nRULE R\nIF N1_D > NODE N2 DEPTH\nTHEN WEIR W1 SETTING = CURVE C1')
    const r = d.rules[0]
    expect(r.errors).toEqual([])
    expect(r.conditions[0].left.kind).toBe('variable')
    expect(r.conditions[0].right).toMatchObject({ object: 'NODE', id: 'N2', attr: 'DEPTH' })
    expect(r.actions[0].value).toBe('CURVE C1')
    expect(d.preamble).toMatch(/VARIABLE/)
  })

  it('replaces one rule and keeps the rest as written', () => {
    const t = replaceRule(BELLINGE, 0, 'RULE NEW\nIF NODE A DEPTH > 1\nTHEN PUMP P1 STATUS = ON')
    expect(t).toContain('; close the gate in rain')
    expect(parseControls(t).rules.map((r) => r.name)).toEqual(['NEW', 'GATE'])
    expect(parseControls(replaceRule(t, 1, null)).rules.map((r) => r.name)).toEqual(['NEW'])
    expect(parseControls(replaceRule(t, -1, 'RULE Z\nIF NODE A DEPTH > 1\nTHEN PUMP P1 STATUS = ON')).rules.length).toBe(3)
  })

  it('keeps every other line, blank lines included, as written', () => {
    const t = ';; header\n\nRULE A\nIF NODE N DEPTH > 1\nTHEN PUMP P STATUS = ON\n\nRULE B\nIF NODE N DEPTH < 1\nTHEN PUMP P STATUS = OFF'
    expect(replaceRule(t, 0, parseControls(t).rules[0].text)).toBe(t)
    const added = replaceRule(t, -1, 'RULE C\nIF NODE N DEPTH > 2\nTHEN PUMP P STATUS = ON')
    expect(added).toBe(t + '\n\nRULE C\nIF NODE N DEPTH > 2\nTHEN PUMP P STATUS = ON')
    expect(replaceRule(added, 2, null)).toBe(t)
  })

  it('finds what each rule controls', () => {
    expect(rulesByTarget(parseControls(BELLINGE).rules).get('P1')).toEqual(['VACIADO_ON', 'GATE'])
    expect(hoursLabel('00:02')).toBe('2 min')
    expect(hoursLabel('1.5')).toBe('1 h 30 min')
  })
})
