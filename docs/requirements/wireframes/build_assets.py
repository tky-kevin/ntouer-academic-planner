"""Build editable SRD diagrams. PNGs are captured from these SVG sources with Chromium."""
from pathlib import Path
from html import escape
import json
import unicodedata

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / 'assets'
ASSETS.mkdir(parents=True, exist_ok=True)
MANIFEST = []

def wrap(s, units):
    lines=[]; line=''; used=0
    for c in s:
        w=1 if unicodedata.east_asian_width(c) in ('W','F') else .56
        if c=='\n' or used+w>units:
            lines.append(line);line='';used=0
        if c!='\n':line+=c;used+=w
    if line:lines.append(line)
    return lines

class Drawing:
    def __init__(self,w,h,title,desc):
        self.w=w;self.h=h
        self.parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc>',
                    '<style>text{font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif;fill:#252525;font-variant-numeric:tabular-nums}</style>',
                    f'<rect width="{w}" height="{h}" fill="white"/>']
    def rect(self,x,y,w,h,fill='white',stroke='#777',radius=0):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    def line(self,x,y,x2,y2):self.parts.append(f'<path d="M{x} {y} L{x2} {y2}" stroke="#aaa" fill="none"/>')
    def text(self,x,y,s,size=23,bold=False,width=None,color='#252525'):
        lines=wrap(s,width/size) if width else s.split('\n')
        for i,t in enumerate(lines):
            self.parts.append(f'<text x="{x}" y="{y+i*size*1.55}" font-size="{size}" font-weight="{700 if bold else 400}" style="fill:{color}">{escape(t)}</text>')
        return y+len(lines)*size*1.55
    def button(self,x,y,w,label,primary=False):
        self.rect(x,y,w,46,'#333' if primary else '#f5f5f5','#333',3)
        self.text(x+14,y+31,label,21,False,color='white' if primary else '#252525')
    def note(self,x,y,w,lines):
        self.rect(x,y,w,24+len(lines)*34,'#f3f3f3','#aaa')
        for i,t in enumerate(lines):self.text(x+16,y+31+i*34,t,21)
    def save(self,name,title,desc):
        (ASSETS/f'{name}.svg').write_text(''.join(self.parts)+'</svg>',encoding='utf-8')
        MANIFEST.append({'id':name,'title':title,'description':desc,'width':self.w,'height':self.h})

def plate(name,title,desc,left,right,footer):
    d=Drawing(1560,1100,title,desc)
    d.text(40,58,title,36,True)
    d.text(40,104,desc,23)
    d.text(40,142,'介面規劃示意 · 匿名測試資料 · 不代表功能已交付或正式畢業要求',21,color='#555')
    for x,(heading,fn) in zip((40,800),(left,right)):
        d.text(x,191,heading,27,True)
        d.rect(x,212,720,750)
        d.rect(x,212,720,58,'#ececec')
        d.text(x+20,250,'NTOUER Academic Planner',23,True)
        fn(d,x+24,296)
    d.line(40,1000,1520,1000)
    d.text(40,1039,footer,23,width=1480)
    d.save(name,title,desc)

def demo_before(d,x,y):
    d.note(x,y,672,['開發測試規則，僅檢核部分條件','test-v0.1：總 12／必修類 6／選修類 6'])
    d.text(x,y+144,'選取紀錄樣本',25,True)
    d.button(x,y+164,176,'不足（已選取）',True);d.button(x+190,y+164,130,'達標');d.button(x+334,y+164,130,'空資料')
    d.text(x,y+258,'已載入修課紀錄',25,True)
    for i,t in enumerate(['A　必修　3 學分　及格','B　必修　3 學分　及格','C　選修　3 學分　及格']):
        d.text(x,y+300+i*42,t);d.line(x,y+314+i*42,x+672,y+314+i*42)
    d.button(x,y+438,210,'執行學分檢核',True)
    d.note(x,y+518,672,['尚未執行檢核','結果以「—」顯示；不預先填入答案'])

