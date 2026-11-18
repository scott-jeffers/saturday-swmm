import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChartColumnIncreasing, Download, FileText, GitCompareArrows, ListChecks } from 'lucide-react'
import { CompareRuns } from '../components/results/CompareRuns'
import { exportNetworkGeoJson } from '../lib/exportFiles'

import { ReportTables } from '../components/ReportTables'
import { RunSummaryBody, useRunSummary } from '../components/RunSummaryCard'
import { api } from '../api/client'
import { TimeSeriesChart } from '../components/TimeSeriesChart'
import { useRunStatus } from '../hooks/useRunStatus'
import { useObjectSeries, type SeriesKind } from '../hooks/useObjectSeries'
import { Button, Panel, Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui'

type ResultsTab = 'summary' | 'report' | 'charts' | 'compare'

export function ResultsPage() {
  const [tab, setTab] = useState<ResultsTab>('summary')
  const [kind, setKind] = useState<SeriesKind>('node')
  const [selectedId, setSelectedId] = useState('')
  const { data: runStatus } = useRunStatus()

  const project = useQuery({
    queryKey: ['project'],
    queryFn: api.currentProject,
    retry: false,
  })

  const rpt = useQuery({
    queryKey: ['rpt', project.data?.inp_path, project.data?.has_rpt, runStatus?.status],
    queryFn: api.getRpt,
    enabled: Boolean(project.data),
    retry: false,
  })

  const summary = useRunSummary([project.data?.inp_path, project.data?.has_rpt, runStatus?.status, runStatus?.engine])

  const hasOut = Boolean(project.data?.has_out || runStatus?.status === 'completed')

  const nodes = useQuery({
    queryKey: ['out-nodes', project.data?.inp_path, project.data?.has_out, runStatus?.status],
    queryFn: api.getNodes,
    enabled: hasOut,
    retry: false,
  })

  const links = useQuery({
    queryKey: ['out-links', project.data?.inp_path, project.data?.has_out, runStatus?.status],
    queryFn: api.getLinks,
    enabled: hasOut,
    retry: false,
  })

  const subs = useQuery({
    queryKey: [
      'out-subcatchments',
      project.data?.inp_path,
      project.data?.has_out,
      runStatus?.status,
    ],
    queryFn: api.getSubcatchments,
    enabled: hasOut,
    retry: false,
  })

  const ids =
    kind === 'node'
      ? (nodes.data?.ids ?? [])
      : kind === 'link'
        ? (links.data?.ids ?? [])
        : (subs.data?.ids ?? [])

  useEffect(() => {
    if (!selectedId && ids.length > 0) {
      setSelectedId(ids[0])
    }
  }, [ids, selectedId])

  const objectSeries = useObjectSeries(kind, selectedId || null)

  if (project.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Panel className="max-w-md">
          <h1 className="m-0 text-xl font-semibold">Results</h1>
          <p className="mt-2 text-sm text-danger">Open a project first.</p>
          <Link className="mt-3 inline-block text-sm text-accent-soft" to="/">
            Back to open
          </Link>
        </Panel>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="m-0 text-xl font-semibold">Results</h1>
          <p className="m-0 text-sm text-muted">
            {project.data?.inp_name}
            {project.data?.scenario_name && project.data.scenario_name !== 'Base' ? ` · ${project.data.scenario_name}` : ''}
          </p>
        </div>
        {project.data && (
          <Button
            size="sm"
            variant="outline"
            title="Network as GeoJSON (WGS84) with peak depth, flow and runoff"
            onClick={() => void exportNetworkGeoJson(project.data!)}
          >
            <Download className="h-3.5 w-3.5" /> Export GeoJSON
          </Button>
        )}
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ResultsTab)}>
        <TabsList>
          <TabsTrigger value="summary">
            <ListChecks className="h-3.5 w-3.5" />
            Summary
          </TabsTrigger>
          <TabsTrigger value="report">
            <FileText className="h-3.5 w-3.5" />
            Full report
          </TabsTrigger>
          <TabsTrigger value="charts">
            <ChartColumnIncreasing className="h-3.5 w-3.5" />
            Charts
          </TabsTrigger>
          <TabsTrigger value="compare">
            <GitCompareArrows className="h-3.5 w-3.5" />
            Compare runs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <div className="min-h-0 space-y-4 overflow-auto pb-6">
            {summary.data?.available ? (
              <>
                <Panel title="Run summary">
                  <RunSummaryBody s={summary.data} />
                  {summary.data.engine && <p className="mt-3 text-[11px] text-muted">{summary.data.engine}</p>}
                </Panel>
                <ReportTables tables={summary.data.tables ?? []} />
              </>
            ) : (
              <Panel>
                <p className="m-0 text-sm text-muted">
                  {summary.isLoading ? 'Reading the report…' : 'No results yet. Press Run in the header to simulate the model.'}
                </p>
              </Panel>
            )}
          </div>
        </TabsContent>

        <TabsContent value="compare">
          <CompareRuns />
        </TabsContent>

        <TabsContent value="report">
          <Panel className="flex h-full min-h-[420px] flex-col overflow-hidden">
            {rpt.isError && (
              <p className="text-sm text-danger">{(rpt.error as Error).message}</p>
            )}
            {rpt.isLoading && <p className="text-sm text-muted">Loading report…</p>}
            {!rpt.isLoading && !rpt.data && !rpt.isError && (
              <p className="text-sm text-muted">
                {project.data?.has_rpt
                  ? 'Report file is present but could not be read.'
                  : 'No report yet. Run a simulation first.'}
              </p>
            )}
            {rpt.data && (
              <pre className="m-0 min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-fg-soft">
                {rpt.data.text}
              </pre>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="charts">
          <Panel className="min-h-[420px]">
            <div className="mb-4 flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Type</span>
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as SeriesKind)
                    setSelectedId('')
                  }}
                  className="rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-sm"
                >
                  <option value="node">Node</option>
                  <option value="link">Link</option>
                  <option value="subcatchment">Subcatchment</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Object</span>
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="max-w-xs rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-sm"
                >
                  {ids.length === 0 && <option value="">No objects</option>}
                  {ids.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Variable</span>
                <select
                  id="variable-select"
                  value={objectSeries.variable}
                  onChange={(e) => objectSeries.setVariable(e.target.value)}
                  className="rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-sm"
                  disabled={objectSeries.variables.length === 0}
                >
                  {objectSeries.variables.length === 0 && (
                    <option value={objectSeries.variable}>Loading…</option>
                  )}
                  {objectSeries.variables.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                      {v.unit ? ` (${v.unit})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {objectSeries.series.isError && (
              <p className="text-sm text-danger">
                {(objectSeries.series.error as Error).message}
              </p>
            )}
            {!selectedId && (
              <p className="text-sm text-muted">
                {project.data?.has_out
                  ? 'Loading objects from existing results…'
                  : 'Run a simulation to populate chart objects.'}
              </p>
            )}
            <TimeSeriesChart
              series={objectSeries.series.data}
              yLabel={objectSeries.yLabel}
              variables={objectSeries.variables}
              variable={objectSeries.variable}
              onVariableChange={objectSeries.setVariable}
            />
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  )
}
