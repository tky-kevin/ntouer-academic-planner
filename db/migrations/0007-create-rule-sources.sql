-- 0007-create-rule-sources
-- 規格：docs/design/database-design.md

-- Up Migration
create table rule_sources (
  version_id   text not null references rule_versions(version_id) on delete cascade,
  source_id    text not null,
  title        text not null,
  url          text,
  locator      text not null,
  sha256       text,
  retrieved_at date,
  status       text not null default 'active',
  primary key (version_id, source_id),
  constraint rule_sources_status_check check (status in ('active','retired','unresolved'))
);

-- Down Migration
