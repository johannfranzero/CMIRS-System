# CMIRS — Phase 4D.2: Report Visibility Function Repair (SQLSTATE 42702)

**Date:** 2026-10-21
**Project root:** `D:\CMIRS-System\my-app`
**Continues:** `docs/frontend/PHASE_4D_1_VERIFICATION_REPORT.md` §9.1
**Status:** migration **PREPARED and LOCALLY VALIDATED — NOT APPLIED**
**Companion report:** `docs/frontend/PHASE_4D_2_TECHNICIAN_VISIBILITY_FIX_REPORT.md`

> ### Status update — 2026-10-21 (later in the same working session)
>
> This document is the historical record of the moment the migration was prepared. **The
> migration has since been applied.** `npx supabase db push --linked` executed
> `20261021000008_fix_can_view_report_parameter_ambiguity.sql` against the remote project, and
> the repair is verified against the live database by
> `scripts/remote-rls-verification.sql` (**25/25 PASS** — the helper executes without 42702 for
> all five roles, an unrelated authenticated user and the `anon` role). The current
> authoritative record is `docs/FINAL_ACCEPTANCE_REPORT.md`.

---

## 1. Confirmed Root Cause

### 1.1 The observed failure

```
[DAL] getReportsQueue query error: "column reference \"report_id\" is ambiguous" | code= "42702" | status= "unknown"
[DAL] getDashboardKpiStats query error: "column reference \"report_id\" is ambiguous" | code= "42702" | …
[DAL] getCampusFacilityBreakdown query error: "column reference \"report_id\" is ambiguous" | code= "42702" | …
```

Captured from the running application in `.next/dev/logs/next-development.log` (timestamp `12:19:10`) and
reproduced on a freshly built production server. **PostgreSQL SQLSTATE 42702 is `ambiguous_column`.**

### 1.2 The exact ambiguous expression

`supabase/migrations/20261018000004_security_functions_and_rpc.sql`, function
`public.can_view_report(report_id UUID)`:

```sql
  -- 3. Technician with qualifying assignment (all statuses EXCEPT declined, APPROVED OD-NEW-4)
  IF caller_role = 'technician' AND EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.report_id = report_id        -- <<< THE AMBIGUOUS EXPRESSION
      AND a.technician_id = auth.uid()
      AND a.status != 'declined'
  ) THEN
```

* `a.report_id` — qualified with the table alias, so it unambiguously denotes the column
  `public.assignments.report_id` (`20261018000001_core_schema.sql:191`).
* `report_id` (right-hand side) — **unqualified**. It can denote either the PL/pgSQL input
  parameter or the column of `public.assignments` that is in scope in the same statement.
  With PL/pgSQL's default `plpgsql.variable_conflict = error`, that ambiguity is raised as a
  hard error at parse time: `column reference "report_id" is ambiguous` (42702).

**Only that one expression was ambiguous.** The reporter branch

```sql
    SELECT 1 FROM public.reports r
    WHERE r.id = report_id
```

is unambiguous, because `public.reports` (`20261018000001_core_schema.sql:173-186`) has **no**
`report_id` column — its columns are `id`, `report_number`, `title`, `description`, `category_id`,
`location_id`, `reporter_id`, `status`, `is_urgent_hazard`, `confirmed_priority`, `created_at`,
`updated_at`. The name can therefore only denote the parameter.

### 1.3 Why it is a security defect, not only a functional one

Had PL/pgSQL resolved the unqualified `report_id` to the **column** (which is what plain SQL
would do), the predicate would have degraded to

```sql
WHERE a.report_id = a.report_id     -- always true for any assignment row
```

which would have satisfied the technician branch for **any report that has any assignment at
all** — a report-visibility bypass. SQLSTATE 42702 is therefore currently *preventing* a
security hole. The repair below restores the intended comparison
`public.assignments.report_id = <the report id argument>`; it does not widen access.

### 1.4 Blast radius

`public.can_view_report` is invoked from **seven RLS policy expressions** across five tables
plus Storage:

