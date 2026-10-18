# CMIRS Gate E.3 — Test Account Provisioning Preflight Report

> **Document:** `docs/database-design/PHASE_E3_TEST_ACCOUNT_PREFLIGHT.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** Gate E.3 — Test Account Provisioning Preflight  
> **Target Project Reference:** `xyirfifvcntuzceivtho` (`CMIRS-System`)  
> **Database Engine:** PostgreSQL `17.11.0.003` (Channel `ga`, Region `ap-southeast-1`)  
> **Execution Status:** **PREFLIGHT AUDIT COMPLETED — ZERO AUTH USERS OR PROFILES CREATED**  
> **Final Phase Verdict:** **READY FOR OWNER PROVISIONING APPROVAL**  

---

## 1. Executive Summary & Objective

With Gate E.2 seed categories and campus locations successfully populated in the remote database (verified 5 categories and 5 locations), the remaining prerequisite for executing the 45-test RLS integration suite ([`docs/database-design/PHASE_5J_RLS_TEST_MATRIX.md`](file:///d:/CMIRS-System/my-app/docs/database-design/PHASE_5J_RLS_TEST_MATRIX.md)) is provisioning the five dedicated role test accounts.

This preflight:
1. Audits Trigger T4 (`handle_new_user`) and its role assignment mechanics.
2. Cross-references proposed test identities with [`docs/ROLES.md`](file:///d:/CMIRS-System/my-app/docs/ROLES.md) and the deployed `user_role` enum.
3. Examines the local environment and identifies credential prerequisites.
4. Formulates two secure, compliant provisioning workflows (Dashboard UI vs. Admin API script).
5. Defines read-only verification queries and fail-safe recovery procedures.

---

## 2. Trigger T4 & Schema Mechanics Audit

### 2.1 Trigger T4 Function Definition
In [`supabase/migrations/20261018000003_triggers.sql:L122-L145`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000003_triggers.sql#L122-L145):

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email, 'New User'),
    'student_personnel'::user_role
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
```

### 2.2 Critical Trigger Findings
1. **Hardcoded Initial Role:** Trigger T4 unconditionally assigns `'student_personnel'::user_role` (line 134). **Role assignment is NOT configurable through Auth user metadata.** Even if user creation metadata contains `{ role: 'admin' }`, Trigger T4 completely ignores it and creates a profile with `student_personnel`.
2. **Safe Defaults Principle (D1):** This behavior directly enforces the architectural requirement in `docs/ROLES.md`: *"New registrations receive a restricted default role until an administrator assigns the appropriate role (D1)."*
3. **Idempotency:** `ON CONFLICT (id) DO NOTHING` prevents transaction aborts if a profile row already exists for the user ID.
4. **Metadata Extraction:** The trigger extracts `full_name` from `raw_user_meta_data->>'full_name'`, falling back to `name`, `email`, or `'New User'`.

---

## 3. Profile Schema, RLS, and Role-Elevation Mechanics

