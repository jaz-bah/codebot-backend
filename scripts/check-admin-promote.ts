/**
 * One-shot functional check for promoteAdminUsers (run manually, self-cleaning):
 * creates a temp VERIFIED user, promotes, asserts role, deletes rows.
 * Usage: npx ts-node scripts/check-admin-promote.ts
 */
import 'dotenv/config';
import { configuration } from '../src/config/configuration';
import { getAuthKysely } from '../src/database/kysely/auth-db';
import { promoteAdminUsers } from '../src/modules/admin/admin-promote';

async function main(): Promise<void> {
  const config = configuration();
  const db = getAuthKysely(config.databaseUrl);
  const email = 'e2e-promote-check@test.local';

  await db.deleteFrom('user').where('email', '=', email).execute();
  const [row] = await db
    .insertInto('user')
    .values({
      id: `pc_${Date.now()}`,
      name: 'Promote Check',
      email,
      emailVerified: true,
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    .returningAll()
    .execute();

  console.log('created temp user:', row.email, 'role =', row.role);

  // Test the promotion itself: pass the temp email as the admin list.
  const promoted = await promoteAdminUsers(db, [email]);
  console.log('promoted:', promoted);

  const after = await db
    .selectFrom('user')
    .select(['email', 'role'] as never)
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  console.log('after promotion, role =', after.role);

  await db.deleteFrom('session').where('userId', '=', String(row.id)).execute();
  await db.deleteFrom('account').where('userId', '=', String(row.id)).execute();
  await db.deleteFrom('user').where('email', '=', email).execute();
  console.log('temp rows cleaned');

  if (!promoted.length || after.role !== 'admin') {
    console.error('CHECK FAILED');
    process.exit(1);
  }
  console.log('CHECK PASSED — promoteAdminUsers works');
  process.exit(0);
}

void main().catch((e) => {
  console.error('check crashed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