| File | Line | Policy / expression |
| --- | --- | --- |
| `20261018000005_table_rls_policies.sql` | 135 | `reports_select` — `public.can_view_report(id)` |
| `20261018000005_table_rls_policies.sql` | 276 | `report_attachments_select` — `public.can_view_report(report_id)` |
| `20261018000005_table_rls_policies.sql` | 321 | `report_status_history_select` — `public.can_view_report(report_id)` |
| `20261018000005_table_rls_policies.sql` | 329 | `report_status_history_insert` — `public.can_view_report(report_id)` |
| `20261018000005_table_rls_policies.sql` | 340 | `report_comments_select` — `public.can_view_report(report_id)` |
| `20261018000005_table_rls_policies.sql` | 404 | `verifications_select` — `public.can_view_report(report_id)` |
| `20261018000006_storage_setup.sql` | 60 | `storage.objects` SELECT — `public.can_view_report(ra.report_id)` |

Because the whole `IF` expression is parsed as a single statement, the ambiguous sub-select is
parsed for **every** caller that reaches the third branch. Oversight roles
(`coordinator`, `administrator`, `management`) return `TRUE` in the first branch and are
unaffected; `student_personnel` and `technician` are affected, and for them **every `SELECT` on
`public.reports` failed**, together with every dependent policy listed above.

### 1.5 Blast radius check — no other function is affected

`tests/unit/sql-function-parameter-ambiguity.test.mjs` statically analyses every PL/pgSQL
function in the migration set and reports exactly one ambiguous definition:
`public.can_view_report` in migration 004. `public.get_user_role()`,
`public.soft_delete_attachment(attachment_id UUID)` and
`public.decline_assignment(target_assignment_id UUID, ...)` use parameter names that do not
collide with any column of the tables they query, and the trigger functions take no
parameters.

---

## 2. Migration File and SQL Summary

### 2.1 File

```
supabase/migrations/20261021000008_fix_can_view_report_parameter_ambiguity.sql
```

**Naming convention** — matches the repository: `YYYYMMDD` + a 5-digit sequence.
Existing files are `20261018000001`…`20261018000006`; `20261020000007` is reserved for the
notification lifecycle migration. `20261021000008` therefore sorts **after** the reserved
migration 007, so the repair is applied last and cannot be preempted by a migration that has
not been authored yet. The migration is **additive**: it creates one new file and modifies
nothing that already exists.

### 2.2 SQL summary

The migration contains exactly two executable statements:

```sql
CREATE OR REPLACE FUNCTION public.can_view_report(report_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
#variable_conflict use_variable
DECLARE
  caller_role user_role;
  target_report_id UUID;
BEGIN
  target_report_id := report_id;          -- (A) argument captured in a collision-free local
  caller_role := public.get_user_role();

  IF caller_role IN ('coordinator','administrator','management') THEN   -- (B) unchanged
    RETURN TRUE;
  END IF;

  IF EXISTS (                                                    -- (C) unchanged rule,
    SELECT 1 FROM public.reports r                              --     new identifier
    WHERE r.id = target_report_id
      AND r.reporter_id = auth.uid()
  ) THEN
    RETURN TRUE;
  END IF;

  IF caller_role = 'technician' AND EXISTS (                      -- (D) unchanged rule,
    SELECT 1 FROM public.assignments a                           --     corrected comparison
    WHERE a.report_id = target_report_id
      AND a.technician_id = auth.uid()
      AND a.status != 'declined'
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;

REVOKE ALL ON FUNCTION public.can_view_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_report(UUID) TO authenticated;
```

**(A) The ambiguity is removed structurally.** The argument is captured once into the local
`target_report_id`, a name that does not exist as a column in `public.reports` or
`public.assignments`. Every subsequent comparison uses that local, so no identifier in the
body can be ambiguous again. This is the fix the defect analysis calls for — the comparison
now reads `assignments.report_id = <the report id argument>` instead of the self-comparison
`a.report_id = a.report_id`.

**`#variable_conflict use_variable`** makes PL/pgSQL deterministically prefer the PL/pgSQL
variable whenever a name could denote both a variable and a column, so the resolution no longer
depends on the server's `plpgsql.variable_conflict` setting. It is the first line of the
function body, as PL/pgSQL requires.

