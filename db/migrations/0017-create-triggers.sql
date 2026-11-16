-- 0017-create-triggers
-- 規格：docs/design/database-design.md

-- Up Migration
create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'immutable table %: % is not allowed', TG_TABLE_NAME, TG_OP;
end;
$$;

create trigger review_records_immutable
  before update or delete on review_records
  for each row execute function forbid_mutation();

create trigger test_runs_immutable
  before update or delete on test_runs
  for each row execute function forbid_mutation();

create or replace function rule_versions_guard() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if old.status in ('published', 'superseded') then
      raise exception 'published version cannot be deleted';
    end if;
    return old;
  end if;
  if old.status in ('published', 'superseded') then
    if new.payload is distinct from old.payload
       or new.content_hash is distinct from old.content_hash
       or new.version_no is distinct from old.version_no
       or new.bundle_id is distinct from old.bundle_id then
      raise exception 'published version is immutable';
    end if;
  end if;
  return new;
end;
$$;

create trigger rule_versions_immutable
  before update or delete on rule_versions
  for each row execute function rule_versions_guard();

create or replace function version_child_guard() returns trigger
language plpgsql as $$
declare
  v_status text;
  v_id text;
begin
  v_id := coalesce(old.version_id, new.version_id);
  select status into v_status from rule_versions where version_id = v_id;
  if v_status in ('published', 'superseded') then
    raise exception 'children of a published version are immutable';
  end if;
  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger rule_sources_guard
  before update or delete on rule_sources
  for each row execute function version_child_guard();

create trigger rule_clauses_guard
  before update or delete on rule_clauses
  for each row execute function version_child_guard();

-- Down Migration
