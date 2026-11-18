// backend-app/scripts/seed-demo-user.ts
/**
 * BetterAuth Demo User Seeding Script
 *
 * This script creates the demo user directly in the BetterAuth database
 * (Kysely-based) to bypass the email verification requirement for demo purposes.
 *
 * The demo user will have:
 * - Email: demo@gmail.com
 * - Password: demo1234 (plaintext for demo - BetterAuth will hash it)
 * - Auto-generated username
 * - Verified email status (bypasses verification)
 */

import { createKyselyPool } from '../src/database/kysely/pool';
import { getAuthKysely } from '../src/database/kysely/auth-db';
import { ensureUniqueUsername } from './modules/auth/username-generator';
import { AppConfig } from '../src/config/configuration';
import * as dotenv from 'dotenv';

dotenv.config();

const config: AppConfig = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL!,
  betterAuthSecret: process.env.BETTER_AUTH_SECRET!,
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',
  corsOriginUrls: process.env.CORS_ORIGIN_URLS?.split(',') ?? [],
  oauth: {},
  adminEmails: [], // Add admin emails if needed
};

/**
 * Generates a random username similar to what BetterAuth would create
 */
function generateDemoUsername(): string {
  const adjectives = ['cool', 'awesome', 'stellar', 'brilliant', 'clever'];
  const nouns = ['coder', 'dev', 'engineer', 'programmer', 'builder'];
  const randomNum = Math.floor(Math.random() * 1000);

  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];

  return `${adj}${randomNum}${noun}`;
}

/**
 * Creates or updates the demo user in BetterAuth's user table
 */
async function createDemoUser(): Promise<void> {
  const authDb = getAuthKysely(config.databaseUrl);

  if (!authDb) {
    throw new Error('Failed to connect to auth database');
  }

  const demoEmail = 'demo@gmail.com';
  const demoPassword = 'demo1234'; // In production, this should be hashed properly
  const demoName = 'Demo User';

  // Check if demo user already exists
  const existingUser = await authDb
    .selectFrom('user')
    .selectAll()
    .where('email', '=', demoEmail)
    .executeTakeFirst();

  if (existingUser) {
    console.log(`✅ Demo user already exists with ID: ${existingUser.id}`);
    console.log(`   Email: ${existingUser.email}`);
    console.log(`   Username: ${existingUser.username}`);
    return;
  }

  // Generate a unique username
  let username = generateDemoUsername();
  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    try {
      const uniqueUsername = await ensureUniqueUsername(authDb, {
        email: demoEmail,
        name: demoName,
      });

      username = uniqueUsername || username;
      break;
    } catch (error) {
      attempt++;
      username = generateDemoUsername();
      console.log(`Username collision (attempt ${attempt}/${maxAttempts}), retrying...`);
    }
  }

  // Create the demo user
  const userId = crypto.randomUUID();
  const now = new Date();

  await authDb
    .insertInto('user')
    .values({
      id: userId,
      email: demoEmail,
      email_verified: true, // Skip email verification for demo
      password_hash: demoPassword, // BetterAuth will hash this
      name: demoName,
      username: username,
      created_at: now,
      updated_at: now,
    })
    .execute();

  console.log('✅ Demo user created successfully!');
  console.log(`   ID: ${userId}`);
  console.log(`   Email: ${demoEmail}`);
  console.log(`   Password: ${demoPassword}`);
  console.log(`   Username: ${username}`);

  // Create profile entry (optional, based on your schema)
  try {
    const profileDb = createKyselyPool(config.databaseUrl);
    await profileDb`
      INSERT INTO profile (user_id, nickname, created_at, updated_at)
      VALUES (${userId}, ${username}, ${now}, ${now})
      ON CONFLICT (user_id) DO NOTHING
    `;
    console.log(`✅ Profile created for demo user`);
  } catch (profileError) {
    console.log(`⚠️  Profile creation skipped (might not be required): ${profileError}`);
  }

  console.log('\n🎉 Demo user setup complete!');
  console.log('📝 Login credentials:');
  console.log('   Email: demo@gmail.com');
  console.log('   Password: demo1234');
  console.log('   Username: ' + username);
  console.log('\n🚀 You can now log in with these credentials!');
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    console.log('🔄 Setting up demo user...');
    console.log(`📍 Database: ${config.databaseUrl}`);
    console.log(`🌐 Environment: ${config.nodeEnv}`);
    console.log('');

    await createDemoUser();

  } catch (error) {
    console.error('❌ Error setting up demo user:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

export { createDemoUser };