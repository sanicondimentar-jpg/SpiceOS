import { SetMetadata } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import type { PermissionKey } from '@spiceos/contracts';

export const AI_TOOL_KEY = 'spiceos:ai-tool';

export type AgentName =
  | 'commercial'
  | 'pricing'
  | 'purchasing'
  | 'inventory'
  | 'collections'
  | 'executive'
  | 'documents';

export interface AiToolOptions {
  /** Nombre único "<modulo>_<accion>" (el API exige ^[a-zA-Z0-9_-]{1,64}$). */
  name: string;
  /** Qué hace y cuándo usarla: el modelo elige la tool leyendo esto. */
  description: string;
  input: ZodTypeAny;
  permissions: PermissionKey[];
  /** Escribe datos: queda auditada como acción del agente y puede requerir confirmación. */
  write?: boolean;
  /** Escrituras que el usuario debe confirmar antes de ejecutarse (cotización enviada, mensaje a cliente). */
  requiresConfirmation?: boolean;
  /** Agentes que la tienen disponible; vacío = todos. */
  agents?: AgentName[];
}

/**
 * Expone un método de un servicio como tool del copiloto.
 * Toda funcionalidad del sistema es asistible por IA a través de estas tools,
 * que llaman a los mismos casos de uso que la API REST.
 */
export const AiTool = (options: AiToolOptions) => SetMetadata(AI_TOOL_KEY, options);
