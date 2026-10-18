import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(@Res() res: Response): Promise<void> {
    const status = await this.healthService.check();
    if (!status.ok) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ status: 'error', db: status.db });
      return;
    }
    res.status(HttpStatus.OK).json({ status: 'ok', db: status.db });
  }
}
