import { readdirSync, lstatSync, unlinkSync, rmdirSync, existsSync } from 'node:fs'
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

// 只清理這個專案的生成目錄，避免 Windows 上 fs.rmSync 的遞迴刪除崩潰。
const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
const outputDir = resolve(projectRoot, 'dist')
if (dirname(outputDir) !== projectRoot || basename(outputDir) !== 'dist') {
  throw new Error('拒絕清理：輸出路徑不是本專案的 dist。')
}

function clearContents(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name)
    const targetRelative = relative(outputDir, target)
    if (targetRelative.startsWith('..') || isAbsolute(targetRelative)) {
      throw new Error('拒絕清理：路徑超出 dist。')
    }
    // 不跟隨目錄連結，避免清到輸出目錄以外的資料。
    if (entry.isSymbolicLink()) {
      unlinkSync(target)
    } else if (entry.isDirectory()) {
      clearContents(target)
      rmdirSync(target)
    } else {
      unlinkSync(target)
    }
  }
}

if (existsSync(outputDir)) {
  if (lstatSync(outputDir).isSymbolicLink() || !lstatSync(outputDir).isDirectory()) {
    throw new Error('拒絕清理：dist 必須是一般目錄。')
  }
  clearContents(outputDir)
}
