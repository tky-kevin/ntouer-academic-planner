import type { CreditRuleSet } from '../domain/types'

/** AP-I1-01：人工測試資料，不能視為正式畢業要求。 */
export const testRules = {
  version: 'test-v0.1',
  source: '人工建立的開發測試規則',
  scope: 'partial',
  scopeLabel: '部分條件檢核',
  conditions: [
    { id: 'total-credits', label: '總學分', category: 'all', minimumCredits: 12 },
    { id: 'required-credits', label: '必修類學分', category: 'required', minimumCredits: 6 },
    { id: 'elective-credits', label: '選修類學分', category: 'elective', minimumCredits: 6 },
  ],
} as const satisfies CreditRuleSet
