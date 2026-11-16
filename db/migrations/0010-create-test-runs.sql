-- 0010-create-test-runs
-- 規格：docs/design/database-design.md

-- Up Migration
create table test_runs (
  run_id     bigint generated always as identity primary key,
  version_id text not null references rule_versions(version_id),
  suite      text not null,
  passed     integer not null,
  failed     integer not null,
  detail     jsonb,
  run_by     uuid references users(user_id),
  at         timestamptz not null default now(),
  constraint test_runs_counts_check check (passed >= 0 and failed >= 0)
);

-- Down Migration