def demo_after(d,x,y):
    d.note(x,y,672,['開發測試規則，僅檢核部分條件','test-v0.1／樣本：不足／採計 3 筆'])
    d.text(x,y+146,'部分條件已檢核',28,True)
    for i,(a,b,c) in enumerate([('總學分','9 / 12','尚缺 3'),('必修類','6 / 6','已達標'),('選修類','3 / 6','尚缺 3')]):
        yy=y+178+i*78;d.rect(x,yy,672,66);d.text(x+18,yy+42,a,23,True);d.text(x+252,yy+42,b);d.text(x+490,yy+42,c)
    d.note(x,y+438,672,['總學分與選修類仍有缺額','本次結果不代表完整畢業條件已滿足'])
    d.text(x,y+560,'切換樣本後清除舊結果，提示重新檢核。',22)

plate('ui07-demo','AP-UI-07｜Iteration 1 檢核','AP-US-01、02、12 · AP-FR-02、03、04、11 · AP-TC-01、04、08',('操作前：載入 A、B、C，尚未檢核',demo_before),('操作後：按下「執行學分檢核」',demo_after),'流程：選樣本 → 執行檢核 → 查看缺額；換成 A、B、C、D 並重跑，各缺額應為 0。')

def sync_before(d,x,y):
    d.text(x,y+30,'Google 身分登入',28,True);d.button(x,y+61,230,'以 Google 登入',True)
    d.line(x,y+140,x+672,y+140);d.text(x,y+190,'登入後進行教務資料同步',26,True)
    d.text(x,y+245,'教務帳號');d.rect(x,y+262,672,48);d.text(x+14,y+294,'匿名學生帳號',21,color='#666')
    d.text(x,y+355,'教務密碼');d.rect(x,y+372,672,48);d.text(x+14,y+404,'●●●●●●●●',21)
    d.button(x,y+454,220,'授權本次同步',True)
    d.text(x,y+539,'帳密僅用於本次同步，不持久保存。',22)
    d.text(x,y+579,'尚無資料時仍可手動補充紀錄。',22)

def sync_after(d,x,y):
    d.text(x,y+30,'已登入：匿名學生',28,True)
    d.note(x,y+72,672,['此次同步失敗，資料尚未更新','前次成功：2026/10/14 09:30（示意）'])
    d.text(x,y+202,'保留前次成功資料與個人修正',26,True)
    d.text(x,y+255,'系所：資訊工程學系　入學年度：113',23)
    d.text(x,y+307,'原始修課快照：保留',23)
    d.text(x,y+359,'個人修正與計畫：保留',23)
    d.button(x,y+405,166,'重新同步',True);d.button(x+182,y+405,220,'手動補充紀錄')
    d.note(x,y+500,672,['同步成功才更新資料時間並重新檢核','缺適用規則時顯示缺少規則，不改套其他年度'])

plate('ui01-sync','AP-UI-01｜登入與資料同步','AP-US-03、04 · AP-FR-01、02 · AP-TC-12、13',('操作前：登入及授權同步',sync_before),('異常結果：同步失敗，保留舊資料',sync_after),'流程：Google 登入 → 教務授權 → 同步成功更新／失敗重試；Google 與 AIS 是不同身分用途。')

def home(d,x,y,values,tab):
    d.note(x,y,672,['113 資工／測試規則 v0.1／未經系所審核','資料：A、B 及格；C 修課中；D 在計畫'])
    d.text(x,y+140,'畢業進度',28,True)
    d.button(x,y+164,204,'目前已完成',tab==0);d.button(x+216,y+164,218,'本學期通過後',tab==1)
    d.button(x,y+220,300,'規劃課程全部通過後',tab==2)
    for i,(a,b,c) in enumerate(values):
        yy=y+300+i*70;d.line(x,yy+15,x+672,yy+15);d.text(x,yy,a,23,True);d.text(x+255,yy,b);d.text(x+475,yy,c)
    d.note(x,y+491,672,['部分條件已檢核','百分比僅代表總學分，不是整體畢業完成度'])
    d.button(x,y+586,150,'條件詳情');d.button(x+164,y+586,160,'修課紀錄');d.button(x+338,y+586,150,'編輯計畫')

plate('ui02-progress','AP-UI-02｜情境切換與畢業缺額','AP-US-02、05 · AP-FR-03、04 · AP-TC-09、14、26',('目前已完成：只採計 A、B',lambda d,x,y:home(d,x,y,[('總學分','6 / 12','尚缺 6'),('必修類','6 / 6','已達標'),('選修類','0 / 6','尚缺 6')],0)),('規劃全部通過後：納入 C、D 假設',lambda d,x,y:home(d,x,y,[('總學分','12 / 12','尚缺 0'),('必修類','6 / 6','已達標'),('選修類','6 / 6','已達標')],2)),'中間情境「本學期全部通過後」為總 9、必修 6、選修 3；情境切換不改寫真實紀錄。')