### 2.3 Why the input parameter was NOT renamed

The task brief suggested a clearly named parameter such as `p_report_id`. That is **not
possible without an RLS change**, for two independent reasons:

1. **PostgreSQL rejects the rename.** `CREATE OR REPLACE FUNCTION` cannot rename an input
   parameter; PostgreSQL raises
   `ERROR: cannot change name of input parameter "report_id"` / `HINT: Use DROP FUNCTION first.`
2. **`DROP FUNCTION` is blocked by the RLS policies.** The seven policy expressions above
   depend on the function, so `DROP FUNCTION public.can_view_report(UUID)` is refused
   (`cannot drop function ... because other objects depend on it`) unless the policies are
   dropped too — which would mean recreating `reports_select`,
   `report_attachments_select`, `report_status_history_select`, `report_status_history_insert`,
   `report_comments_select`, `verifications_select` and the `storage.objects` policy.

The parameter is therefore **deliberately kept as `report_id`**. The function *signature*
(`can_view_report(UUID)`) is what policies and privileges depend on, and that is unchanged;
all seven call sites and both privilege statements remain valid byte-for-byte. The brief's
"preserve the existing function signature where necessary to avoid breaking policy
dependencies" is satisfied exactly. The renamed *local* (`target_report_id`) delivers the
"clearly named identifier" intent inside the body, where it is safe.

### 2.4 What the migration does NOT do

Verified by an automated test that scans the executable SQL of the migration (comments
excluded):

| Prohibited construct | Present |
| --- | --- |
| `CREATE` / `DROP` / `ALTER POLICY` | No |
| `CREATE` / `ALTER` / `DROP TABLE` | No |
| `CREATE INDEX`, `CREATE` / `DROP TRIGGER` | No |
| `INSERT INTO`, `UPDATE`, `DELETE FROM`, `TRUNCATE` | No |
| `DROP FUNCTION` | No |
| `GRANT ALL` | No |

The only schema object the migration defines is `can_view_report`. No table, column, index,
trigger, policy, role, grant, or data is touched.

---

## 3. Authorization Behaviour Preserved

The three approved branches (APPROVED OD-NEW-4) are reproduced **verbatim**; only the
identifier used to reference the report id argument changed.

| # | Approved rule | In the repaired function | Changed? |
| --- | --- | --- | --- |
| 1 | Oversight roles (`coordinator`, `administrator`, `management`) see all reports | `IF caller_role IN ('coordinator','administrator','management') THEN RETURN TRUE;` | **No** — identical |
| 2 | A reporter sees their own report regardless of current role | `EXISTS (SELECT 1 FROM public.reports r WHERE r.id = target_report_id AND r.reporter_id = auth.uid())` | **Rule identical**; the argument reference is now unambiguous |
| 3 | A technician sees reports with a qualifying assignment (any status **except** `declined`) | `EXISTS (SELECT 1 FROM public.assignments a WHERE a.report_id = target_report_id AND a.technician_id = auth.uid() AND a.status != 'declined')` | **Rule identical**; the comparison is corrected from the ambiguous `= report_id` to `= target_report_id` |
| — | Everything else | `RETURN FALSE;` | **No** — identical |

Preserved attributes: `SECURITY DEFINER` · `STABLE` · `SET search_path = public, auth, pg_temp` ·
`REVOKE ALL … FROM PUBLIC` · `GRANT EXECUTE … TO authenticated` · the input parameter name and
the `can_view_report(UUID)` signature.

**Visibility is not broadened.** The repair removes an error, it does not relax a predicate.
The new local `target_report_id` carries exactly the same value the parameter carried, so the
set of visible reports is identical to the intended design — which the current 42702 failure
makes unreachable for two of the five roles.

The access matrix is encoded as an executable model in
`tests/unit/role-visibility-model.test.mjs` and asserted:

