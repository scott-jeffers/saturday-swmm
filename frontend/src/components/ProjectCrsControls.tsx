import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Compass } from 'lucide-react'
import { api } from '../api/client'
import { CrsPicker } from './CrsPicker'
import { useToast } from './ui'
import { clearCamera } from '../lib/mapViewStore'
import { ensureCrs, DEFAULT_CRS } from '../lib/projection'
import { cn } from '../lib/cn'

type ProjectCrsControlsProps = {
  projectPath: string
  className?: string
}

/** Compact Project CRS editor for the app header (opened from the rail). */
export function ProjectCrsControls({ projectPath, className }: ProjectCrsControlsProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const project = useQuery({
    queryKey: ['project'],
    queryFn: api.currentProject,
  })
  const projectCrs = project.data?.crs ?? DEFAULT_CRS
  const [crsDraft, setCrsDraft] = useState(projectCrs)

  useEffect(() => {
    if (!project.data?.crs) return
    ensureCrs(project.data.crs, project.data.crs_proj4)
    setCrsDraft(project.data.crs)
  }, [project.data?.crs, project.data?.crs_proj4])

  const setProjectCrs = useMutation({
    mutationFn: (crs: string) => api.setProjectCrs(crs),
    onSuccess: (info) => {
      ensureCrs(info.crs ?? DEFAULT_CRS, info.crs_proj4)
      setCrsDraft(info.crs ?? DEFAULT_CRS)
      clearCamera(projectPath)
      void queryClient.invalidateQueries({ queryKey: ['project'] })
      void queryClient.invalidateQueries({ queryKey: ['network'] })
      void queryClient.invalidateQueries({ queryKey: ['2d-mesh'] })
      void queryClient.invalidateQueries({ queryKey: ['gis-layers'] })
      toast({
        title: 'Project CRS updated',
        description: info.crs,
        tone: 'success',
      })
    },
    onError: (err) =>
      toast({
        title: 'CRS update failed',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  return (
    <div
      className={cn(
        'flex max-w-md flex-col gap-1.5 rounded-lg border border-border bg-elevated/95 px-3 py-2 shadow-[var(--shadow-panel)]',
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-fg">
        <Compass className="h-3.5 w-3.5 text-muted" />
        Project CRS
      </div>
      <CrsPicker
        value={crsDraft}
        onChange={setCrsDraft}
        onApply={(crs) => setProjectCrs.mutate(crs)}
        applyPending={setProjectCrs.isPending}
        applyDisabled={!crsDraft.trim() || crsDraft.trim() === projectCrs}
        compact
      />
      <p className="text-[10px] text-muted">
        Engineering coordinates for this project. Stored in .saturday-swmm.json.
      </p>
    </div>
  )
}
