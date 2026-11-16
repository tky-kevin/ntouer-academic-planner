import { describe, expect, it } from 'vitest'
import { classifyCourse, loadClassificationTable, normalizeCourseName, parseClassificationTable } from './classify.js'
import type { ClassificationTable } from './classify.js'

const table: ClassificationTable = loadClassificationTable(process.cwd())

describe('課名正規化', () => {
  it('全形括號與空白視為同一個課名', () => {
    expect(normalizeCourseName('微積分（上）')).toBe('微積分(上)')
    expect(normalizeCourseName(' 微積分 (上) ')).toBe('微積分(上)')
    expect(normalizeCourseName('體育（一）')).toBe('體育(一)')
  })
})

describe('分類：系訂必修（REQ）', () => {
  it('課名對到 18 門必修，courseCode 換成規則包用的 canonical 名稱', () => {
    const result = classifyCourse(table, { courseName: '微積分（上）', courseCode: 'B1234' })
    expect(result.decision).toBe('classified')
    expect(result.category).toBe('REQ')
    expect(result.courseCode).toBe('微積分(上)')
    expect(result.ruleId).toBe('REQ-04')
    expect(result.sourceId).toBe('S113-03')
  })

  it('18 門必修全部對得到（不能被動到）', () => {
    const names = [
      '計算機概論', '程式設計', '微積分（上）', '微積分（下）', '離散數學', '程式設計(二)',
      '資料結構', '演算法', '數位邏輯', '數位邏輯實驗', '電腦網路', '計算機組織學',
      '線性代數', '機率論', '作業系統', '資工系專題(一)', '資工系專題(二)', '資訊專題討論',
    ]
    for (const name of names) {
      expect(classifyCourse(table, { courseName: name, courseCode: 'X' }).category).toBe('REQ')
    }
  })
})

describe('分類：共同教育（CE）與標籤', () => {
  it('國文領域 → CE + chinese', () => {
    const result = classifyCourse(table, { courseName: '國文領域（一）', courseCode: 'G001' })
    expect(result.category).toBe('CE')
    expect(result.tags).toContain('chinese')
  })

  it('大一英文 → english；進階英文另有 advancedEnglish', () => {
    expect(classifyCourse(table, { courseName: '大一英文（必.上）', courseCode: 'G002' }).tags).toEqual(['english'])
    expect(classifyCourse(table, { courseName: '進階英文', courseCode: 'G003' }).tags).toEqual(['english', 'advancedEnglish'])
  })

  it('博雅課名含子領域時標對應 domain tag', () => {
    expect(classifyCourse(table, { courseName: '博雅領域（跨域永續）', courseCode: 'G010' }).tags).toContain('domainSustain')
    expect(classifyCourse(table, { courseName: '博雅：人文探索－藝術', courseCode: 'G011' }).tags).toContain('domainHuman')
  })

  it('只有「博雅」而沒有子領域時只標 general（不猜子領域）', () => {
    const result = classifyCourse(table, { courseName: '博雅領域（領域名稱）', courseCode: 'G012' })
    expect(result.category).toBe('CE')
    expect(result.tags).toEqual(['general'])
  })

  it('海洋科學概論與人工智慧概論是必修的共同教育課', () => {
    expect(classifyCourse(table, { courseName: '海洋科學概論', courseCode: 'G020' }).tags).toEqual(['ocean', 'general'])
    expect(classifyCourse(table, { courseName: '人工智慧概論', courseCode: 'G021' }).tags).toEqual(['ai', 'general'])
  })

  it('體育四門與游泳', () => {
    expect(classifyCourse(table, { courseName: '體育（一）', courseCode: 'P001' }).tags).toEqual(['pe'])
    expect(classifyCourse(table, { courseName: '游泳', courseCode: 'P010' }).tags).toEqual(['pe', 'swimming'])
  })
})

