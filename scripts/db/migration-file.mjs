// 遷移檔的解析規則：一個檔案包含 Up 與 Down 兩段，runner 只能套用 Up。
// 這支抽出來是為了能單獨測試——0018 就是因為「整檔送進 PostgreSQL」，
// 讓 Down 段把 constraint 改回去，只有在全新資料庫 seed 時才炸出來。

/** 只取 Up 段：去掉 BOM，並切掉 `-- Down Migration` 之後的內容。 */
export function upSection(raw) {
  const text = raw.replace(/^\uFEFF/, "");
  const marker = text.search(/^--\s*Down Migration\s*$/im);
  return marker === -1 ? text : text.slice(0, marker);
}
