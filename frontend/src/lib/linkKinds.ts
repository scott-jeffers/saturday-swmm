export type LinkKind = 'conduit' | 'pump' | 'orifice' | 'weir' | 'outlet'

export const LINK_KIND_OPTIONS: {
  kind: LinkKind
  label: string
  color: string
}[] = [
  { kind: 'conduit', label: 'Conduit', color: '#1d4ed8' },
  { kind: 'pump', label: 'Pump', color: '#db2777' },
  { kind: 'orifice', label: 'Orifice', color: '#7c3aed' },
  { kind: 'weir', label: 'Weir', color: '#ca8a04' },
  { kind: 'outlet', label: 'Outlet', color: '#ea580c' },
]

export const ALL_LINK_KINDS = LINK_KIND_OPTIONS.map((o) => o.kind)

export function defaultVisibleLinkKinds(): Record<LinkKind, boolean> {
  return {
    conduit: true,
    pump: true,
    orifice: true,
    weir: true,
    outlet: true,
  }
}

export function enabledLinkKinds(
  visible: Record<LinkKind, boolean>,
): LinkKind[] {
  return ALL_LINK_KINDS.filter((k) => visible[k])
}