describe('分類：排除與未知', () => {
  it('軍訓明確排除（不列入畢業學分）', () => {
    const result = classifyCourse(table, { courseName: '軍訓（一）', courseCode: 'M001' })
    expect(result.decision).toBe('excluded')
    expect(result.reason).toContain('軍訓')
  })

  it('AIS 只說「選修」時不猜系內或外系，回 unknown 並給理由', () => {
    const result = classifyCourse(table, {
      courseName: '機器學習',
      courseCode: 'B9999',
      aisRequirementKind: 'elective',
    })
    expect(result.decision).toBe('unknown')
    expect(result.category).toBe('unknown')
    expect(result.courseCode).toBe('B9999')
    expect(result.reason).toContain('選修')
  })

  it('未知課名也回 unknown，並保留 AIS 課號當鍵', () => {
    const result = classifyCourse(table, { courseName: '神祕課程', courseCode: 'Z0001' })
    expect(result.decision).toBe('unknown')
    expect(result.reason).not.toBeNull()
  })

  it('AIS 選別是通識、課名對不上時，仍歸共同教育（來源是 AIS 欄位，不是猜測）', () => {
    const result = classifyCourse(table, {
      courseName: '某某專題',
      courseCode: 'C001',
      aisRequirementKind: 'generalEducation',
    })
    expect(result.category).toBe('CE')
    expect(result.tags).toContain('general')
  })
})

describe('分類：真實 AIS 課名與課號', () => {
  it('AIS 課名「英文(大一英文)」也算大一英文', () => {
    const result = classifyCourse(table, { courseName: '英文(大一英文)', courseCode: 'B9D01968' })
    expect(result.category).toBe('CE')
    expect(result.tags).toContain('english')
  })

  it('AIS 課名只寫「微積分」時仍算系訂必修（R04 的上下冊對應另計）', () => {
    const result = classifyCourse(table, { courseName: '微積分', courseCode: 'B5711M97' })
    expect(result.category).toBe('REQ')
    expect(result.courseCode).toBe('微積分')
  })

  it('B57 開頭的課視為資工系開課 → ELE＋inner／program', () => {
    const result = classifyCourse(table, { courseName: '資料庫系統', courseCode: 'B5703N54' })
    expect(result.category).toBe('ELE')
    expect(result.tags).toEqual(['inner', 'program'])
    expect(result.ruleId).toBe('CODE-01')
  })

  it('B92 開頭的 0 學分課視為體育 → CE＋pe', () => {
    const result = classifyCourse(table, { courseName: '羽球(初)', courseCode: 'B92J3G04' })
    expect(result.category).toBe('CE')
    expect(result.tags).toEqual(['pe'])
  })

  it('課名比對優先於課號前綴（B57 的計算機概論仍是 REQ）', () => {
    const result = classifyCourse(table, { courseName: '計算機概論', courseCode: 'B57011RQ' })
    expect(result.category).toBe('REQ')
  })

  it('外系課號（M57）不會被當成系內選修', () => {
    const result = classifyCourse(table, { courseName: '資料探勘', courseCode: 'M5701N5J' })
    expect(result.category).toBe('unknown')
  })
})

describe('分類資料本身的完整性', () => {
  it('每一條規則都有 sourceId 與 locator（可追溯）', () => {
    for (const rule of [...table.rules, ...table.excluded]) {
      expect(rule.sourceId, rule.id).toBeTruthy()
      expect(rule.locator, rule.id).toBeTruthy()
    }
  })

  it('sourceId 都存在於 sources[]', () => {
    const known = new Set(table.sources.map((source) => source.sourceId))
    for (const rule of [...table.rules, ...table.excluded]) {
      expect(known.has(rule.sourceId), `${rule.id} → ${rule.sourceId}`).toBe(true)
    }
  })

  it('規則 id 重複或欄位缺漏會被擋下', () => {
    expect(() => parseClassificationTable({ rules: [], excluded: [] })).toThrow(/rules/)
    expect(() =>
      parseClassificationTable({
        rules: [
          { id: 'A', match: { kind: 'exact', value: 'X' }, category: 'CE', tags: [], sourceId: 'S', locator: 'L' },
          { id: 'A', match: { kind: 'exact', value: 'Y' }, category: 'CE', tags: [], sourceId: 'S', locator: 'L' },
        ],
        excluded: [],
      }),
    ).toThrow(/重複/)
  })
})
