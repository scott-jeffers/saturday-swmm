/**
 * The map's GIS panel: background layers (files, web services, DEMs) and,
 * in the desktop app, US site data (elevation, impervious cover, soils).
 */
import { X } from 'lucide-react'
import type { ComponentProps } from 'react'
import { IS_VIEWER } from '../../lib/mode'
import { setPref, usePref } from '../../lib/prefs'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui'
import { BackgroundLayersPanel } from './BackgroundLayersPanel'
import { SiteDataSections } from './SiteDataSections'

export function GisPanel({
  onClose,
  onSelectSubcatchment,
  layers,
}: {
  onClose: () => void
  onSelectSubcatchment: (id: string) => void
  layers: ComponentProps<typeof BackgroundLayersPanel>
}) {
  const tab = usePref('gis-panel-tab', 'layers')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 pb-2">
        <h2 className="m-0 flex-1 text-[13px] font-semibold text-fg">GIS</h2>
        <button type="button" aria-label="Close the GIS panel" title="Close" className="rounded p-1 text-muted hover:bg-fg/5 hover:text-fg" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {IS_VIEWER ? (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
          <BackgroundLayersPanel {...layers} bare />
          <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
            Elevation, impervious cover and soils downloads (USGS, NLCD, SSURGO) are in the desktop app.
          </p>
        </div>
      ) : (
        <Tabs value={tab === 'site' ? 'site' : 'layers'} onValueChange={(v) => setPref('gis-panel-tab', v)} className="gap-2">
          <TabsList>
            <TabsTrigger value="layers">Layers</TabsTrigger>
            <TabsTrigger value="site">Site data (US)</TabsTrigger>
          </TabsList>
          <TabsContent value="layers" className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
            <BackgroundLayersPanel {...layers} bare />
          </TabsContent>
          <TabsContent value="site" className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
            <SiteDataSections onSelectSubcatchment={onSelectSubcatchment} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
