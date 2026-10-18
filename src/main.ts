import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { AUTH_INSTANCE } from './modules/auth/auth.module';
import { AuthInstance } from './modules/auth/better-auth.instance';

/**
 * Bootstrap the one-process server:
 * - BetterAuth's handler is mounted onto the Nest Express instance at
 *   /api/auth/** (PRD decision D4) so cookies stay same-domain.
 * - The auth instance is the SINGLE DI-provided AUTH_INSTANCE (AuthModule),
 *   never a second locally-built copy.
 * - CORS is an explicit origin allowlist with credentials (PRD FR-8).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  app.enableCors({
    origin: (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
  });

  // Boot the DI container so AppConfig/AuthModule resolve (env is validated here).
  await app.init();

  // Mount BetterAuth on the same Express instance used by Nest.
  const auth = app.get<AuthInstance>(AUTH_INSTANCE);
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance.use('/api/auth', toNodeHandler(auth));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`backend-app listening on :${port} (env: ${process.env.NODE_ENV ?? 'development'})`);
}

void bootstrap();