def override(d,x,y,done):
    d.note(x,y,672,['完整測試規則 v0.2／非正式規則','其餘必要條件均達標；只測英文狀態變化'])
    d.text(x,y+145,'英文畢業門檻｜0 學分',27,True)
    d.text(x,y+194,'來源：測試條件／對應官方來源見第 8.7 節',21)
    d.text(x,y+244,'系統原判斷：尚未確認',23)
    d.text(x,y+294,'有效結果：'+('已達標（學生手動設定）' if done else '尚未確認（系統判斷）'),23,True)
    d.button(x,y+325,136,'已達標',done);d.button(x+148,y+325,136,'未達標');d.button(x+296,y+325,164,'尚未確認')
    d.button(x,y+389,150,'儲存設定',True);d.button(x+164,y+389,210,'恢復系統判斷')
    d.note(x,y+472,672,['上層 AND：'+('已達標' if done else '尚未確認'),'整體：'+('依目前資料與規則，所有條件已滿足' if done else '尚有條件待確認'),'總學分：12（覆蓋前後不變）'])

plate('ui03-override','AP-UI-03｜條件覆蓋與上層重算','AP-US-07 · AP-FR-03、04、06 · AP-TC-10、24',('操作前：缺少英文資料，狀態未知',lambda d,x,y:override(d,x,y,False)),('操作後：設為已達標，按下儲存',lambda d,x,y:override(d,x,y,True)),'恢復系統判斷 → 英文、AND 與整體恢復未知；不增加學分、不要求上傳證明、不等於校方認證。')

def records(d,x,y,edited):
    d.note(x,y,672,['原始快照：A、B、C 各 3 學分及格','測試規則：總 12／必修類 6／選修類 6'])
    d.text(x,y+148,'課程 C｜個人紀錄修正',27,True)
    d.text(x,y+202,'課程代碼：C　分類：選修　狀態：及格',23)
    d.text(x,y+252,'原始值：3 學分（AIS 快照保留）',23)
    d.text(x,y+304,'有效值：'+('2 學分（個人修正）' if edited else '3 學分（尚未修正）'),23,True)
    d.rect(x,y+337,170,48);d.text(x+16,y+369,'學分：'+('2' if edited else '3'),23)
    d.button(x+190,y+337,150,'儲存修正',True);d.button(x+354,y+337,210,'恢復原始值')
    d.note(x,y+444,672,['總學分：'+('8 / 12，尚缺 4' if edited else '9 / 12，尚缺 3'),'選修類：'+('2 / 6，尚缺 4' if edited else '3 / 6，尚缺 3'),'修正保留於個人層；不覆寫原始快照'])
    d.text(x,y+596,'負學分拒絕儲存；排除只影響個人採計。',22)

plate('ui04-records','AP-UI-04｜個人修課紀錄修正','AP-US-06 · AP-FR-05 · AP-TC-11、12、15',('操作前：C 採計 3 學分',lambda d,x,y:records(d,x,y,False)),('操作後：C 改為 2 學分並儲存',lambda d,x,y:records(d,x,y,True)),'儲存後立即重算並持久保留；恢復原始值 → C 回到 3 學分、總 9、選修 3。')

def plan(d,x,y,added):
    d.note(x,y,672,['測試規則 v0.1／A、B 已及格；C 修課中','本學期假設通過：總 9／必修 6／選修 3'])
    d.text(x,y+141,'搜尋與候選課程',26,True)
    d.rect(x,y+164,410,48);d.text(x+12,y+196,'課名或代碼：D',22);d.button(x+426,y+164,100,'搜尋',True)
    d.text(x,y+261,'D　測試選修課程　3 學分',24,True)
    d.text(x,y+304,'對應：選修類缺額；歷年開課僅供參考',22)
    d.button(x,y+327,268,'加入所選學期',True)
    d.line(x,y+400,x+672,y+400);d.text(x,y+443,'未來學期計畫（示意）',26,True)
    d.text(x,y+493,'D　3 學分　移動／移除' if added else '尚無計畫課程',23)
    d.text(x,y+535,'規劃情境：'+('總 12／選修 6，各缺 0' if added else '總 9／選修 3，各缺 3'),23,True)
    d.text(x,y+575,'開課與時間尚未驗證'+('；尚未保存' if added else ''),22)
    d.button(x,y+603,160,'保存計畫',True);d.button(x+176,y+603,240,'模擬畢業進度')

