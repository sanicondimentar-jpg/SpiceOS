import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { SystemPrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: SystemPrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }
}
