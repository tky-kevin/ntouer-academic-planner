-- 修正 rule_clauses.status 的語意
-- 依 docs/design/rule-model.md，條文狀態表達「資料品質」：
-- verified／pending／conflict（預設 verified），
-- 不是生命週期（原設計誤寫成 active／retired）。
-- 植入 seed 時實際資料出現 pending，才暴露這個不一致。

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
