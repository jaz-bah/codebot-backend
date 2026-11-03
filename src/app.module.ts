import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { configuration } from './config/configuration';
import { APP_CONFIG } from './config/app-config.token';
import { AppConfig } from './config/configuration';
import { AppConfigModule } from './config/app-config.module';
import { envValidationSchema } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
import { TodosModule } from './modules/todos/todos.module';
import { NotesModule } from './modules/notes/notes.module';
import { ExpertsModule } from './modules/experts/experts.module';
import { ToolsModule } from './modules/tools/tools.module';
import { IdeSnippetsModule } from './modules/ide-snippets/ide-snippets.module';
import { PresetsModule } from './modules/presets/presets.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ComponentsModule } from './modules/components/components.module';
import { SearchModule } from './modules/search/search.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ChatModule } from './modules/chat/chat.module';
import { PostsModule } from './modules/posts/posts.module';
import { BetterAuthSessionGuard } from './common/guards/better-auth-session.guard';
import { AdminGuard } from './common/guards/admin.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    // Nest-owned routes rate limiting (auth endpoints are covered by
    // BetterAuth's own rateLimit — see better-auth.instance.ts).
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (appConfig: AppConfig) => [
        { ttl: appConfig.throttle.ttlMs, limit: appConfig.throttle.limit },
      ],
    }),
    AppConfigModule,
    MailModule,
    AuthModule,
    AdminModule,
    HealthModule,
    TodosModule,
    NotesModule,
    ExpertsModule,
    ToolsModule,
    IdeSnippetsModule,
    PresetsModule,
    SettingsModule,
    UploadsModule,
    DocumentsModule,
    ComponentsModule,
    SearchModule,
    ProfileModule,
    ChatModule,
    PostsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: BetterAuthSessionGuard },
    // AdminGuard is per-controller (needs Reflector + AuditService + @Roles)
  ],
})
export class AppModule {}
