// 重新分類既有的 AIS 紀錄（不需要重跑同步、不需要驗證碼）。
// 用途：分類表（data/rules/113-cse-classification.json）修正後，把已同步的紀錄套上新分類。
// 跑法：npx tsx scripts/reclassify-ais-records.ts [--dry-run]
import { Pool } from 'pg'
import { loadClassificationTable, classifyCourse } from '../server/ais/classify.js'
import { loadDotEnv, readConfig } from '../server/env.js'

const dryRun = process.argv.includes('--dry-run')

async function main(): Promise<void> {
  loadDotEnv()
  const table = loadClassificationTable()
  const pool = new Pool({ connectionString: readConfig().databaseUrl, connectionTimeoutMillis: 2_000 })
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `select record_key, user_id, course_code, course_name, category, tags,
              coalesce(raw->>'courseCode', course_code) as original_code
         from student_records
        where record_key like 'ais:%'`,
    )
    let changed = 0
    for (const row of rows as Array<{
      record_key: string
      user_id: string
      course_code: string
      course_name: string
      category: string
      tags: string[]
      original_code: string
    }>) {
      const classified = classifyCourse(table, {
        courseName: row.course_name,
        courseCode: row.original_code,
      })
      const nextCode = classified.courseCode
      const nextTags = classified.tags
      const sameTags =
        Array.isArray(row.tags) &&
        row.tags.length === nextTags.length &&
        row.tags.every((tag, index) => tag === nextTags[index])
      if (row.category === classified.category && row.course_code === nextCode && sameTags) continue
      changed += 1
      console.log(
        JSON.stringify({
          recordKey: row.record_key,
          course: row.course_name,
          from: { category: row.category, code: row.course_code, tags: row.tags },
          to: { category: classified.category, code: nextCode, tags: nextTags },
          rule: classified.ruleId,
        }),
      )
      if (dryRun) continue
      await client.query(
        `update student_records set category = $3, course_code = $4, tags = $5
          where user_id = $1 and record_key = $2`,
        [row.user_id, row.record_key, classified.category, nextCode, nextTags],
      )
    }
    console.log(JSON.stringify({ scanned: rows.length, changed, dryRun }))
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
