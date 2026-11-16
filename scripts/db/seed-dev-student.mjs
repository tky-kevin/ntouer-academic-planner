// 開發用學生：`GET /api/me/progress` 與學生端畫面需要一份「真的有修課紀錄」的學生。
// 資料與 spike 的 cseComplete() 同一組（135 學分、仍有未解衝突 X01），
// 讓 demo 與整合測試看到的是真實的引擎輸出，不是另一套假資料。
import { readFileSync } from "node:fs";
import path from "node:path";

const DEV_USER = {
  googleSub: "dev-student",
  email: "dev-student@example.edu",
  deptId: "cse",
  entryYear: 113,
  program: "day",
};

const STATUS_OVERRIDES = [
  ["R15", "met"],
  ["R16", "met"],
  ["R17", "met"],
  ["R18", "met"],
  ["R19", "met"],
];

export async function seedDevStudent(client, root = process.cwd()) {
  const records = JSON.parse(
    readFileSync(path.join(root, "db/seed/dev-student-records.json"), "utf8"),
  );

  const user = await client.query(
    `insert into users (google_sub, email, role, dept_id, entry_year, program)
     values ($1, $2, 'student', $3, $4, $5)
     on conflict (google_sub) do update
       set dept_id = excluded.dept_id, entry_year = excluded.entry_year, program = excluded.program
     returning user_id`,
    [DEV_USER.googleSub, DEV_USER.email, DEV_USER.deptId, DEV_USER.entryYear, DEV_USER.program],
  );
  const userId = user.rows[0].user_id;

  for (const record of records) {
    await client.query(
      `insert into student_records
         (user_id, record_key, course_code, course_name, credits, category, status, tags, owner, term, raw, synced_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       on conflict (user_id, record_key) do update
         set course_code = excluded.course_code, course_name = excluded.course_name,
             credits = excluded.credits, category = excluded.category, status = excluded.status,
             tags = excluded.tags, owner = excluded.owner, term = excluded.term,
             raw = excluded.raw, synced_at = now()`,
      [
        userId,
        record.recordKey,
        record.courseCode,
        record.courseName,
        record.credits,
        record.category,
        record.status,
        record.tags,
        record.owner,
        record.term,
        JSON.stringify({ source: "dev-seed" }),
      ],
    );
  }

  // 移除不在 fixtures 裡的舊紀錄，重跑 seed 才會收斂到同一組資料。
  await client.query(
    `delete from student_records where user_id = $1 and not (record_key = any($2::text[]))`,
    [userId, records.map((record) => record.recordKey)],
  );

  await client.query(
    `insert into student_sync_state (user_id, last_success_at, last_attempt_at, last_result)
     values ($1, now(), now(), 'ok')
     on conflict (user_id) do update
       set last_success_at = now(), last_attempt_at = now(), last_result = 'ok', last_error_code = null`,
    [userId],
  );

  for (const [requirementId, state] of STATUS_OVERRIDES) {
    await client.query(
      `insert into student_condition_overrides (user_id, bundle_id, requirement_id, state)
       values ($1, 'cse-113-day', $2, $3)
       on conflict (user_id, bundle_id, requirement_id) do update
         set state = excluded.state, updated_at = now()`,
      [userId, requirementId, state],
    );
  }

  console.log(`seed dev student: ${DEV_USER.googleSub}（${records.length} 筆紀錄、${DEV_USER.deptId}-${DEV_USER.entryYear}）`);
  return { userId, recordCount: records.length };
}
