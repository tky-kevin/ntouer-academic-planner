import { mkdir, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { resolve } from 'node:path'
import { PlannerAisClient, auditGradeSnapshot, PlannerAisError } from '../server/ais/index.js'
import { testRules } from '../src/data/testRules.js'

async function main() {
  const account = process.env.AIS_ACCOUNT
  const password = process.env.AIS_PASSWORD
  if (!account || !password) {
    throw new PlannerAisError('invalidRequest', 'AIS_CREDENTIALS_NOT_CONFIGURED')
  }
  const passingScore = process.env.AIS_PASSING_SCORE?.trim()
  const numericPassingScore = passingScore ? Number(passingScore) : undefined
  if (numericPassingScore !== undefined && (!Number.isFinite(numericPassingScore) || numericPassingScore < 0 || numericPassingScore > 100)) throw new PlannerAisError('invalidRequest', 'INVALID_GRADE_POLICY')
  const directory = resolve('tmp/ais-live')
  await mkdir(directory, { recursive: true })
  const client = new PlannerAisClient({
    gradePolicy: { version: 'local-live-validation', source: numericPassingScore === undefined ? '尚未提供數字成績及格規則' : '操作者明確設定的及格分數；尚待正式規則核對', ...(numericPassingScore === undefined ? {} : { numericPassingScore }) },
    captchaSolver: {
      solve: async image => {
        const path = resolve(directory, 'captcha.png')
        await writeFile(path, image)
        console.log(`驗證碼圖片：${path}`)
        if (!process.stdin.isTTY) throw new PlannerAisError('invalidRequest', 'INTERACTIVE_CAPTCHA_REQUIRED')
        const input = createInterface({ input: process.stdin, output: process.stdout })
        try { return await input.question('請查看圖片並輸入四碼驗證碼：') } finally { input.close() }
      },
    },
  })
  try {
    await client.login({ account, password })
    const grades = await client.readGrades()
    const report = auditGradeSnapshot(grades, testRules)
    const year = process.env.AIS_TIMETABLE_YEAR
    const term = process.env.AIS_TIMETABLE_TERM
    const timetable = year && term ? await client.readTimetable(Number(year), Number(term)) : null
    const catalog = process.env.AIS_CATALOG_YEAR ? await client.readCatalogPage(process.env.AIS_CATALOG_YEAR) : null
    const detail = catalog?.offerings[0] ? await client.readCourseDetail(catalog.offerings[0].offeringId) : null
    const path = resolve(directory, 'normalized-snapshot.json')
    await writeFile(path, JSON.stringify({ grades, report, timetable, catalog, detail }, null, 2))
    console.log(JSON.stringify({ result: '完成讀取；開發測試規則，僅檢核部分條件', recordCount: grades.records.length, credits: report.audit.summary, unresolvedCount: grades.issues.length, savedTo: path }, null, 2))
  } finally {
    await client.logout().catch(() => console.error('教務登出未確認；本機 session 已清除。'))
  }
}

main().catch(error => {
  console.error(error instanceof PlannerAisError ? JSON.stringify({ kind: error.kind, code: error.code, retryable: error.retryable }) : 'AIS_LIVE_VALIDATION_FAILED')
  process.exitCode = 1
})
