import type { QueryClient } from '@tanstack/react-query'

/** Everything that depends on which project / scenario .inp is active. */
export function invalidateProjectQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['project'] })
  void queryClient.invalidateQueries({ queryKey: ['inp'] })
  void queryClient.invalidateQueries({ queryKey: ['network'] })
  void queryClient.invalidateQueries({ queryKey: ['runStatus'] })
  void queryClient.invalidateQueries({ queryKey: ['out-periods'] })
  void queryClient.invalidateQueries({ queryKey: ['out-snapshot'] })
  void queryClient.invalidateQueries({ queryKey: ['out-nodes'] })
  void queryClient.invalidateQueries({ queryKey: ['out-links'] })
  void queryClient.invalidateQueries({ queryKey: ['rpt'] })
  void queryClient.invalidateQueries({ queryKey: ['series'] })
  void queryClient.invalidateQueries({ queryKey: ['map-series'] })
  void queryClient.invalidateQueries({ queryKey: ['profile'] })
  void queryClient.invalidateQueries({ queryKey: ['2d-mesh'] })
  void queryClient.invalidateQueries({ queryKey: ['2d-info'] })
  void queryClient.invalidateQueries({ queryKey: ['gis-layers'] })
  void queryClient.invalidateQueries({ queryKey: ['scenarios'] })
  void queryClient.invalidateQueries({ queryKey: ['rpt-summary'] })
  void queryClient.invalidateQueries({ queryKey: ['periods'] })
  void queryClient.invalidateQueries({ queryKey: ['object'] })
  // Results depend on the scenario and the storm: refresh everything else that's on screen too.
  void queryClient.invalidateQueries()
}
