# Demo User Seeding Script

This directory contains scripts for setting up demo users for the Codebot application.

## Overview

The primary script here creates a demo user (`demo@gmail.com` / `demo1234`) directly in the BetterAuth database to bypass email verification for demonstration purposes.

## Scripts

### `seed-demo-user.ts`
Creates a demo user with the following credentials:
- **Email**: `demo@gmail.com`
- **Password**: `demo1234` (hashed by BetterAuth)
- **Auto-generated username**
- **Verified email status** (bypasses verification)

### `create-demo-user-sql.sql`
Creates the demo user and all demo content using raw SQL
- Creates the user directly in BetterAuth tables
- Inserts all presets, components, posts, experts, and tools
- Includes component files for multi-file components
- Adds vote counts to posts

## How to Use

### Prerequisites

1. **Install dependencies** in the backend-app directory:
   ```bash
   cd backend-app
   npm install
   ```

2. **Set up environment variables**:
   - Copy `.env.example` to `.env`
   - Fill in your actual database credentials and secrets
   - Update `DATABASE_URL` with your PostgreSQL connection string
   - Generate a secure `BETTER_AUTH_SECRET`

3. **Ensure the database is running** and accessible

### Running the Scripts

#### Method 1: Using Node.js Script
```bash
# Using ts-node (for development)
npx ts-node scripts/seed-demo-user.ts

# Or add to package.json scripts
# "seed-demo": "ts-node scripts/seed-demo-user.ts"
npm run seed-demo
```

#### Method 2: Using SQL Script
```bash
# Using psql (PostgreSQL command line client)
psql "postgresql://username:password@localhost:5432/your_database_name" -f scripts/create-demo-user-sql.sql

# Or using a GUI client like pgAdmin, DBeaver, etc.
```

## What the Scripts Do

### Node.js Script (`seed-demo-user.ts`)
1. **Connects to the BetterAuth database** (Kysely-based)
2. **Checks if demo user already exists** to avoid duplicates
3. **Generates a unique username** for the demo user
4. **Creates the user** with:
   - Verified email status (bypasses verification)
   - Auto-generated secure username
   - Proper password hashing (BetterAuth handles this)
5. **Creates a profile entry** (optional, based on your schema)

### SQL Script (`create-demo-user-sql.sql`)
1. **Creates the user directly** in BetterAuth's user table
2. **Creates a profile** for the user
3. **Inserts all demo presets** (5 items with various languages and content)
4. **Inserts all demo components** (5 items with their files)
5. **Inserts all demo posts** (5 items referencing resources)
6. **Inserts all demo experts** (5 profiles with HTML descriptions)
7. **Inserts all demo tools** (5 tools with download links)
8. **Adds vote counts** to posts (simulating user engagement)

## Important Notes

### Security Considerations

- The script stores a plaintext password in the database for demo purposes
- In a real application, passwords should always be properly hashed
- BetterAuth will hash the password during user creation
- The demo user is meant for demonstration only

### Database Requirements

- **PostgreSQL** database
- **BetterAuth tables** must exist in the database
- Proper database permissions for inserting records

### Environment Setup

- `.env` file must contain valid database credentials
- `BETTER_AUTH_SECRET` should be a secure random string
- CORS origins should include your frontend URL

## Troubleshooting

### Common Issues

1. **Database connection failed**: Check your `DATABASE_URL` in `.env`
2. **Demo user already exists**: Script checks for duplicates and skips creation
3. **Permission denied**: Ensure your database user has insert rights

### Error Messages

If you encounter errors, common solutions include:

1. **Connection issues**: Verify database is running and accessible
2. **Schema issues**: Ensure BetterAuth tables exist in your database
3. **Permission issues**: Check database user permissions

## Alternative Approaches

### Third-Party Tools

#### BetterAuth CLI (if available)
Some BetterAuth deployments include CLI tools for user management:
```bash
better-auth create-user --email demo@gmail.com --password demo1234
```

### Manual Database Setup

#### Using Database GUI
1. **Connect to your database** using pgAdmin, DBeaver, etc.
2. **Navigate to the user table** in the BetterAuth database
3. **Insert a new user record** with demo credentials
4. **Repeat for other tables** (component, preset, etc.)

### Programmatic APIs

#### Using BetterAuth API
If you have access to BetterAuth's API:
```typescript
import { betterAuth } from 'better-auth';

// Create the demo user
await betterAuth.api.createUser({
  email: 'demo@gmail.com',
  password: 'demo1234',
  name: 'Demo User',
  emailVerified: true
});
```

## Maintenance

### Updating the Demo User

To update the demo user's password or other details:

1. **Delete the existing user**: Remove from the database
2. **Re-run the seeding script**: It will create a new user
3. **Update the JSON file**: If you're also using `demo-dummy-content.json`

