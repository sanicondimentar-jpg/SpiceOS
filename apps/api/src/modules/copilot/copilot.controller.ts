import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CopilotMessageInput, PERMISSIONS, copilotMessageSchema } from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { CopilotService } from './copilot.service';

@ApiTags('Copiloto')
@ApiBearerAuth()
@Controller('copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post('chat')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions(PERMISSIONS.copilot.use)
  chat(@Body(new ZodPipe(copilotMessageSchema)) body: CopilotMessageInput) {
    return this.copilot.chat(body);
  }

  @Get('sessions')
  @RequirePermissions(PERMISSIONS.copilot.use)
  sessions() {
    return this.copilot.sessions();
  }

  @Post('tool-calls/:id/confirm')
  @RequirePermissions(PERMISSIONS.copilot.use)
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.copilot.confirm(id);
  }
}
