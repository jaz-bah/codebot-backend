# Codebot SaaS Backend

Codebot SaaS backend - NestJS authentication system (BetterAuth + Neon Postgres + TypeORM)

## Overview

This is the backend service for the Codebot SaaS application, providing:

- **BetterAuth authentication** with email verification, social login, and session management
- **TypeORM ORM** for database interactions with PostgreSQL
- **NestJS framework** for building scalable server-side applications
- **Full CRUD APIs** for all domain resources (presets, components, posts, experts, tools, etc.)
- **Real-time content management** with ownership and permission controls
- **PostgreSQL database** for persistent data storage

## Features

### Authentication & Security
- **BetterAuth** with PostgreSQL adapter via Kysely
- **Email verification** required for new accounts
- **Social login** (Google, GitHub, etc.) support
- **Session management** with 7-day sliding expiry
- **Role-based access control** (admin users)
- **Rate limiting** to prevent abuse
- **Password reset** and account recovery

### Database Architecture
- **TypeORM** for TypeScript ORM operations
- **Kysely** for BetterAuth's PostgreSQL adapter
- **Neon Postgres** for cloud database hosting
- **Connection pooling** for performance
- **Database migrations** for schema changes

### API Endpoints
- **User management** (/auth/**)
- **Preset management** (/presets/**)
- **Component management** (/components/**)
- **Post management** (/posts/**)
- **Expert management** (/experts/**)
- **Tool management** (/tools/**)
- **Search and filtering** across all resources
- **Vote/upvote system** for posts and content

### Domain Models
- **Preset**: Code snippets with language and metadata
- **Component**: Reusable UI components with file structure
- **Post**: Public posts linking to other resources
- **Expert**: Professional profiles and insights
- **Tool**: Development tools and utilities

## Setup Instructions

### Prerequisites

1. **Node.js 18+** (for TypeScript)
2. **PostgreSQL database** (Neon, local, or cloud)
3. **Environment variables** (see .env.example)
4. **BetterAuth secret** (generate a secure random string)

### Installation

```bash
cd backend-app
npm install
```

### Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
# Edit .env with your database credentials and secrets
```

Required environment variables:

- `DATABASE_URL`: PostgreSQL connection string
- `BETTER_AUTH_SECRET`: BetterAuth secret key
- `FRONTEND_URL`: Frontend application URL
- `CORS_ORIGIN_URLS`: Allowed origins for CORS
- `ADMIN_EMAILS`: Emails to be promoted to admin role

### Database Initialization

```bash
# Initialize database (creates BetterAuth tables)
npm run init:db

# Run migrations (if any)
npm run migration:run

# Seed demo data (optional)
# npm run seed-demo  # Requires seed-demo-user.ts script
```

### Running the Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm start
```

## API Documentation

### Authentication Endpoints
- `POST /api/auth/sign-in/email` - Email sign-in
- `POST /api/auth/sign-up/email` - Email sign-up
- `GET /api/auth/sign-in/social/start` - Social login start
- `GET /api/auth/**` - BetterAuth endpoints

### Resource Endpoints
- `GET/POST/PUT/DELETE /presets/**` - Preset management
- `GET/POST/PUT/DELETE /components/**` - Component management

## Deployment

### Production Deployment

1. **Build the application**:
   ```bash
   npm run build
   ```

2. **Deploy to production server**:
   ```bash
   # Transfer dist/ to production server
   # Set up environment variables
   # Run migrations if needed
   npm start
   ```

3. **Environment configuration**:
   - Use production database URL
   - Configure CORS origins appropriately
   - Set up proper logging
   - Configure monitoring and alerts

### Docker Deployment

Dockerfile is available for containerized deployment.

## Development

### Scripts

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start development server with auto-restart |
| `npm run db:ping` | Test database connection |
| `npm run migration:run` | Apply database migrations |
| `npm run migration:gen` | Generate new migration |
| `npm run auth:schema` | Initialize BetterAuth database schema |

### Database Migration

To create a new migration:

```bash
npm run migration:gen --name "migration-description"
```

To apply migrations:

```bash
npm run migration:run
```

### Testing

Run tests to ensure application functionality:

```bash
npm test
```

### E2E Testing

Run end-to-end tests:

```bash
npm run e2e
```

## Architecture

### Backend Architecture

```
NestJS Application
├── Auth Module (BetterAuth integration)
├── Presets Module
├── Components Module
├── Posts Module
├── Experts Module
├── Tools Module
├── Common (Guards, Pipes, Filters)
└── Database (TypeORM + Kysely)
```

### Database Schema

```
PostgreSQL
├── user (BetterAuth auth)
├── profile (user profiles)
├── preset (code snippets)
├── component (UI components)
├── component_file (component files)
├── post (resource posts)
├── expert (professional profiles)
├── tool (development tools)
└── ... other tables
```

## Security

### Authentication
- **BetterAuth** for secure authentication
- **Password hashing** with bcrypt
- **Email verification** required
- **Session management** with secure cookies
- **Rate limiting** to prevent abuse

### Authorization
- **Role-based access control** (admin users)
- **Resource ownership** checks
- **API key management** (if applicable)
- **Input validation** and sanitization

### Data Protection
- **PostgreSQL encryption** for sensitive data
- **Secure password storage**
- **HTTPS enforcement** in production
- **CORS configuration** for API security

## Monitoring & Logging

### Logging
- **Structured logging** with log levels (error, warn, info, debug)
- **Performance monitoring** for API endpoints
- **Error tracking** with stack traces
- **Audit logging** for security events

### Metrics
- **Application health checks**
- **Database connection monitoring**
- **API response times**
- **Error rate tracking**

## Code Quality

### TypeScript
- **Type safety** with comprehensive type definitions
- **ESLint** for code linting
- **Prettier** for code formatting
- **Type restrictions** for API contracts

### Testing
- **Unit tests** for individual functions
- **Integration tests** for API endpoints
- **E2E tests** for end-to-end scenarios
- **Test coverage** requirements

## Troubleshooting

### Common Issues

#### Database Connection Issues

**Problem**: Cannot connect to the database.

**Solution**:
1. Verify `DATABASE_URL` in `.env`
2. Check database server is running
3. Ensure network connectivity
4. Verify database user permissions

#### Authentication Issues

**Problem**: Cannot sign in or sign up.

**Solution**:
1. Check email verification status
2. Verify password is correct
3. Ensure BetterAuth tables are initialized
4. Check environment variables

#### Migration Issues

**Problem**: Migration fails to apply.

**Solution**:
1. Check migration syntax
2. Verify database schema
3. Ensure proper permissions
4. Review error messages in logs

### Support

For issues:

1. **Check logs** for error details
2. **Verify environment variables** are correctly set
3. **Check database connectivity** and permissions
4. **Review application configuration**

## Contributing

### Code Standards

1. **Follow TypeScript best practices**
2. **Write comprehensive tests**
3. **Document APIs and functions**
4. **Use proper error handling**
5. **Follow code linting rules**

### Pull Requests

1. **Create feature branches**
2. **Write descriptive commit messages**
3. **Add tests for new functionality**
4. **Update documentation**
5. **Ensure all tests pass**

## License

This project is licensed under the ISC License.

## Acknowledgements

- **NestJS** for the framework
- **BetterAuth** for authentication
- **TypeORM** for ORM operations
- **Kysely** for database adapter
- **PostgreSQL** for database
- **Claude Code** for AI assistance

## Contact

For questions or issues:
- **GitHub Issues**: Submit issues on the repository
- **Documentation**: Check the project documentation
- **Support**: Contact the development team

---

**Codebot Backend** - Building scalable SaaS applications with modern technologies.