| Viewer | Target report | Assignment | Expected |
| --- | --- | --- | --- |
| `student_personnel` (owner) | own report | — | **may view** |
| `student_personnel` (other) | someone else's report | — | **may not view** |
| `technician` | assigned report | `assigned` / `in_progress` / `on_hold` / `completed` | **may view** |
| `technician` | assigned report | `declined` | **may not view** |
| `technician` | report assigned to a *different* technician | — | **may not view** |
| `technician` | a report they are assigned to, reported by someone else | `assigned` | **may view** |
| `coordinator` / `administrator` / `management` | any report | — | **may view** |
| reporter who is also a technician | own report | — | **may view** (rule 2 applies regardless of role) |

A second test parses the *effective* SQL definition and asserts that the technician branch
compares `a.report_id` with the local that is assigned from the function argument, and
explicitly asserts that it does **not** compare `a.report_id` with itself.

---

## 4. Tests and Results

### 4.1 New and updated test files

| File | Tests | Purpose |
| --- | --- | --- |
| `tests/unit/sql-function-parameter-ambiguity.test.mjs` | **7** | Statement-scoped ambiguity detector; effective-definition resolution; supersession proof; authorization-behaviour preservation; structural PL/pgSQL validation; additive-only validation; call-site compatibility |
| `tests/unit/role-visibility-model.test.mjs` | **9** | Access-matrix model; effective-SQL anti-broadening proof; qualification-predicate preservation; count-accuracy; KPI/filter alignment; failed-query-vs-empty-result |

### 4.2 Actual results

```
$ node --test --test-reporter=tap tests/unit/sql-function-parameter-ambiguity.test.mjs
ok 1 - the detector identifies a bare parameter reference in a colliding scope
ok 2 - the effective definition of every function is free of parameter ambiguity
ok 3 - the repair migration supersedes the original can_view_report definition
ok 4 - the repair preserves the approved authorization behaviour exactly
ok 5 - the repair migration is structurally valid PL/pgSQL
ok 6 - the repair migration is additive and touches no table, policy, role, or data
ok 7 - every RLS call site of can_view_report remains valid
# tests 7
# pass 7
# fail 0

$ node --test --test-reporter=tap tests/unit/role-visibility-model.test.mjs
ok 1 - the reporter may view their own report and nobody else may
ok 2 - a technician may view exactly the reports they are assigned to
ok 3 - oversight roles retain full operational visibility
ok 4 - a reporter who is also a technician keeps reporter access
ok 5 - the effective SQL compares assignments against the report id ARGUMENT
ok 6 - the effective SQL preserves the qualification predicate and the branch count
ok 7 - displayed queue counts come from the complete authorized dataset
ok 8 - KPI mapping stays aligned with the report list filters
ok 9 - the application never converts a failed query into a successful empty result
# tests 9
# pass 9
# fail 0
```

### 4.3 Full suite, type check, lint, build

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors, 0 warnings** |
| `npm run build` | **Success** — `✓ Compiled successfully in 5.4s`, `✓ Generating static pages … (12/12)` |
| `node --test tests/unit/*.test.mjs` | **176 tests · 174 pass · 2 fail** |

The 2 failures are the **pre-existing** notification-migration contract tests
(`ENOENT` on `20261020000007_notification_lifecycle_rpcs.sql`, a migration that was never
authored and was never applied to the remote database). They are unrelated to this repair and
were left untouched by instruction.

**Progression:** Phase 4D baseline 137/133/4 → Phase 4D 163/161/2 → **Phase 4D.2 176/174/2**.

### 4.4 Local review of the migration SQL

Performed without a database: structural validation of the dollar-quoted body (balanced
delimiters, matching tags), directive placement (`#variable_conflict use_variable` first),
block structure (one `BEGIN` / one `END;`), declaration-before-use of the local, the
prohibited-construct scan, and the call-site compatibility scan — all automated in the test
suite.

---

## 5. Exact Command and Environment Required to Apply and Verify

**The migration was NOT applied. No remote command was executed in this phase.**

### 5.1 Prerequisites

