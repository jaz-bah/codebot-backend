import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { AUTH_INSTANCE } from './modules/auth/auth.module';
import { AuthInstance } from './modules/auth/better-auth.instance';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

/**
 * Bootstrap the one-process server:
 * - NestFactory.create() resolves all providers (AUTH_INSTANCE incl.) without
 *   finalizing the Express router stack — so the BetterAuth mount below is
 *   registered BEFORE Nest's 404 handler and everything stays reachable.
 * - BetterAuth's handler is mounted onto the Nest Express instance at
 *   /api/auth/** (PRD decision D4) so cookies stay same-domain.
 * - The auth instance is the SINGLE DI-provided AUTH_INSTANCE (AuthModule),
 *   never a second locally-built copy.
 * - CORS is an explicit origin allowlist with credentials (PRD FR-8).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Trust proxy headers from Vercel/Render. Required for correct protocol
  // (https) and host detection when behind a load balancer or proxy.
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );

  app.enableCors({
    origin: (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
  });

  // Mount BetterAuth BEFORE app.listen/init finalizes middleware ordering.
  const auth = app.get<AuthInstance>(AUTH_INSTANCE);
  expressInstance.use('/api/auth', toNodeHandler(auth));

  app.useGlobalFilters(new HttpExceptionFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`backend-app listening on :${port} (env: ${process.env.NODE_ENV ?? 'development'})`);
}

void bootstrap();