plate('ui05-plan','AP-UI-05｜搜尋、加入計畫與模擬','AP-US-08、09、10、11 · AP-FR-07、08、09、10 · AP-TC-09、16、17、23',('操作前：搜尋 D，計畫尚無課程',lambda d,x,y:plan(d,x,y,False)),('操作後：將 D 加入未來學期',lambda d,x,y:plan(d,x,y,True)),'加入後重算規劃情境；保存成功才顯示已保存。移除 D 恢復原缺額；失敗保留內容供重試。')

def admin(d,x,y,published):
    d.note(x,y,672,['範圍：113 資工／系所目前無管理員','目前發布權：開發者'])
    d.text(x,y+141,'測試規則 v0.2（已發布）' if published else '測試規則草稿 v0.2',27,True)
    d.text(x,y+191,'來源：開發測試文件／示意條件',23)
    d.text(x,y+241,'門檻：總 12／必修類 6／選修類 6',23)
    d.text(x,y+291,'預覽：結構有效；部分條件檢核',23)
    d.button(x,y+321,150,'保存草稿');d.button(x+166,y+321,150,'測試預覽');d.button(x+332,y+321,166,'發布版本',True)
    d.line(x,y+398,x+672,y+398);d.text(x,y+440,'學生端採用版本',26,True)
    d.text(x,y+488,'v0.2（已發布）' if published else 'v0.1（已發布；v0.2 仍為草稿）',23)
    d.note(x,y+522,672,['未經系所管理者審核','新版發布後重新檢核；保留歷史版本'])
    d.text(x,y+648,'有管理員時：開發者發布請求由後端拒絕。',22)

plate('ui06-rules','AP-UI-06｜草稿、預覽與受控發布','AP-US-12、13 · AP-FR-11、12、13 · AP-TC-18、19、20、23',('操作前：編輯草稿，學生仍使用舊版',lambda d,x,y:admin(d,x,y,False)),('操作後：具發布權者發布新版',lambda d,x,y:admin(d,x,y,True)),'發布前確認影響範圍；草稿不替代已發布版。學生採用適用範圍最新已發布版，畫面隱藏不代替授權。')

def rows_block(d,x,y,items,rowh=58):
    """items: (label, value, state[, tag]) ；state: ok / bad / info / neutral"""
    for i,item in enumerate(items):
        a,b,state=item[0],item[1],item[2]
        yy=y+i*rowh
        d.rect(x,yy,672,rowh-6,'#fafafa' if state in ('info','neutral') else 'white')
        d.text(x+14,yy+37,a,21,True)
        d.text(x+274,yy+37,b,21,width=286)
        tag=item[3] if len(item)>3 else {'ok':'通過','bad':'錯誤','info':'待確認','neutral':'不變'}[state]
        col={'ok':'#1f6f43','bad':'#8a1f1f','info':'#6b5300','neutral':'#555555'}[state]
        d.text(x+576,yy+37,tag,21,True,color=col)

def ui08(d,x,y,ok):
    d.note(x,y,672,['範圍：113 資工／草稿 v0.3','關卡：結構驗證 → 測試案例 → 送審'])
    d.text(x,y+118,'① 結構驗證',25,True)
    checks=[('條文參照 46 / 46','R31 → 不存在的 C99','bad'),
            ('來源雜湊 10 / 10','S113-07 雜湊不符','bad'),
            ('selector 語法','全部合法','ok')] if not ok else \
           [('條文參照 47 / 47','全部可追溯','ok'),
            ('來源雜湊 10 / 10','全部符合','ok'),
            ('selector 語法','全部合法','ok')]
    rows_block(d,x,y+134,checks,58)
    d.text(x,y+318,'② 測試案例',25,True)
    cases=[('TC-29 採計上限','9 學分只認 6','ok' if ok else 'info'),
           ('TC-30 重複採計','同課只計一次','ok' if ok else 'info'),
           ('TC-31 抵免／免修','抵免給學分、免修不給','ok' if ok else 'info'),
           ('TC-32 例外衝突','未解衝突停在待確認','ok' if ok else 'info')]
    rows_block(d,x,y+334,cases,58)
    if ok:
        d.button(x,y+576,200,'送審（系所管理員）',True)
    else:
        d.note(x,y+574,672,['結構驗證未通過：不得送審，不得形成可發布版本'])

