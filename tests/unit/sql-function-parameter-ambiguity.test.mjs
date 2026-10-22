/**
 * CMIRS — Phase 4D.2 SQL Function Parameter Ambiguity Detector
 *
 * Background
 * ----------
 * PostgreSQL error code 42702 (`ambiguous_column`) is raised by PL/pgSQL when a name inside a
 * function body can denote either a PL/pgSQL variable (parameter) or a column of a table that
 * is in scope in the same SQL statement. PL/pgSQL's default `variable_conflict = error`
 * turns that into a hard error at parse time, so the function raises for every caller.
 *
 * Live remote evidence (captured in `.next/dev/logs/next-development.log`):
 *   [DAL] getReportsQueue query error: "column reference \"report_id\" is ambiguous"
 *   | code= "42702" | status= "unknown"
 *
 * The defect was in `public.can_view_report(report_id UUID)`
 * (`supabase/migrations/20261018000004_security_functions_and_rpc.sql`), whose technician
 * branch contained:
 *
 *   WHERE a.report_id = report_id
 *
 * `public.assignments` owns a `report_id` column and the function parameter is also named
 * `report_id`, so the right-hand side was ambiguous. The reporter branch
 * (`r.id = report_id` over `public.reports`) was NOT ambiguous because `public.reports`
 * has no `report_id` column.
 *
 * This test detects the defect class statically, at *statement scope* (a bare reference is
 * only ambiguous when a table with a colliding column is in scope in the same statement),
 * and it resolves the *effective* definition of each function across the migration set —
 * the last definition in filename order wins, exactly as `CREATE OR REPLACE` would behave
 * when the migrations are applied in order.
 *
 * Migration 008 (prepared, NOT applied) supersedes the migration-004 definition.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../..');
const migrationsDir = path.join(appRoot, 'supabase', 'migrations');

const REPAIR_MIGRATION = '20261021000008_fix_can_view_report_parameter_ambiguity.sql';
const ORIGINAL_MIGRATION = '20261018000004_security_functions_and_rpc.sql';

// ---------------------------------------------------------------------------
// Schema introspection (column names per table)
// ---------------------------------------------------------------------------

function readSchemaColumns() {
  const schema = readFileSync(path.join(migrationsDir, '20261018000001_core_schema.sql'), 'utf8');
  const columnsByTable = new Map();
  const tablePattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi;

  let match;
  while ((match = tablePattern.exec(schema)) !== null) {
    const columns = new Set();
    for (const rawLine of match[2].split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('--')) continue;
      if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/i.test(line)) continue;
      const columnMatch = /^(\w+)\s+[A-Za-z]/.exec(line);
      if (columnMatch) columns.add(columnMatch[1].toLowerCase());
    }
    columnsByTable.set(match[1].toLowerCase(), columns);
  }

  return columnsByTable;
}

const schemaColumns = readSchemaColumns();

// ---------------------------------------------------------------------------
// Function extraction
// ---------------------------------------------------------------------------

const PARAM_TYPES = 'UUID|TEXT|BOOLEAN|INTEGER|user_role|assignment_status|report_status|priority_level|jsonb|timestamptz';

function readFunctions() {
  const definitions = [];

  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    const pattern = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?(\\w+)\\s*\\(([\\s\\S]*?)\\)\\s*` +
        `RETURNS[\\s\\S]*?AS\\s+\\$([A-Za-z_]*)\\$([\\s\\S]*?)\\$\\3\\$`,
      'gi'
    );

    let match;
    while ((match = pattern.exec(sql)) !== null) {
      const [, name, rawParams, , body] = match;
      const parameters = [...rawParams.matchAll(new RegExp(`(\\w+)\\s+(?:${PARAM_TYPES})`, 'gi'))].map(
        (m) => m[1].toLowerCase()
      );

      definitions.push({
        file,
        name: name.toLowerCase(),
        parameters,
        body,
        // Attributes that must survive the repair.
        securityDefiner: /SECURITY\s+DEFINER/i.test(sql.slice(match.index, match.index + 400)),
        volatile: /\bVOLATILE\b/i.test(sql.slice(match.index, match.index + 400)),
        stable: /\bSTABLE\b/i.test(sql.slice(match.index, match.index + 400)),
        searchPath: /SET\s+search_path\s*=\s*([^\n;]+)/i.exec(sql.slice(match.index, match.index + 600))?.[1]?.trim() ?? null,
        sql,
      });
    }
  }

  return definitions;
}

const definitions = readFunctions();

/** Removes SQL line comments and block comments so only executable SQL is analysed. */
function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/** The effective definition of a function = the last one in migration filename order. */
function effectiveDefinition(name) {
  const matches = definitions.filter((d) => d.name === name);
  return matches.length ? matches[matches.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Statement-scoped ambiguity detection
// ---------------------------------------------------------------------------

/**
 * Returns the parameters of a function that are ambiguous inside its body.
 *
 * A parameter P is ambiguous when P is referenced as a bare identifier inside a SQL
 * statement in which a table having a column named P is in scope.
 */
export function findAmbiguousParameters(fn, columnsByTable = schemaColumns) {
  const ambiguous = [];
  const body = fn.body;

  for (const parameter of fn.parameters) {
    const barePattern = new RegExp(`(?<![\\w.])${parameter}\\b`, 'gi');
    let reference;

    while ((reference = barePattern.exec(body)) !== null) {
      const refIndex = reference.index;

      // Nearest preceding FROM/JOIN inside the same statement.
      const fromMatches = [...body.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)/gi)]
        .filter((m) => m.index < refIndex)
        .sort((a, b) => b.index - a.index);
      const fromMatch = fromMatches[0];
      if (!fromMatch) continue;

      // The FROM must belong to the same statement as the reference.
      const lastSemicolon = body.lastIndexOf(';', fromMatch.index);
      const statementStart = lastSemicolon === -1 ? 0 : lastSemicolon + 1;
      if (statementStart > fromMatch.index) continue;

      // Tables in scope for this statement.
      const scope = body.slice(statementStart, refIndex);
      const tableNames = new Set();
      for (const m of scope.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)/gi)) {
        tableNames.add(m[1].split('.').pop().toLowerCase());
      }

      const collision = [...tableNames].find((table) => columnsByTable.get(table)?.has(parameter));
      if (collision) {
        ambiguous.push({
          parameter,
          columnOwner: collision,
          excerpt: body
            .slice(Math.max(0, refIndex - 90), Math.min(body.length, refIndex + 40))
            .replace(/\s+/g, ' ')
            .trim(),
        });
        break;
      }
    }
  }

  return ambiguous;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('Phase 4D.2: the detector identifies a bare parameter reference in a colliding scope', () => {
  // Self-test: the exact shape of the original defect.
  const defective = {
    name: 'synthetic_defective',
    parameters: ['report_id'],
    body: `BEGIN
  IF EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.report_id = report_id
      AND a.technician_id = auth.uid()
  ) THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;`,
  };

  const detected = findAmbiguousParameters(defective);
  assert.equal(detected.length, 1);
  assert.equal(detected[0].parameter, 'report_id');
  assert.equal(detected[0].columnOwner, 'assignments');

  // A parameter referenced against a table that does NOT own a colliding column is fine.
  const safe = {
    name: 'synthetic_safe',
    parameters: ['report_id'],
    body: `BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id = report_id
      AND r.reporter_id = auth.uid()
  ) THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;`,
  };
  assert.deepEqual(findAmbiguousParameters(safe), []);

  // A parameter aliased into a collision-free local is fine.
  const aliased = {
    name: 'synthetic_aliased',
    parameters: ['report_id'],
    body: `BEGIN
  target_report_id := report_id;
  IF EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.report_id = target_report_id
  ) THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;`,
  };
  assert.deepEqual(findAmbiguousParameters(aliased), []);
});

