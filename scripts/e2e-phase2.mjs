/**
 * Phase 2 scripted HTTP E2E — OAuth wiring for Google & GitHub.
 *
 * Automatable surface (without a real browser + provider login):
 *  1. unconfigured provider → safe 400
 *  2. configured provider → /api/auth/sign-in/social redirects 302 to the
 *     real provider authorize endpoint and sets the BetterAuth state cookie
 *  3. session shape unchanged: get-session without cookie → null
 *
 * The full callback flow (provider login → user/account rows) requires a
 * real browser session — flagged as MANUAL items in Brain/TASKS.md.
 */
import 'dotenv/config';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — PHASE 2 E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — PHASE 2 E2E ✓ (OAuth wiring verified)`,
  );
  process.exit(fails.length ? 1 : 0);
}

async function main() {
  const step = async (name, fn) => {
    try {
      const value = await fn();
      results.push([name, 'PASS', value ?? '']);
      console.log(`[PASS] ${name}${value ? ' — ' + value : ''}`);
    } catch (e) {
      results.push([name, 'FAIL', e.message]);
      console.error(`[FAIL] ${name} — ${e.message}`);
      printSummary();
    }
  };

  await step('get-session without cookie → null (baseline unchanged)', async () => {
    const res = await fetch(`${BASE}/api/auth/get-session`);
    const body = await res.json();
    if (res.status !== 200 || body !== null) {
      throw new Error(`expected 200/null, got ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
    }
    return 'email/password session contract intact';
  });

  await step('unknown provider → safe 4xx', async () => {
    const res = await fetch(`${BASE}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ provider: 'notarealprovider' }),
    });
    if (res.status < 400 || res.status >= 500) throw new Error(`expected 4xx, got ${res.status}`);
    return `status ${res.status} (provider rejected safely)`;
  });

  const socialRedirect = async (provider, targetPrefix) => {
    const res = await fetch(`${BASE}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ provider, callbackURL: `${ORIGIN}/` }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.headers.get('location') || !(body['url'] && body['redirect'] === true)) {
      throw new Error(`expected Location+url JSON, got ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    }
    const location = String(res.headers.get('location'));
    if (!location.startsWith(targetPrefix)) {
      throw new Error(`unexpected redirect target: ${location.slice(0, 120)}`);
    }
    const stateCookie = (res.headers.getSetCookie?.() ?? []).join('|');
    if (!stateCookie.includes('better-auth.state')) throw new Error('no better-auth state cookie set');
    return `state cookie set; authorize URL issued → ${location.slice(0, 60)}…`;
  };

  await step('google → authorize redirect + state cookie', () =>
    socialRedirect('google', 'https://accounts.google.com/o/oauth2/'));
  await step('github → authorize redirect + state cookie', () =>
    socialRedirect('github', 'https://github.com/login/oauth/authorize'));

  printSummary();
}

void main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