### 3.1 Table Definition: `public.profiles`
From [`supabase/migrations/20261018000001_core_schema.sql:L131-L140`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000001_core_schema.sql#L131-L140):
- `id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`
- `email TEXT NOT NULL`
- `full_name TEXT NOT NULL`
- `role user_role NOT NULL DEFAULT 'student_personnel'`
- `phone TEXT` (nullable)
- `is_active BOOLEAN NOT NULL DEFAULT true`
- `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### 3.2 Role Modification RLS Policy
In [`supabase/migrations/20261018000005_table_rls_policies.sql:L32-L52`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000005_table_rls_policies.sql#L32-L52):
- **Self-Update Policy (`profiles_update_own`):** Users can only update their own profile, and `WITH CHECK` enforces that `role` cannot be changed:
  ```sql
  AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
  ```
- **Administrator Policy (`profiles_update_admin`):** Only authenticated users with `public.get_user_role() = 'administrator'` can update other users' roles, and they are prohibited from modifying their own role (`AND id != auth.uid()`).

### 3.3 Trusted Role Promotion Mechanism for Test Accounts
Because all new accounts are created as `student_personnel`, the four elevated roles must be promoted post-creation:
- **Bootstrap Method:** A trusted administrative SQL query (executed via `npx supabase db query --linked` or the Supabase SQL Editor as service/superuser) updates `public.profiles.role` for the 4 elevated accounts:
  ```sql
  UPDATE public.profiles SET role = 'coordinator' WHERE email = 'test-coord@cmirs.internal';
  UPDATE public.profiles SET role = 'technician' WHERE email = 'test-tech@cmirs.internal';
  UPDATE public.profiles SET role = 'administrator' WHERE email = 'test-admin@cmirs.internal';
  UPDATE public.profiles SET role = 'management' WHERE email = 'test-mgmt@cmirs.internal';
  ```
- **Audit Table Check:** `public.role_change_audit` does not have an automatic database trigger; role audit logging is managed by application services. Direct administrative promotion will execute cleanly without constraint conflicts.

---

## 4. Proposed Test Account Inventory

The five proposed test identities were verified against [`docs/ROLES.md`](file:///d:/CMIRS-System/my-app/docs/ROLES.md) and the deployed `user_role` enum:

| Email Address | Display Name (`full_name`) | Initial Trigger T4 Role | Intended Role (`user_role`) | Role Purpose in Test Matrix |
|---|---|:---:|:---:|---|
| `test-student@cmirs.internal` | Test Student Reporter | `student_personnel` | `student_personnel` | Tests report creation, photo upload, own report visibility, cancellation. |
| `test-coord@cmirs.internal` | Test Maintenance Coordinator | `student_personnel` | `coordinator` | Tests triage, technician assignment, hold states, soft deletion, repair verification. |
| `test-tech@cmirs.internal` | Test Maintenance Technician | `student_personnel` | `technician` | Tests viewing assigned reports, decline RPC, in-progress/hold states, work logging. |
| `test-admin@cmirs.internal` | Test School Administrator | `student_personnel` | `administrator` | Tests user management, role changes, facility management, full visibility. |
| `test-mgmt@cmirs.internal` | Test Campus Management | `student_personnel` | `management` | Tests read-only executive visibility, audit logs, and analytics. |

### 4.1 Existing Accounts Check
A targeted read-only query was executed against the remote database:
```sql
SELECT email FROM auth.users 
WHERE email IN (
  'test-student@cmirs.internal',
  'test-coord@cmirs.internal',
  'test-tech@cmirs.internal',
  'test-admin@cmirs.internal',
  'test-mgmt@cmirs.internal'
);
```
**Result:** **`0 rows returned`**. None of the proposed test identities exist in `auth.users` or `public.profiles`. The database is completely clean.

---

## 5. Account Creation Workflows & Credential Handling

### 5.1 Local Credential Status Check
A non-secret static check of `.env.local` was performed:
- `NEXT_PUBLIC_SUPABASE_URL`: **Present** (`https://xyirfifvcntuzceivtho.supabase.co`)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: **Present**
- `SUPABASE_SERVICE_ROLE_KEY`: **ABSENT**

Because `SUPABASE_SERVICE_ROLE_KEY` is not stored in `.env.local`, the owner has two approved options for creating the auth accounts:

### Workflow Option 1: Supabase Dashboard Authentication UI (Recommended — Zero Token Storage)
1. Owner opens the Supabase Dashboard:  
   👉 `https://supabase.com/dashboard/project/xyirfifvcntuzceivtho/auth/users`
2. For each of the five test emails:
   - Click **"Add user"** → **"Create user"**.
   - Enter email (e.g. `test-student@cmirs.internal`).
   - Enter a secure testing password.
   - Check **"Auto Confirm User"** (ensures immediate sign-in without email dispatch).
   - Click **"Create user"**.
3. Trigger T4 automatically generates all 5 profile rows in `public.profiles`.
4. Run the role-promotion query to update the 4 elevated roles.

### Workflow Option 2: Programmatic Script via Auth Admin API
1. Owner obtains `service_role` key from Supabase Dashboard (*Project Settings* → *API*).
2. Owner temporarily provides `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` or environment variable.
3. Run a local Node.js / TypeScript provisioning script (`scripts/provision-test-users.ts`) using `@supabase/supabase-js`:
   ```typescript
   await supabaseAdmin.auth.admin.createUser({
     email: 'test-student@cmirs.internal',
     password: securePassword,
     email_confirm: true,
     user_metadata: { full_name: 'Test Student Reporter' }
   });
   ```
4. Script automatically applies role promotions in `public.profiles`.
5. Remove `SUPABASE_SERVICE_ROLE_KEY` from local files upon completion.

---

## 6. Verification Queries & Expected Profile Mappings

Once the accounts are created and roles promoted, the following read-only query will verify the result:

```sql
SELECT 
  u.id AS auth_user_id,
  u.email,
  u.email_confirmed_at IS NOT NULL AS email_confirmed,
  p.full_name,
  p.role,
  p.is_active
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
WHERE u.email LIKE 'test-%@cmirs.internal'
ORDER BY p.role;
```

### Expected Output:
| `email` | `email_confirmed` | `full_name` | `role` | `is_active` |
|---|:---:|---|---|:---:|
| `test-admin@cmirs.internal` | `true` | Test School Administrator | `administrator` | `true` |
| `test-coord@cmirs.internal` | `true` | Test Maintenance Coordinator | `coordinator` | `true` |
| `test-mgmt@cmirs.internal` | `true` | Test Campus Management | `management` | `true` |
| `test-student@cmirs.internal` | `true` | Test Student Reporter | `student_personnel` | `true` |
| `test-tech@cmirs.internal` | `true` | Test Maintenance Technician | `technician` | `true` |

---

## 7. Partial Failure & Recovery Procedures

If account creation or role promotion fails partway through:
1. **Never Automatically Delete Accounts:** Retain any successfully created accounts to preserve foreign key stability.
2. **Inspect Current State:** Query `auth.users` and `public.profiles` to identify which accounts were created and which failed.
3. **Idempotent Retry:** GoTrue rejects duplicate email registration with a 422 error. The provisioning process can simply be re-run for the missing identities only.
4. **Profile Desynchronization Recovery:** If an auth user exists but its profile row is missing (e.g. if Trigger T4 failed), execute:
   ```sql
   INSERT INTO public.profiles (id, email, full_name, role)
   SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', email), 'student_personnel'::user_role
   FROM auth.users
   WHERE id NOT IN (SELECT id FROM public.profiles)
   ON CONFLICT (id) DO NOTHING;
   ```

---

## 8. Owner Authorization Checklist

Before proceeding to live account provisioning:

- [ ] **Test Identities:** Approve the five test email accounts (`test-student@cmirs.internal`, `test-coord@cmirs.internal`, `test-tech@cmirs.internal`, `test-admin@cmirs.internal`, `test-mgmt@cmirs.internal`).
- [ ] **Provisioning Method:**
  - [ ] **Option 1 (Dashboard UI):** Owner manually creates accounts via Supabase Dashboard, followed by automated role-promotion SQL.
  - [ ] **Option 2 (Admin API Script):** Owner provides service-role credentials to run a local provisioning script.
- [ ] **Password Standard:** Agree on a uniform development test password (e.g., meeting Supabase's 6+ character minimum) to use across the five test accounts.
- [ ] **Execution Authorization:** Explicit written authorization to execute test user provisioning.

---

## 9. Final Preflight Verdict

```text
================================================================================
FINAL VERDICT: READY FOR OWNER PROVISIONING APPROVAL
================================================================================
```

**Verdict Rationale:**
1. Trigger T4 mechanics have been verified: initial role assignment is strictly hardcoded to `student_personnel`, conforming to least-privilege security design D1.
2. The role promotion workflow for the four elevated roles is defined and verified against table RLS rules.
3. Zero existing test accounts or conflicts were found.
4. Credential handling rules are established (no secrets exposed or stored insecurely).
5. All strict boundaries were respected: no users or profiles were created, no remote DDL/DML was executed, and no Git mutations occurred.

---
*Preflight complete. Execution stopped. Awaiting owner review and authorization of the preferred provisioning workflow (Dashboard UI vs. Admin API script).*
