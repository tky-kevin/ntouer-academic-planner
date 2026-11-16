-- 0008-create-rule-clauses
-- 規格：docs/design/database-design.md

-- Up Migration
create table rule_clauses (
  version_id text not null,
  clause_id  text not null,
  source_id  text not null,
  locator    text not null,
  text       text not null,
  reading    text,
  status     text not null default 'active',
  primary key (version_id, clause_id),
  constraint rule_clauses_source_fkey foreign key (version_id, source_id)
    references rule_sources(version_id, source_id) on delete cascade,
  constraint rule_clauses_status_check check (status in ('active','retired')),
  constraint rule_clauses_text_check check (length(text) > 0)
);

-- Down Migration
