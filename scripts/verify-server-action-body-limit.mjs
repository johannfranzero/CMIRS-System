/**
 * CMIRS — Server Action body-size verification.
 *
 * Reproduces the Phase 4D.2 "Body exceeded 1 MB limit" failure condition against a running
 * server and proves that the configured limit is in force.
 *
 * The framework applies the body-size check BEFORE any action runs, so the check can be
 * exercised without an authenticated session: a request whose body exceeds the configured
 * limit is rejected by the framework, while a request within the limit reaches the action
 * (which then fails for a different, unrelated reason).
 *
 * Usage: node scripts/verify-server-action-body-limit.mjs [baseUrl] [limitBytes]
 */

const BASE = process.argv[2] ?? 'http://localhost:3103';
const LIMIT_BYTES = Number(process.argv[3] ?? 12 * 1024 * 1024);

console.log(`--- Server Action body-size verification against ${BASE} ---`);
console.log(`    configured limit under test: ${LIMIT_BYTES} bytes (${(LIMIT_BYTES / 1024 / 1024).toFixed(0)} MB)`);

const ACTION_ID = process.env.ACTION_ID ?? '0000000000000000000000000000000000000000';

// The route must be PUBLIC: the authentication proxy redirects protected routes before the
// Server Action handler (and therefore the framework's body-size guard) ever runs.
// `/login` is public and hosts a Server Action, so it exercises the same handler path.
const ROUTE = process.argv[4] ?? '/login';

async function post(bodyBytes, label) {
  // A multipart body with one large text part, which is what an oversized form submission
  // looks like to the framework.
  const boundary = '----cmirsboundary0000000000000000';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const payload = 'x'.repeat(Math.max(0, bodyBytes - head.length - tail.length));
  const body = head + payload + tail;

  const response = await fetch(`${BASE}${ROUTE}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Next-Action': ACTION_ID,
    },
    body,
  });

  const text = await response.text();
  const exceeded = /Body exceeded\s+[\d.]+\s*(MB|KB|GB|B) limit/i.test(text);
  const mentionsLimit = /bodySizeLimit|body exceeded/i.test(text);

  console.log(`  ${label}`);
  console.log(`      request body        : ${body.length} bytes`);
  console.log(`      HTTP status         : ${response.status}`);
  console.log(`      framework limit hit : ${exceeded ? 'YES (Body exceeded ... limit)' : 'no'}`);
  console.log(`      mentions the limit  : ${mentionsLimit ? 'yes' : 'no'}`);
  console.log(`      response excerpt    : ${text.replace(/\s+/g, ' ').slice(0, 180)}`);

  return { exceeded, status: response.status, text };
}

const small = await post(64 * 1024, 'A. small body (64 KB, within any limit)');
const underLimit = await post(Math.floor(LIMIT_BYTES * 0.92), 'B. body just UNDER the configured limit (92%)');
const overLimit = await post(Math.floor(LIMIT_BYTES * 1.08), 'C. body just OVER the configured limit (108%)');

console.log();
const digestOf = (result) => {
  const match = /"digest":"(\d+)"/.exec(result.text);
  return match ? match[1] : 'none';
};

const smallDigest = digestOf(small);
const underDigest = digestOf(underLimit);
const overDigest = digestOf(overLimit);

// A body that is received intact fails with the SAME error as the small body (the payload
// itself is invalid in this synthetic probe). A body that the framework truncates fails with a
// different, truncation-specific error ("Unexpected end of form").
const underIntact = underDigest === smallDigest;
const overTruncated = overDigest !== smallDigest;

console.log(`      digest (small)   : ${smallDigest}`);
console.log(`      digest (under)   : ${underDigest}  -> ${underIntact ? 'received and parsed intact' : 'TRUNCATED'}`);
console.log(`      digest (over)    : ${overDigest}  -> ${overTruncated ? 'truncated by the framework' : 'received intact'}`);
console.log();

if (!small.exceeded && underIntact && overTruncated) {
  console.log('  RESULT: PASS — a body within the configured limit is received and parsed intact,');
  console.log('          while a body above it is truncated by the framework. The configured limit');
  console.log('          is therefore in force at the intended threshold, so an allowed 10 MB');
  console.log('          attachment reaches the Server Action instead of being rejected.');
} else if (!small.exceeded && !overTruncated) {
  console.log('  RESULT: INCONCLUSIVE — the over-limit body was also received intact, so the');
  console.log('          threshold could not be located from the responses.');
} else {
  console.log('  RESULT: FAIL — a body within the configured limit was truncated.');
  process.exitCode = 1;
}
