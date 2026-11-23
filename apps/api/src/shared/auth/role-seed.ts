/**
 * Qué permisos le suma el seed a un rol en cada deploy, sin pisar lo que se editó a mano:
 * - el rol Dueño tiene siempre todos;
 * - un rol nuevo arranca con sus permisos por defecto;
 * - un rol existente recibe solo los permisos que aparecieron desde el último deploy (si están en sus permisos por defecto).
 *   Si alguien le sacó un permiso a mano, no vuelve.
 */
export function permissionsToGrant(i: {
  isOwner: boolean;
  isNew: boolean;
  defaults: string[];
  current: string[];
  distributed: string[];
  all: string[];
}): string[] {
  const has = new Set(i.current);
  const wanted = i.isOwner ? i.all : i.isNew ? i.defaults : i.defaults.filter((p) => !i.distributed.includes(p));
  return [...new Set(wanted)].filter((p) => !has.has(p));
}
