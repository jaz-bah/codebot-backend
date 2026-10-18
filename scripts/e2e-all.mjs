/**
 * Runs all phase e2e scripts against a running server and reports a total.
 * Requires: server booted (npm start or start:dev) + .mail-capture.jsonl dev mode.
 * Usage: npm run e2e   (or node scripts/e2e-all.mjs [--skip oauth]  — no args needed)
 */
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const phases = [
  ['phase 1 — email/password + verification', 'e2e-phase1.mjs'],
  ['phase 2 — OAuth wiring (google/github)', 'e2e-phase2.mjs'],
  ['phase 3 — reset + guards + rate limit', 'e2e-phase3.mjs'],
  ['phase 4 — negative/edge contract', 'e2e-edge.mjs'],
];

const results = [];
// The auth rate limiter (3/10 s per IP+path) shares its budget across phases
// — a cooldown lets every phase start with a fresh bucket.
const COOLDOWN_MS = Number(process.env.E2E_COOLDOWN_MS ?? 12000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [label, file] of phases) {
  console.log(`\n===== ${label} (${file}) =====`);
  if (results.length) {
    console.log(`(rate-limit cooldown ${COOLDOWN_MS}ms)`);
    await sleep(COOLDOWN_MS);
  }
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, file)], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (c) => resolve(c ?? 1));
  });
  results.push([label, code === 0]);
  if (code !== 0) break; // stop at first failure
}

console.log('\n===== TOTAL =====');
let failed = 0;
for (const [label, ok] of results) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? 'ALL PHASES PASS' : `${failed} PHASE(S) FAILED`);
process.exit(failed ? 1 : 0);
