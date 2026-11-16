-- 0016-create-indexes
-- 規格：docs/design/database-design.md

-- Up Migration
create index sessions_user_active_idx on sessions (user_id) where revoked_at is null;
create index sessions_expires_idx on sessions (expires_at);

create index department_admins_user_active_idx on department_admins (user_id) where revoked_at is null;
create index department_admins_dept_active_idx on department_admins (dept_id) where revoked_at is null;

create index rule_bundles_dept_year_idx on rule_bundles (dept_id, entry_year);

create index rule_versions_published_idx on rule_versions (bundle_id, version_no desc) where status = 'published';
create index rule_versions_status_idx on rule_versions (status);

create index rule_sources_version_idx on rule_sources (version_id);
create index rule_clauses_version_source_idx on rule_clauses (version_id, source_id);

create index review_records_version_at_idx on review_records (version_id, at);
create index review_records_actor_at_idx on review_records (actor_id, at);

create index test_runs_version_at_idx on test_runs (version_id, at desc);

create index student_records_user_course_idx on student_records (user_id, course_code);
create index student_plans_user_term_sort_idx on student_plans (user_id, term, sort);

-- Down Migration
