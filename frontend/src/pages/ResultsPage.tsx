import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalibrationPanel } from '../components/results/CalibrationPanel'
import { SensitivityRuns } from '../components/results/SensitivityRuns'
import { useQuery } from '@tanstack/react-query'
import { ChartColumnIncreasing, Download, FileCode2, FileText, GitCompareArrows, ListChecks, Printer, Target } from 'lucide-react'
import { ReportDocument } from './ReportPage'
import { CompareRuns } from '../components/results/CompareRuns'
import { exportNetworkGeoJson } from '../lib/exportFiles'

import { ReportTables } from '../components/ReportTables'
import { RunSummaryBody, useRunSummary } from '../components/RunSummaryCard'
import { ProblemsList } from '../components/results/ProblemsList'
import { api } from '../api/client'
import { TimeSeriesChart } from '../components/TimeSeriesChart'
import { useRunStatus } from '../hooks/useRunStatus'
import { useObjectSeries, type SeriesKind } from '../hooks/useObjectSeries'
import { Button, PageHeader, Panel, Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui'

type ResultsTab = 'summary' | 'report' | 'charts' | 'compare' | 'calibration' | 'rpt'
const TABS: ResultsTab[] = ['summary', 'report', 'charts', 'compare', 'calibration', 'rpt']

export function ResultsPage() {
  // The tab is in the address (results?tab=report), so other pages can link to one.
  const [params, setParams] = useSearchParams()
  const tab = (TABS.includes(params.get('tab') as ResultsTab) ? params.get('tab') : 'summary') as ResultsTab
  const setTab = (t: ResultsTab) => setParams((p) => (p.set('tab', t), p), { replace: true })
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
    <div className="h-full overflow-auto px-6 py-5 print:p-0">
      <PageHeader
        className="print-hidden"
        title="Results"
        description={
          <>
            {project.data?.inp_name}
            {project.data?.scenario_name && project.data.scenario_name !== 'Base' ? ` · ${project.data.scenario_name}` : ''}
            {project.data?.storm_name ? ` · ${project.data.storm_name}` : ''}
          </>
        }
        actions={
          <>
            {project.data && (
              <Button size="sm" variant="outline" title="Network as GeoJSON (WGS84) with peak depth, flow and runoff" onClick={() => void exportNetworkGeoJson(project.data!)}>
                <Download className="h-3.5 w-3.5" /> Export GeoJSON
              </Button>
            )}
            {tab === 'report' && summary.data?.available && (
              <Button size="sm" variant="primary" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" /> Print or save as PDF
              </Button>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as ResultsTab)}>
        <TabsList className="print-hidden overflow-x-auto scrollbar-none">
          <TabsTrigger value="summary">
            <ListChecks className="h-3.5 w-3.5" />
            Summary
          </TabsTrigger>
          <TabsTrigger value="report">
            <FileText className="h-3.5 w-3.5" />
            Report
          </TabsTrigger>
          <TabsTrigger value="charts">
            <ChartColumnIncreasing className="h-3.5 w-3.5" />
            Graphs
          </TabsTrigger>
          <TabsTrigger value="compare">
            <GitCompareArrows className="h-3.5 w-3.5" />
            Compare runs
          </TabsTrigger>
          <TabsTrigger value="calibration">
            <Target className="h-3.5 w-3.5" />
            Calibration and sensitivity
          </TabsTrigger>
          <TabsTrigger value="rpt">
            <FileCode2 className="h-3.5 w-3.5" />
            Report file
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <div className="space-y-4 pb-6">
            {summary.data?.available ? (
              <>
                <Panel title="Run summary">
                  <RunSummaryBody s={summary.data} />
                </Panel>
                <Panel title="Problems, worst first">
                  <p className="mb-3 mt-0 text-xs text-muted">Flooded nodes, then pipes that ran full. Click one to see it on the map.</p>
                  <ProblemsList summary={summary.data} />
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

        <TabsContent value="compare" className="mt-4">
          <CompareRuns />
        </TabsContent>

        <TabsContent value="calibration" className="mt-4 pb-6">
          <div className="space-y-4">
            <CalibrationPanel />
            <SensitivityRuns />
          </div>
        </TabsContent>

        <TabsContent value="report" className="mt-4 pb-6 print:mt-0">
          <ReportDocument embedded />
        </TabsContent>

        <TabsContent value="rpt" className="mt-4 pb-6">
          <Panel className="flex flex-col">
            <p className="m-0 mb-2 text-[12px] text-muted">The engine’s own report (.rpt), as written by the last run.</p>
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
              <pre className="m-0 max-h-[calc(100vh-17rem)] min-h-[320px] overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-fg-soft">
                {rpt.data.text}
              </pre>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="charts" className="mt-4 pb-6">
          <Panel className="min-h-[420px]">
            <p className="m-0 mb-3 text-[12px] text-muted">
              One element at a time. For several at once, comparisons, rainfall and the system totals, use{' '}
              <Link to="/map" className="text-accent-soft hover:underline">Graphs beside the map</Link>.
            </p>
            <div className="mb-4 flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Type</span>
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as SeriesKind)
                    setSelectedId('')
                  }}
                  className="field h-8 w-auto text-[13px]"
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
                  className="field h-8 w-auto max-w-xs text-[13px]"
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
                  className="field h-8 w-auto text-[13px]"
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