| Item | Value / requirement |
| --- | --- |
| Supabase project ref | `xyirfifvcntuzceivtho` (from `.env.local`, host only) |
| CLI | `npx supabase` (already vendored — **do not install**) |
| Link state | The project must be linked (`supabase/.temp/project-ref` present) |
| Remote DB password | Required by the CLI for `--linked` operations; **must be supplied through `SUPABASE_DB_PASSWORD` by the owner and never committed** |
| Authorization | **Explicit owner authorization is required before any command below is run** |

### 5.2 Apply (owner-authorized, in this order)

```powershell
# 0) Preview — must list exactly one pending migration:
#    20261021000008_fix_can_view_report_parameter_ambiguity.sql
npx supabase db push --dry-run

# 1) Apply
npx supabase db push
```

Alternative if the owner prefers single-file stepping in the Dashboard SQL Editor: paste the
contents of `supabase/migrations/20261021000008_fix_can_view_report_parameter_ambiguity.sql`
into a single transaction. The file contains only two statements and is safe to execute as a
unit.

> `supabase db push` does **not** wrap all files in one transaction, but this migration file
> is self-contained and idempotent: re-running it is a no-op because `CREATE OR REPLACE
> FUNCTION` with the same body produces the same function.

### 5.3 Verify after applying

```sql
-- 3.1 The function body must contain the corrected comparison and no bare-parameter ambiguity.
SELECT pg_get_functiondef('public.can_view_report(uuid)'::regprocedure);
-- Expect: 'target_report_id' present, 'a.report_id = report_id' absent,
--         '#variable_conflict use_variable' present, SECURITY DEFINER present,
--         search_path = public, auth, pg_temp present.

-- 3.2 The signature and privileges must be unchanged.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef,
       p.provolatile, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'can_view_report';
-- Expect: args = 'report_id uuid', prosecdef = true, provolatile = 's',
--         proconfig = {search_path=public,auth,pg_temp}

SELECT has_function_privilege('authenticated', 'public.can_view_report(uuid)', 'EXECUTE') AS may_execute;
-- Expect: true

-- 3.3 The function must no longer raise. Run as each role:
SELECT public.can_view_report('<any-report-uuid>'::uuid);
-- Expect: true / false, NEVER "column reference \"report_id\" is ambiguous".
```

Then verify the application end to end with an authenticated session:

1. Sign in as `test-student@cmirs.internal` → the dashboard KPI cards must show **numbers**
   (not "Unavailable") and the report queue must show the student's own reports.
2. Sign in as `test-tech@cmirs.internal` → the dashboard must show the technician's assigned
   work orders; a report the technician is **not** assigned to must not be readable at
   `/reports/<uuid>`.
3. Sign in as `test-coord@cmirs.internal` → the full queue must be visible (unchanged
   behaviour), and the notification bell remains disabled.
4. Confirm the dev/server logs contain **no** `42702` entry.

### 5.4 Rollback

The previous definition is preserved verbatim in
`supabase/migrations/20261018000004_security_functions_and_rpc.sql`. Rolling back means
re-running that `CREATE OR REPLACE FUNCTION` block. Note that the rollback **re-introduces**
the 42702 failure — it does not restore a working state.

---

## 6. Summary

| Item | State |
| --- | --- |
| Root cause | Confirmed — a single unqualified parameter reference colliding with `public.assignments.report_id` in the technician branch of `public.can_view_report` |
| Security impact of the current error | The 42702 failure currently *prevents* a visibility bypass (`a.report_id = a.report_id`); the repair restores the intended comparison without widening access |
| Migration | `supabase/migrations/20261021000008_fix_can_view_report_parameter_ambiguity.sql` — additive, one file, two statements, nothing else touched |
| Authorization | All three approved branches preserved verbatim; signature, `SECURITY DEFINER`, `STABLE`, `search_path` and both privilege statements preserved |
| Local validation | 16 new/updated tests, all passing; `tsc` 0 errors; `eslint` 0/0; `next build` succeeds; full suite 176/174/2 |
| Remote application | **NOT performed** — requires explicit owner authorization (§5) |
| Post-apply verification | **NOT performed** — requires an authenticated session and the applied migration |
