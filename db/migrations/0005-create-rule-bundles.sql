-- 0005-create-rule-bundles
-- 規格：docs/design/database-design.md

-- Up Migration
create table rule_bundles (
  bundle_id  text primary key,
  dept_id    text not null references departments(dept_id),
  entry_year smallint not null,
  program    text not null,
  title      text not null,
  created_at timestamptz not null default now(),
  constraint rule_bundles_identity_key unique (dept_id, entry_year, program),
  constraint rule_bundles_year_check check (entry_year between 100 and 130)
);

-- Down Migration
