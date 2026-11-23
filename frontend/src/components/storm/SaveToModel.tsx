/** Put rainfall into the model itself: a rain file plus the gage that reads it. */

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button, Switch } from '../ui'

const NEW = '\u0000new'

export function nextGageName(existing: string[], base = 'RG') {
  for (let i = existing.length + 1; ; i++) if (!existing.includes(`${base}${i}`)) return `${base}${i}`
}

export function SaveToModel({
  gages,
  gage,
  onGageChange,
  filename,
  onFilenameChange,
  applyAll,
  onApplyAllChange,
  syncTimes,
  onSyncTimesChange,
  extra,
  note,
  onSave,
  saving,
  disabled,
  disabledReason,
}: {
  /** Gages already in the model. */
  gages: string[]
  gage: string
  onGageChange: (v: string) => void
  filename: string
  onFilenameChange: (v: string) => void
  applyAll: boolean
  onApplyAllChange: (v: boolean) => void
  /** Leave out to always match the dates (no switch shown). */
  syncTimes?: boolean
  onSyncTimesChange?: (v: boolean) => void
  extra?: ReactNode
  note?: ReactNode
  onSave: () => void
  saving?: boolean
  disabled?: boolean
  disabledReason?: string
}) {
  const id = useId()
  const isNew = !gages.includes(gage)
  // Once the model's gages load, start on the first one rather than a new gage.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !gages.length) return
    seeded.current = true
    if (isNew) onGageChange(gages[0])
  }, [gages, isNew, onGageChange])
  const stem = filename.replace(/\.dat$/i, '')
  const replacing = !isNew

  return (
    <div className="flex flex-col gap-3.5 text-[12.5px]">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-g`} className="block font-medium text-fg-soft">
            Rain gage
          </label>
          <select
            id={`${id}-g`}
            className="field mt-1 w-full"
            value={isNew ? NEW : gage}
            onChange={(e) => onGageChange(e.target.value === NEW ? nextGageName(gages) : e.target.value)}
          >
            {gages.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
            <option value={NEW}>New rain gage…</option>
          </select>
          {isNew && (
            <input
              aria-label="New rain gage name"
              className="field mt-1.5 w-full"
              value={gage}
              placeholder="Gage name"
              onChange={(e) => onGageChange(e.target.value.replace(/\s+/g, '_'))}
            />
          )}
        </div>
        <div>
          <label htmlFor={`${id}-f`} className="block font-medium text-fg-soft">
            Rain file
          </label>
          <div className="field mt-1 flex w-full items-center gap-0 p-0 focus-within:ring-2 focus-within:ring-accent/40">
            <input
              id={`${id}-f`}
              className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 outline-none"
              value={stem}
              onChange={(e) => onFilenameChange(`${e.target.value.replace(/\.dat$/i, '')}.dat`)}
            />
            <span className="pr-2.5 text-muted">.dat</span>
          </div>
        </div>
      </div>
      <p className="m-0 text-[12px] text-muted">
        {replacing ? (
          <>
            <span className="font-medium text-fg-soft">{gage}</span> will read this file instead of what it reads now.
          </>
        ) : (
          <>
            Adds a gage <span className="font-medium text-fg-soft">{gage || '…'}</span> that reads this file.
          </>
        )}{' '}
        {note}
      </p>
      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2.5 text-fg-soft">
          <Switch checked={applyAll} onCheckedChange={onApplyAllChange} />
          Use this gage for every subcatchment
        </label>
        {onSyncTimesChange && (
          <label className="flex cursor-pointer items-center gap-2.5 text-fg-soft">
            <Switch checked={!!syncTimes} onCheckedChange={onSyncTimesChange} />
            Set the simulation dates to match the rain
          </label>
        )}
        {extra}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={onSave} disabled={disabled || saving || !gage.trim() || !stem.trim()} title={disabled ? disabledReason : undefined}>
          {saving ? 'Saving…' : 'Save to model'}
        </Button>
        {disabled && disabledReason && <span className="text-[12px] text-muted">{disabledReason}</span>}
      </div>
    </div>
  )
}
