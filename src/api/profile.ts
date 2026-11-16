// `PATCH /api/me/profile`：補齊系所／入學年度（規則包要用這兩個欄位才決定得出來）。
import { apiFetch } from './client'

export type Program = 'day' | 'night'

export interface ProfilePatch {
  deptId?: string
  entryYear?: number
  program?: Program
}

export interface ProfileData {
  deptId: string | null
  entryYear: number | null
  program: Program | null
}

export function updateProfile(patch: ProfilePatch): Promise<ProfileData> {
  return apiFetch<ProfileData>('/api/me/profile', { method: 'PATCH', body: JSON.stringify(patch) })
}
