// `GET /api/me/progress`：docs/design/api-spec.md §7.3。
// 形狀沿用 src/data/mockProgress.ts 的 ProgressData，ProgressPage 的預設 loader 就是這支。
import { apiFetch } from './client'
import type { ProgressData, Scenario } from '../data/mockProgress'

export function loadProgress(scenario: Scenario): Promise<ProgressData> {
  const query = new URLSearchParams({ scenario, includeTrace: 'true' })
  return apiFetch<ProgressData>(`/api/me/progress?${query.toString()}`)
}
