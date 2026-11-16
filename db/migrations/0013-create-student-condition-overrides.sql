-- 0013-create-student-condition-overrides
-- 規格：docs/design/database-design.md

-- Up Migration
create table student_condition_overrides (
  user_id        uuid not null references users(user_id) on delete cascade,
  bundle_id      text not null references rule_bundles(bundle_id),
  requirement_id text not null,
  state          text not null,
  updated_at     timestamptz not null default now(),
  primary key (user_id, bundle_id, requirement_id),
  constraint student_condition_overrides_state_check check (state in ('met','notMet','unknown'))
);

-- Down Migration
