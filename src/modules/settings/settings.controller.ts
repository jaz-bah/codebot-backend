import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedGuard } from '../../common/guards/authenticated.guard';
import { JoiValidationPipe } from '../../common/pipes/joi-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { updateSettingsSchema, UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService, SettingsView } from './settings.service';

/**
 * Per-user settings surface (singleton row). Guard chain: BetterAuthSessionGuard
 * (global) attaches authUser → AuthenticatedGuard rejects anonymous calls.
 * Secrets are accepted over TLS only ONCE (encrypted at rest immediately) and
 * are never returned — GET responses carry masked previews.
 */
@Controller('settings')
@UseGuards(AuthenticatedGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser): Promise<SettingsView> {
    return this.settings.getSettingsView(user.id);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(updateSettingsSchema)) dto: UpdateSettingsDto,
  ): Promise<SettingsView> {
    return this.settings.update(user.id, dto ?? ({} as UpdateSettingsDto));
  }

  @Delete()
  reset(@CurrentUser() user: AuthenticatedUser): Promise<{ reset: boolean }> {
    return this.settings.reset(user.id);
  }
}