def ui09(d,x,y,published):
    d.note(x,y,672,['v0.3 相對 v0.2','審核者：系所管理員／可代理'])
    d.text(x,y+118,'差異摘要（結構比較，不靠 AI 判讀）',23,True)
    diff=[('新增 R45 體育選修上限','來源 S113-09','ok','新增'),
          ('R07 核心選修 12','未變更，不列差異','neutral','不變'),
          ('新增 R19 進階英文資格','來源 S113-09','ok','新增'),
          ('刪除 R31','改列範圍提示，保留歷史','bad','刪除')]
    rows_block(d,x,y+134,diff,58)
    d.text(x,y+392,'審核意見',24,True)
    d.text(x,y+430,'「R31 刪除需保留原因與來源，其餘同意。」',21)
    d.line(x,y+448,x+672,y+448)
    if not published:
        d.button(x,y+474,150,'退回修改');d.button(x+166,y+474,180,'核准並發布',True)
        d.note(x,y+548,672,['核准前後端重驗權限與內容雜湊','代理發布須標記未經系所審核'])
    else:
        d.text(x,y+474,'已發布 v0.3（經系所管理員審核）',24,True)
        d.text(x,y+518,'學生端改用 v0.3；v0.2 保留並標記 superseded。',21)
        d.note(x,y+548,672,['發布後不可原地修改；再改＝從 v0.3 複製新草稿'])

def ui10(d,x,y,after):
    d.note(x,y,672,['版本：cse-113-day@3','稽核紀錄唯讀，不隨版本刪除'])
    d.text(x,y+118,'版本時間軸',25,True)
    steps=[('created','系統管理員／AI 初稿帶入'),
           ('validated','規則引擎結構驗證'),
           ('tested','TC-29～TC-33 全數通過')]
    if after:
        steps+=[('submitted','系所管理員送審'),
                ('approved','系所管理員核准'),
                ('published','系所管理員發布')]
    else:
        steps+=[('submitted','尚未送審')]
    rowh=62
    for i,(a,b) in enumerate(steps):
        yy=y+134+i*rowh
        d.rect(x,yy,672,rowh-6,'#fafafa')
        d.text(x+14,yy+38,a,21,True)
        d.text(x+216,yy+38,b,21,width=430)
    note_y=y+140+len(steps)*rowh
    if after:
        d.note(x,note_y,672,['contentHash 3f9a…c21','v0.2 → superseded；學生端採用 v0.3'])
    else:
        d.note(x,note_y,672,['尚未進到審核階段','學生端仍使用 v0.2'])

def ui11(d,x,y,assigned):
    d.note(x,y,672,['系統管理員：最高權限','系所管理員：僅限被指派系所'])
    d.text(x,y+118,'系所與管理員',25,True)
    if not assigned:
        rows=[('資訊工程學系','無管理員 → 系統管理員代理','info','代理'),
              ('商船學系','1 位（sandra@…）','ok','已指派'),
              ('電機工程學系','無管理員','info','代理')]
    else:
        rows=[('資訊工程學系','2 位（新增 kevin@…）','ok','已指派'),
              ('商船學系','1 位（sandra@…）','ok','已指派'),
              ('電機工程學系','無管理員','info','代理')]
    rows_block(d,x,y+134,rows,66)
    d.text(x,y+360,'指派對象（Google 身分）',23,True)
    d.rect(x,y+378,672,52);d.text(x+14,y+413,'kevin@mail.ntou.edu.tw',21)
    d.text(x,y+462,'授予範圍：113–115 學年度、日間學士班',21)
    d.button(x,y+494,220,'指派為系所管理員',True)
    d.note(x,y+566,672,['撤銷最後一位管理員後，恢復由系統管理員發布',
                        '歷史審核標示不改寫；學生不得自提權限'])

plate('ui08-admin-validate','AP-UI-08｜規則驗證與測試','AP-US-12 · AP-FR-11、17 · AP-TC-26、29～33',('操作前：結構驗證失敗，測試未執行',lambda d,x,y:ui08(d,x,y,False)),('操作後：修正後測試全數通過，可送審',lambda d,x,y:ui08(d,x,y,True)),'結構驗證與測試是兩個關卡；任一未過不得送審。錯誤訊息須指出條文、節點或 selector，不接受「無法解析」的籠統提示。')

