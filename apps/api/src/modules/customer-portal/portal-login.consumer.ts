import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { MessageReceivedPayload } from '@spiceos/contracts';
import { EventBusService } from '../../shared/messaging/event-bus.service';
import { isWorker } from '../../shared/process-role';
import { loginCodeIn } from './portal-code';
import { PortalAuthService } from './portal-auth.service';

/** Worker: el cliente mandó por WhatsApp el código del portal → se le abre la sesión. */
@Injectable()
export class PortalLoginConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(PortalLoginConsumer.name);

  constructor(
    private readonly bus: EventBusService,
    private readonly auth: PortalAuthService,
  ) {}

  async onApplicationBootstrap() {
    if (!isWorker()) return;
    await this.bus.subscribe('portal.login', ['message.received'], async (e) => {
      const p = e.payload as unknown as MessageReceivedPayload;
      if (!loginCodeIn(p.text)) return;
      if (await this.auth.verifyFromWhatsapp(p.conversationId, p.text ?? null)) this.logger.log(`Portal: código recibido en el chat ${p.conversationId}`);
    });
  }
}
