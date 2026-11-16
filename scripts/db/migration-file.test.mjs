import { describe, expect, it } from 'vitest'
import { upSection } from './migration-file.mjs'

describe('migration upSection', () => {
  it('沒有 Down 段時原樣回傳', () => {
    const sql = 'create table t (id int);\n'
    expect(upSection(sql)).toBe(sql)
  })

  it('切掉 Down 段的 SQL（0018 的坑）', () => {
    const sql = [
      '-- 0018-fix',
      'alter table rule_clauses drop constraint if exists c;',
      "alter table rule_clauses add constraint c check (status in ('verified'));",
      '',
      '-- Down Migration',
      'alter table rule_clauses drop constraint if exists c;',
      "alter table rule_clauses add constraint c check (status in ('active'));",
      '',
    ].join('\n')

    const up = upSection(sql)
    expect(up).toContain("check (status in ('verified'))")
    expect(up).not.toContain("check (status in ('active'))")
    expect(up).not.toContain('-- Down Migration')
  })

  it('去掉開頭的 BOM', () => {
    expect(upSection('\uFEFFselect 1;')).toBe('select 1;')
  })
})
