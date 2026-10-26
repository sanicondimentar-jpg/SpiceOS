import { SetMetadata, createParamDecorator } from '@nestjs/common';
import type { PermissionKey } from '@spiceos/contracts';
import { RequestContextStore, RequestContext } from '../tenancy/request-context';

export const PERMISSIONS_KEY = 'spiceos:permissions';
export const PUBLIC_KEY = 'spiceos:public';

/** El usuario necesita TODOS los permisos listados. */
export const RequirePermissions = (...permissions: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Endpoint sin autenticación de usuario (webhooks con su propia firma, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const Ctx = createParamDecorator((): RequestContext => RequestContextStore.get());
