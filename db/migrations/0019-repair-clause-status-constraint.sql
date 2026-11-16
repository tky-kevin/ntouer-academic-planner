-- 0019-repair-clause-status-constraint
-- 背景：0018 的檔案同時包含 Up 與 Down 兩段 SQL。舊版自製 runner 會把整份檔案送進
-- PostgreSQL，等於 Up 跑完立刻跑 Down，constraint 最後被改回 ('active','retired')，
-- 於是 seed 寫入 verified 時失敗（只在「全新資料庫」會遇到，已存在的 DB 因為沒有新插入而看不出來）。
-- 修法有兩個：(1) runner 只套用 Up 段；(2) 用這支遷移把已經被改壞的 DB 修回來。
-- 這裡可重複執行：先移除舊 constraint，再依 rule-model.md 的語意重建。

-- Up Migration
alter table rule_clauses drop constraint if exists rule_clauses_status_check;

update rule_clauses set status = 'verified' where status in ('active', 'retired');

alter table rule_clauses alter column status set default 'verified';

alter table rule_clauses
  add constraint rule_clauses_status_check check (status in ('verified', 'pending', 'conflict'));

-- Down Migration
alter table rule_clauses drop constraint if exists rule_clauses_status_check;
alter table rule_clauses alter column status set default 'active';
alter table rule_clauses
  add constraint rule_clauses_status_check check (status in ('active', 'retired'));