### Backup and Recovery

1. **Regular database backups**: Always maintain backups of your production database
2. **Demo user isolation**: Consider using a separate database for demo purposes
3. **Script version control**: Keep the seeding script in your version control system

## Support

For issues with the demo user seeding script:

1. **Check the error messages** in the console output
2. **Verify environment variables** are correctly set
3. **Check database connectivity** and permissions
4. **Review the script logic** for your specific database setup

---

*Created for demonstration purposes to help set up demo users for the Codebot application.*

© 2024 Codebot Team

## Scripts

### `seed-demo-user.ts`
Creates a demo user with the following credentials:
- **Email**: `demo@gmail.com`
- **Password**: `demo1234` (hashed by BetterAuth)
- **Auto-generated username**
- **Verified email status** (bypasses verification)

## How to Use

### Prerequisites

1. **Install dependencies** in the backend-app directory:
   ```bash
   cd backend-app
   npm install
   ```

2. **Set up environment variables**:
   - Copy `.env.example` to `.env`
   - Fill in your actual database credentials and secrets
   - Update `DATABASE_URL` with your PostgreSQL connection string
   - Generate a secure `BETTER_AUTH_SECRET`

3. **Ensure the database is running** and accessible

### Running the Script

```bash
# Using ts-node (for development)
npx ts-node scripts/seed-demo-user.ts

# Or add to package.json scripts
# "seed-demo": "ts-node scripts/seed-demo-user.ts"
npm run seed-demo
```

## What the Script Does

1. **Connects to the BetterAuth database** (Kysely-based)
2. **Checks if demo user already exists** to avoid duplicates
3. **Generates a unique username** for the demo user
4. **Creates the user** with:
   - Verified email status (bypasses verification)
   - Auto-generated secure username
   - Proper password hashing (BetterAuth handles this)
5. **Creates a profile entry** (optional, based on your schema)

## Verification

After running, you can verify the demo user was created:

```typescript
// Verification script (create in scripts/verify-demo-user.ts)
import { getAuthKysely } from './src/database/kysely/auth-db';

async function verifyDemoUser() {
  const authDb = getAuthKysely(process.env.DATABASE_URL!);
  const user = await authDb
    .selectFrom('user')
    .selectAll()
    .where('email', '=', 'demo@gmail.com')
    .executeTakeFirst();
    
  if (user) {
    console.log('✅ Demo user verified!');
    console.log('ID:', user.id);
    console.log('Username:', user.username);
    console.log('Email verified:', user.email_verified);
  } else {
    console.log('❌ Demo user not found');
  }
}

verifyDemoUser().catch(console.error);
```

## Important Notes

### Security Considerations

- The script stores a plaintext password in the database for demo purposes
- In a real application, passwords should always be properly hashed
- The demo user is meant for demonstration only

### Database Requirements

- **PostgreSQL** database with Kysely adapter
- **BetterAuth tables** must exist in the database
- Proper database permissions for inserting records

### Environment Setup

- `.env` file must contain valid database credentials
- `BETTER_AUTH_SECRET` should be a secure random string
- CORS origins should include your frontend URL

## Troubleshooting

### Common Issues

1. **Database connection failed**: Check your `DATABASE_URL` in `.env`
2. **Demo user already exists**: Script checks for duplicates and skips creation
3. **Username conflicts**: Script retries with different usernames
4. **Permission denied**: Ensure your database user has insert rights

### Error Messages

If you encounter errors, common solutions include:

1. **Connection issues**: Verify database is running and accessible
2. **Schema issues**: Ensure BetterAuth tables exist in your database
3. **Permission issues**: Check database user permissions

## Alternatives

If you prefer a simpler approach, consider:

1. **Using the JSON file**: `demo-dummy-content.json` contains demo data
2. **Running through the application**: Some applications have admin interfaces for user management
3. **Using BetterAuth CLI**: If available, there might be CLI tools for user management

## Maintenance

### Updating the Demo User

To update the demo user's password or other details:

1. **Delete the existing user**: Remove from the database
2. **Re-run the seeding script**: It will create a new user
3. **Update the JSON file**: If you're also using `demo-dummy-content.json`

### Backup and Recovery

1. **Regular database backups**: Always maintain backups of your production database
2. **Demo user isolation**: Consider using a separate database for demo purposes
3. **Script version control**: Keep the seeding script in your version control system

## Support

For issues with the demo user seeding script:

1. **Check the error messages** in the console output
2. **Verify environment variables** are correctly set
3. **Check database connectivity** and permissions
4. **Review the script logic** for your specific database setup

---

*Created for demonstration purposes to help set up demo users for the Codebot application.*

© 2024 Codebot Team