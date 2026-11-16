-- 0006-create-rule-versions
-- 規格：docs/design/database-design.md

-- Up Migration
create table rule_versions (
  version_id     text primary key,
  bundle_id      text not null references rule_bundles(bundle_id),
  version_no     integer not null,
  status         text not null default 'draft',
  payload        jsonb not null,
  schema_version text not null,
  content_hash   text not null,
  created_by     uuid references users(user_id),
  created_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  reviewed_by    uuid references users(user_id),
  reviewed_at    timestamptz,
  published_by   uuid references users(user_id),
  published_at   timestamptz,
  proxy          boolean not null default false,
  superseded_at  timestamptz,
  notes          text,
  constraint rule_versions_identity_key unique (bundle_id, version_no),
  constraint rule_versions_status_check check (status in ('draft','validating','testing','in-review','approved','published','superseded')),
  constraint rule_versions_proxy_check check (proxy = false or published_by is not null),
  constraint rule_versions_version_no_check check (version_no >= 1)
);

-- Down Migration
