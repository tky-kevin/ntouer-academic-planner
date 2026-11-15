# 需求圖庫工作區

SRS 內嵌引用的 11 張介面線稿（學生端 7 張、管理端 4 張）與 2 張故事地圖，以及它們的產生器。

- `index.html`：圖庫首頁，可直接開啟瀏覽全部圖表。
- `assets/`：`*.svg`（可編輯原始檔）與 `*.png`（文件嵌入用）。**SRS 引用的是這一層的 PNG。**
- `desktop.png`、`mobile.png`：圖庫頁面的桌面／手機截圖。
- `build_assets.py`：重建 SVG、`index.html` 與 `assets-manifest.json`。
- `capture.js`：用 Playwright 把 SVG 擷取成 PNG 與頁面截圖。
- `assets-manifest.json`、`story-map-team-provenance.json`、`VALIDATION.json`、`REVIEW.md`、`DESIGN.md`：圖表來源、設計與驗證紀錄。

## 圖表維護

`build_assets.py` 以自身所在目錄為根（`ROOT = Path(__file__).resolve().parent`），輸出 `assets/`、`index.html` 與 `assets-manifest.json`，所以整個資料夾可以搬動，不需改路徑。

```powershell
cd docs/requirements/wireframes
python build_assets.py
```

`capture.js` 的路徑以**專案根目錄**為基準（`docs/requirements/wireframes/...`），執行時請在 repo 根目錄下啟動。它會先讀 `http://127.0.0.1:8769/index.html`，需先在該目錄起一個靜態伺服器。

若沒有 Playwright 環境，可改用 Chrome／Edge 的 headless 截圖：把 SVG 包進 1560×1101 的空白頁面再截圖，即可得到與 `capture.js` 相同的尺寸（見 `assets/*.png` 皆為 1560×1101）。管理端四張（UI-08～UI-11）即以此方式產生。

若直接編輯 SVG，須同步更新 `index.html` 內嵌內容與對應 PNG，否則重跑產生器會覆寫手改的內容。

## 介面清單

| 編號 | 名稱 | 讀者 |
| --- | --- | --- |
| AP-UI-01 | 登入與資料同步 | 學生 |
| AP-UI-02 | 畢業進度首頁 | 學生 |
| AP-UI-03 | 條件詳情與手動設定 | 學生 |
| AP-UI-04 | 修課紀錄 | 學生 |
| AP-UI-05 | 課程搜尋與學期規劃 | 學生 |
| AP-UI-06 | 規則管理（草稿、預覽、發布） | 系所管理員 |
| AP-UI-07 | Iteration 1 Demo | 展示 |
| AP-UI-08 | 規則驗證與測試 | 系所管理員 |
| AP-UI-09 | 審核與差異 | 系所管理員 |
| AP-UI-10 | 稽核紀錄與追溯 | 系所管理員／系統管理員 |
| AP-UI-11 | 系所管理員指派 | 系統管理員 |

## 相關文件

- [使用者需求文件 v1.3](../urd.md)
- [系統需求文件 v0.9](../srs.md)
- [系統設計文件](../../design/system-design.md)
- [專案入口](../../README.md)