plate('ui09-admin-review','AP-UI-09｜審核與差異','AP-US-13 · AP-FR-12、18 · AP-TC-19、20、34',('操作前：檢視差異與審核意見',lambda d,x,y:ui09(d,x,y,False)),('操作後：核准並發布，保留舊版',lambda d,x,y:ui09(d,x,y,True)),'審核看的是「改了什麼」：差異由結構比較產生。退回須留原因；發布後不可原地修改，只能產生新版本。')

plate('ui10-admin-audit','AP-UI-10｜稽核紀錄與追溯','AP-US-13 · AP-FR-18 · AP-NFR-05、06 · AP-TC-34',('操作前：草稿已完成驗證與測試',lambda d,x,y:ui10(d,x,y,False)),('操作後：送審、核准、發布完成',lambda d,x,y:ui10(d,x,y,True)),'每一次動作都留操作者、角色、系所範圍、時間與內容雜湊；學生端結果可回查到版本與條文定位。')

plate('ui11-admin-admins','AP-UI-11｜系所管理員指派','AP-US-13 · AP-FR-13 · AP-TC-27',('操作前：資工無管理員，由系統管理員代理',lambda d,x,y:ui11(d,x,y,False)),('操作後：指派後由系所管理員發布',lambda d,x,y:ui11(d,x,y,True)),'指派只授予該系所；撤銷最後一位後恢復由系統管理員發布。畫面隱藏不代表授權，後端仍須驗證。')

def map_diagram(name,title,columns,rows,foot):
    w=2160;lh=156;cw=(w-260)/len(columns);h=220+lh*len(rows)+130
    d=Drawing(w,h,title,'依需求文件第 4.1 節切片表重繪；非 Miro 原始截圖。')
    d.text(40,58,title,36,True)
    d.text(40,104,'橫向：操作順序　／　縱向：交付切片　／　US 短代號均為 AP-US',23)
    d.rect(40,138,190,62,'#ddd');d.text(56,177,'交付階段',25,True)
    for i,t in enumerate(columns):
        x=244+i*cw;d.rect(x,138,cw-12,62,'#ddd');d.text(x+14,177,t,25,True)
    for ri,(label,cells) in enumerate(rows):
        y=216+ri*lh;d.rect(40,y,190,lh-14,'#f0f0f0');d.text(56,y+37,label,24,True,width=158)
        for ci,cell in enumerate(cells):
            x=244+ci*cw;d.rect(x,y,cw-12,lh-14,'#fafafa');d.text(x+14,y+35,cell,23,width=cw-40)
    d.text(40,h-67,foot,23)
    d.text(40,h-27,'圖表來源：需求文件 v0.3 第 4.1 節；保留原表格與 Miro 連結供核對。',21,color='#555')
    d.save(name,title,'文件內嵌故事地圖；依 v0.3 切片表重繪。')

map_diagram('story-student','學生使用者故事地圖', ['準備個人資料','查看畢業進度','尋找合適課程','安排修課計畫','檢視規劃結果'],[
 ('I1\n核心 Demo',['US-01\n選取模擬修課紀錄','US-02（I1 子集）\n總學分、分類學分及缺額','本階段未交付','本階段未交付','本階段未交付']),
 ('I2\n基本使用',['US-03 登入／US-04 同步\nUS-06 修正個人紀錄','US-02 113 規則缺額\nUS-05 前兩情境\nUS-07 條件覆蓋','US-08\n搜尋課程及歷年開課','本階段未交付','本階段未交付']),
 ('I3\nMVP 整合',['延續 I2 能力','US-02\n整合個人修正及規則更新','US-10\n依缺額篩選候選課程','US-09\n依學期增刪移動與保存','US-05 規劃通過情境\nUS-11 正式班別衝堂']),
 ('優先擴充\nMVP 後',['延續 MVP 能力','延續 MVP 能力','歷年開課頻率輔助找課','US-15\nAI 候選修課計畫','US-16\n已知先修條件檢查']),
 ('進階\n後續構想',['更多系所及年度\n複雜抵免及修課狀態','延續 MVP 能力','延續 MVP 能力','多學期最佳化\n拖曳排課','多方案比較\n完整擋修與選課限制'])
], 'I1 ≠ 完整 MVP。跨階段故事為逐步擴充；實際完成狀態及證據由看板記錄。')