test('Phase 4D.2: the effective definition of every function is free of parameter ambiguity', () => {
  const names = [...new Set(definitions.map((d) => d.name))];
  const offenders = [];

  for (const name of names) {
    const effective = effectiveDefinition(name);
    const ambiguous = findAmbiguousParameters(effective);
    if (ambiguous.length > 0) {
      offenders.push({ name, file: effective.file, ambiguous });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Effective function definitions still contain ambiguous parameter references: ${JSON.stringify(offenders, null, 2)}`
  );
});

test('Phase 4D.2: the repair migration supersedes the original can_view_report definition', () => {
  const original = definitions.find(
    (d) => d.file === ORIGINAL_MIGRATION && d.name === 'can_view_report'
  );
  assert.ok(original, 'The original definition must exist in migration 004');

  const repaired = definitions.find(
    (d) => d.file === REPAIR_MIGRATION && d.name === 'can_view_report'
  );
  assert.ok(repaired, 'The repair migration must redefine can_view_report');

  // The historical definition is still ambiguous (it is immutable history).
  assert.equal(
    findAmbiguousParameters(original).length,
    1,
    'The original migration-004 definition should still exhibit the documented defect'
  );

  // The effective (latest) definition is not.
  const effective = effectiveDefinition('can_view_report');
  assert.equal(effective.file, REPAIR_MIGRATION, 'The repair migration must be the effective definition');
  assert.deepEqual(findAmbiguousParameters(effective), []);
});

test('Phase 4D.2: the repair preserves the approved authorization behaviour exactly', () => {
  const effective = effectiveDefinition('can_view_report');
  const body = effective.body;

  // 1. Oversight roles see all reports.
  assert.match(
    body,
    /caller_role\s+IN\s*\(\s*'coordinator'\s*,\s*'administrator'\s*,\s*'management'\s*\)/i,
    'The oversight-role branch must be preserved'
  );

  // 2. Reporters see their own report regardless of current role.
  assert.match(
    body,
    /FROM\s+public\.reports\s+r\s+WHERE\s+r\.id\s*=\s*\w+\s+AND\s+r\.reporter_id\s*=\s*auth\.uid\(\)/i,
    'The reporter-ownership branch must be preserved'
  );

  // 3. Technicians see reports with a qualifying assignment (any status except declined).
  assert.match(
    body,
    /caller_role\s*=\s*'technician'\s+AND\s+EXISTS/i,
    'The technician branch must be preserved'
  );
  assert.match(
    body,
    /FROM\s+public\.assignments\s+a\s+WHERE\s+a\.report_id\s*=\s*\w+\s+AND\s+a\.technician_id\s*=\s*auth\.uid\(\)\s+AND\s+a\.status\s*!=\s*'declined'/i,
    'The technician qualification predicate must be preserved'
  );

  // No additional visibility branch may be introduced.
  // (Each branch is counted through its `END IF;` terminator, which is unambiguous.)
  assert.equal(
    (body.match(/\bEND\s+IF\s*;/gi) ?? []).length,
    3,
    'Exactly the three approved authorization branches may exist'
  );
  assert.equal(
    (body.match(/RETURN TRUE/gi) ?? []).length,
    3,
    'Exactly the three approved TRUE returns may exist'
  );
  assert.equal(
    (body.match(/RETURN FALSE/gi) ?? []).length,
    1,
    'Exactly the single default FALSE return may exist'
  );

  // Security attributes are preserved.
  assert.equal(effective.securityDefiner, true, 'SECURITY DEFINER must be preserved');
  assert.equal(effective.stable, true, 'STABLE must be preserved');
  assert.equal(effective.volatile, false, 'VOLATILE must not be introduced');
  assert.match(
    effective.searchPath ?? '',
    /public,\s*auth,\s*pg_temp/i,
    'The fixed search_path must be preserved'
  );

  // The signature (and therefore every existing call site) is unchanged.
  assert.deepEqual(effective.parameters, ['report_id'], 'The input parameter name must be unchanged');

  // The privilege statements are preserved verbatim.
  const repairSql = readFileSync(path.join(migrationsDir, REPAIR_MIGRATION), 'utf8');
  assert.match(
    repairSql,
    /REVOKE ALL ON FUNCTION public\.can_view_report\(UUID\) FROM PUBLIC;/i,
    'The REVOKE statement must be preserved'
  );
  assert.match(
    repairSql,
    /GRANT EXECUTE ON FUNCTION public\.can_view_report\(UUID\) TO authenticated;/i,
    'The GRANT statement must be preserved'
  );
});

test('Phase 4D.2: the repair migration is structurally valid PL/pgSQL', () => {
  const repairSql = readFileSync(path.join(migrationsDir, REPAIR_MIGRATION), 'utf8');
  const executableSql = stripSqlComments(repairSql);

  // The dollar-quoted body must be balanced.
  const delimiters = [...executableSql.matchAll(/\$([A-Za-z_]*)\$/g)].map((m) => m[1]);
  assert.equal(delimiters.length % 2, 0, 'The dollar-quoted body delimiters must be balanced');
  for (let i = 0; i < delimiters.length; i += 2) {
    assert.equal(
      delimiters[i],
      delimiters[i + 1],
      'The opening and closing dollar-quote tags must match'
    );
  }

  const body = /\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$/.exec(executableSql);
  assert.ok(body, 'The function body must be dollar-quoted');
  const functionBody = body[2];

  // `#variable_conflict` must be the first directive in the body.
  const firstToken = /^\s*#\w+(?:\s+\w+)?/.exec(functionBody);
  assert.ok(firstToken, 'The function body must start with a PL/pgSQL compiler directive');
  assert.equal(
    firstToken[0].trim(),
    '#variable_conflict use_variable',
    'The first directive must be #variable_conflict use_variable'
  );

  // The block structure must balance.
  const beginCount = (functionBody.match(/\bBEGIN\b/gi) ?? []).length;
  const endCount = (functionBody.match(/\bEND\s*;/gi) ?? []).length;
  assert.equal(beginCount, 1, 'Exactly one BEGIN block');
  assert.equal(endCount, 1, 'Exactly one END; terminator for the outer block');
  assert.match(functionBody, /DECLARE\s+[\s\S]*?\bBEGIN\b/i, 'The DECLARE block must precede BEGIN');

  // The local variable must be declared before use.
  assert.match(
    functionBody,
    /DECLARE\s+[\s\S]*?target_report_id\s+UUID\s*;/i,
    'The collision-free local must be declared'
  );
});

test('Phase 4D.2: the repair migration is additive and touches no table, policy, role, or data', () => {
  const repairSql = readFileSync(path.join(migrationsDir, REPAIR_MIGRATION), 'utf8');
  // Only executable SQL is analysed; the migration's own documentation mentions constructs it
  // deliberately does not execute (for example DROP FUNCTION).
  const executableSql = stripSqlComments(repairSql);

  const forbidden = [
    [/\bCREATE\s+POLICY\b/i, 'CREATE POLICY'],
    [/\bDROP\s+POLICY\b/i, 'DROP POLICY'],
    [/\bALTER\s+POLICY\b/i, 'ALTER POLICY'],
    [/\bCREATE\s+TABLE\b/i, 'CREATE TABLE'],
    [/\bALTER\s+TABLE\b/i, 'ALTER TABLE'],
    [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
    [/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i, 'CREATE INDEX'],
    [/\bCREATE\s+TRIGGER\b/i, 'CREATE TRIGGER'],
    [/\bDROP\s+TRIGGER\b/i, 'DROP TRIGGER'],
    [/\bINSERT\s+INTO\b/i, 'INSERT INTO'],
    [/\bUPDATE\s+public\./i, 'UPDATE'],
    [/\bDELETE\s+FROM\b/i, 'DELETE FROM'],
    [/\bTRUNCATE\b/i, 'TRUNCATE'],
    [/\bGRANT\s+ALL\b/i, 'GRANT ALL'],
    [/\bDROP\s+FUNCTION\b/i, 'DROP FUNCTION'],
  ];

  for (const [pattern, label] of forbidden) {
    assert.ok(
      !pattern.test(executableSql),
      `The repair migration must not contain ${label}. It may only replace the function body.`
    );
  }

  // The only schema object it defines is the function itself.
  const created = [...executableSql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(\w+)/gi)].map(
    (m) => m[1].toLowerCase()
  );
  assert.deepEqual(created, ['can_view_report']);
});

test('Phase 4D.2: every RLS call site of can_view_report remains valid', () => {
  const callSites = [];

  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))) {
    const sql = stripSqlComments(readFileSync(path.join(migrationsDir, file), 'utf8'));
    for (const m of sql.matchAll(/public\.can_view_report\(([^)]*)\)/g)) {
      callSites.push({ file, argument: m[1].trim() });
    }
  }

  assert.ok(callSites.length > 0, 'The function must still be referenced by policies');

  // Every call site passes exactly one argument, so the (UUID) signature is preserved.
  for (const site of callSites) {
    assert.ok(
      site.argument.length > 0 && !site.argument.includes(','),
      `Call site public.can_view_report(${site.argument}) in ${site.file} must take exactly one argument`
    );
  }

  // The policies that depend on it are untouched by the repair.
  const repairSql = stripSqlComments(readFileSync(path.join(migrationsDir, REPAIR_MIGRATION), 'utf8'));
  assert.ok(
    !/can_view_report\s*\(\s*\)/i.test(repairSql),
    'The repair migration must not introduce an argument-less call site'
  );
  assert.ok(
    !/\b(?:CREATE|DROP|ALTER)\s+POLICY\b/i.test(repairSql),
    'The repair migration must not touch any policy'
  );
});
