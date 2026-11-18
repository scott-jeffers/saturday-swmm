/** The app's design system on one page: tokens and components, for keeping new screens consistent. */
import { useState } from 'react'
import { Play } from 'lucide-react'
import { Badge, Button, PageHeader, Panel, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui'

const TOKENS = ['surface', 'elevated', 'panel', 'border', 'border-strong', 'muted', 'fg-soft', 'fg', 'accent', 'accent-strong', 'accent-soft', 'success', 'warning', 'danger']

export function DesignPage() {
  const [tab, setTab] = useState('a')
  const [on, setOn] = useState(true)
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader title="Design system" description="Colours, type and components used across Saturday-SWMM. Use these rather than one-off styles; both themes come from the same tokens." />
        <Panel title="Colour tokens">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {TOKENS.map((t) => (
              <div key={t}>
                <div className="h-10 rounded-md border border-border" style={{ background: `var(--color-${t})` }} />
                <div className="mt-1 font-mono text-[11px] text-muted">{t}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Type">
          <div className="space-y-1">
            <div className="text-[19px] font-semibold tracking-[-0.01em]">Page title, 19 px semibold</div>
            <div className="text-[13px] font-semibold">Panel title, 13 px semibold</div>
            <div className="text-[14px]">Body, 14 px</div>
            <div className="text-[13px] text-fg-soft">Controls and table text, 13 px</div>
            <div className="text-[12px] text-muted">Labels and help, 12 px muted</div>
            <div className="text-[11px] text-muted">Small print, 11 px</div>
          </div>
        </Panel>
        <Panel title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">
              <Play className="h-3.5 w-3.5 fill-current" /> Primary
            </Button>
            <Button>Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="ghost" active>
              Active
            </Button>
            <Button size="sm" variant="outline">
              Small
            </Button>
            <Button disabled>Disabled</Button>
          </div>
        </Panel>
        <Panel title="Fields">
          <div className="grid max-w-xl grid-cols-2 gap-3">
            <label className="block text-[12px] font-medium text-fg-soft">
              Text field
              <input className="field mt-1.5" placeholder="Placeholder" />
            </label>
            <label className="block text-[12px] font-medium text-fg-soft">
              Select
              <select className="field mt-1.5">
                <option>Option</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 text-[13px] font-medium">
              Switch
              <Switch checked={on} onCheckedChange={setOn} />
            </label>
          </div>
        </Panel>
        <Panel title="Status and tabs">
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge tone="completed">completed</Badge>
            <Badge tone="running">running</Badge>
            <Badge tone="failed">failed</Badge>
            <Badge tone="idle">idle</Badge>
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="a">First tab</TabsTrigger>
              <TabsTrigger value="b">Second tab</TabsTrigger>
            </TabsList>
            <TabsContent value="a" className="pt-2 text-[13px] text-muted">
              Underlined tabs for switching views inside a page.
            </TabsContent>
            <TabsContent value="b" className="pt-2 text-[13px] text-muted">
              Second view.
            </TabsContent>
          </Tabs>
        </Panel>
        <Panel title="Map overlays">
          <div className="relative h-28 rounded-md bg-surface">
            <div className="map-overlay absolute left-3 top-3 px-3 py-2 text-[12px]">.map-overlay: every floating panel on the map</div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