map_diagram('story-maintainer','規則維護者使用者故事地圖',['建立規則','預覽與確認','決定發布','管理權限與版本'],[
 ('I1\n核心 Demo',['US-12\n總學分及分類測試規則','US-12\n以模擬紀錄核對預期值','本階段未交付','US-12\n測試版本及部分範圍']),
 ('I2\n基本使用',['US-12\n113 規則、來源與覆蓋清單','US-12\n以案例核對採計結果','US-13\n無管理員時開發者發布','US-13\n版本、來源及審核標示']),
 ('I3\nMVP 整合',['US-12\n基本介面編輯草稿','US-12\n預覽草稿及規則錯誤','US-13\n依系所權限發布','US-13\n管理員、歷史及學生版本']),
 ('優先擴充\n有餘裕時',['US-14\n官方 PDF → AI 草稿','US-14\n人工確認及修正','US-14\n交由具發布權者發布','沿用既有版本管理']),
 ('進階\n後續構想',['自動讀取官方網頁','偵測規章變更','沿用既有發布流程','沿用既有版本管理'])
], '無管理員：開發者可發布。已有管理員：由該系所管理員決定發布。草稿不替代已發布版。')

(ROOT/'assets-manifest.json').write_text(json.dumps(MANIFEST,ensure_ascii=False,indent=2),encoding='utf-8')
contract='''<!-- THESIS: Read mode. Each plate shows a requirements state transition with exact test values.
OWN-WORLD: User-pinned grayscale wireframes, white background, crisp borders, traditional Chinese text.
STORY: Reader follows the story maps and checks seven interfaces against US/FR/TC identifiers.
FIRST VIEWPORT: Contents links, provenance note, and full-width I1 before/after plate. Each vector retains a native viewBox.
FORM: Document illustration gallery; code-led, user-pinned direction; no seed required for the precisely specified scope.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->'''
nav=''.join(f'<a href="#{a["id"]}">{escape(a["title"])}</a>' for a in MANIFEST)
sections=''.join(f'<section id="{a["id"]}"><h2>{escape(a["title"])}</h2><p>{escape(a["description"])}</p><div class="art" id="art-{a["id"]}">{(ASSETS/(a["id"]+".svg")).read_text(encoding="utf-8")}</div><p><a href="assets/{a["id"]}.svg" download>下載可編輯 SVG</a> · <a href="assets/{a["id"]}.png" download>下載文件用 PNG</a></p></section>' for a in MANIFEST)
(ROOT/'index.html').write_text(f'''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NTOUER 需求文件圖庫</title><style>*{{box-sizing:border-box}}body{{margin:0;background:#f5f5f5;color:#252525;font:17px/1.75 "Microsoft JhengHei",sans-serif}}main{{max-width:1600px;margin:auto;padding:32px}}h1{{font-size:32px}}h2{{font-size:24px;margin-top:0}}nav{{display:flex;gap:12px 24px;flex-wrap:wrap;margin:24px 0}}a{{color:#333;text-underline-offset:4px}}a:focus-visible{{outline:3px solid #333;outline-offset:5px}}section{{margin:48px 0;padding:24px;background:white}}.art{{overflow:auto}}.art>svg{{display:block;width:100%;height:auto;min-width:1000px}}::selection{{background:#ddd}}@media(max-width:700px){{main{{padding:16px}}section{{padding:12px}}h1{{font-size:26px}}}}@media print{{nav,section>p:last-child{{display:none}}section{{break-inside:avoid}}.art>svg{{min-width:0}}}}</style></head><body>{contract}<main><h1>NTOUER 需求文件圖庫</h1><p>11 張介面線稿（學生端 7 張、管理端 4 張）與 2 張故事地圖。圖中的控制項為規劃示意；以 SVG 保留可編輯文字與區塊，以 PNG 供需求文件嵌入。</p><p>故事地圖依 v0.3 第 4.1 節重繪，未能讀取 Miro 原始看板。小螢幕可左右捲動查看圖中細節。</p><nav aria-label="圖庫目錄">{nav}</nav>{sections}</main></body></html>''',encoding='utf-8')
print('Built',len(MANIFEST),'editable SVG diagrams and HTML gallery.')
