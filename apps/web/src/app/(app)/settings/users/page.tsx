'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { RoleView, StaffUserView } from '@spiceos/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/hooks';
import {
  useCreateRole,
  useDeleteRole,
  usePermissionCatalog,
  useRoles,
  useStaffUsers,
  useUpdateRole,
  useUpdateStaffUser,
  type PermissionGroup,
} from '@/lib/staff';

/** Quién usa el sistema, con qué rol y su celular; y qué puede hacer cada rol (lo que ve en el menú sale de acá). */
export default function UsersPage() {
  const { data: me } = useMe();
  if (me && !me.permissions.includes('core.user.manage')) {
    return <p className="mx-auto max-w-3xl text-sm text-muted-foreground">Tu usuario no puede administrar usuarios ni permisos.</p>;
  }
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/settings" className="text-sm text-muted-foreground hover:underline">← Configuración</Link>
      <h1 className="text-2xl font-semibold">Usuarios y permisos</h1>
      <p className="text-sm text-muted-foreground">
        Cada usuario tiene un rol, y el rol define qué puede hacer y qué ve en el menú. Para darle más responsabilidades a alguien, pasalo a otro rol
        o sumale permisos a su rol. Con el celular cargado, cuando escribe al WhatsApp de la empresa la IA lo reconoce y le responde como asistente
        interno, según los permisos de su rol (no le vende). Los usuarios nuevos se crean con el workflow Deploy.
      </p>
      <Users />
      <Roles />
    </div>
  );
}

function Users() {
  const { data: users, isLoading } = useStaffUsers();
  const { data: roles } = useRoles();
  if (isLoading || !users || !roles) return <Skeleton className="h-48" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Usuarios</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {users.map((u) => (
          <UserRow key={u.id} user={u} roles={roles} />
        ))}
      </CardContent>
    </Card>
  );
}

function UserRow({ user, roles }: { user: StaffUserView; roles: RoleView[] }) {
  const update = useUpdateStaffUser();
  const [roleId, setRoleId] = useState(user.role.id);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = roleId !== user.role.id || phone.trim() !== (user.phone ?? '');

  const save = async (extra: { isActive?: boolean } = {}) => {
    setError(null);
    setSaved(false);
    try {
      await update.mutateAsync({ id: user.id, roleId, phone: phone.trim() ? phone.trim() : null, ...extra });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">{user.fullName}</span>
        <span className="text-sm text-muted-foreground">{user.email}</span>
        {!user.isActive && <Badge tone="bad">Desactivado</Badge>}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Rol" htmlFor={`role-${user.id}`}>
          <Select id={`role-${user.id}`} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Celular personal (WhatsApp)" htmlFor={`phone-${user.id}`} hint={user.phone ? `Vinculado: +${user.phone}` : 'Sin vincular'}>
          <Input id={`phone-${user.id}`} value={phone.startsWith('549') ? `+${phone}` : phone} onChange={(e) => setPhone(e.target.value.replace(/^\+/, ''))} placeholder="11 5906-3462" inputMode="tel" />
        </Field>
        <div className="flex gap-2 pb-5">
          <Button size="sm" disabled={!dirty || update.isPending} onClick={() => save()}>
            Guardar
          </Button>
          <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => save({ isActive: !user.isActive })}>
            {user.isActive ? 'Desactivar' : 'Activar'}
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {saved && !error && <p className="text-xs text-success">Guardado. Los cambios de rol se aplican en menos de un minuto.</p>}
    </div>
  );
}

function Roles() {
  const { data: roles, isLoading } = useRoles();
  const { data: catalog } = usePermissionCatalog();
  const [creating, setCreating] = useState(false);
  if (isLoading || !roles || !catalog) return <Skeleton className="h-64" />;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Roles</CardTitle>
        {!creating && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            Nuevo rol
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {creating && <RoleEditor catalog={catalog} onDone={() => setCreating(false)} />}
        {roles.map((r) => (
          <RoleCard key={r.id} role={r} catalog={catalog} />
        ))}
      </CardContent>
    </Card>
  );
}

function RoleCard({ role, catalog }: { role: RoleView; catalog: PermissionGroup[] }) {
  const [editing, setEditing] = useState(false);
  const remove = useDeleteRole();
  const labels = new Map(catalog.flatMap((g) => g.permissions.map((p) => [p.key, p.label])));
  if (editing) return <RoleEditor role={role} catalog={catalog} onDone={() => setEditing(false)} />;
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{role.name}</span>
        <span className="text-xs text-muted-foreground">
          {role.users} {role.users === 1 ? 'usuario' : 'usuarios'} · {role.locked ? 'todos los permisos' : `${role.permissions.length} permisos`}
        </span>
        <div className="ml-auto flex gap-2">
          {!role.locked && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Editar permisos
            </Button>
          )}
          {!role.isSystem && role.users === 0 && (
            <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(role.id)}>
              Borrar
            </Button>
          )}
        </div>
      </div>
      {role.locked ? (
        <p className="mt-1 text-xs text-muted-foreground">El Dueño tiene siempre todos los permisos, también los que se agreguen más adelante.</p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">{role.permissions.map((p) => labels.get(p) ?? p).join(' · ') || 'Sin permisos'}</p>
      )}
    </div>
  );
}

function RoleEditor({ role, catalog, onDone }: { role?: RoleView; catalog: PermissionGroup[]; onDone: () => void }) {
  const create = useCreateRole();
  const update = useUpdateRole();
  const [name, setName] = useState(role?.name ?? '');
  const [perms, setPerms] = useState(new Set<string>(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);
  const toggle = (k: string) =>
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const save = async () => {
    setError(null);
    const input = { name: name.trim(), description: role?.description ?? null, permissions: [...perms] as RoleView['permissions'] };
    try {
      if (role) await update.mutateAsync({ id: role.id, ...input });
      else await create.mutateAsync(input);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-primary/40 p-3">
      <Field label="Nombre del rol" htmlFor={`rname-${role?.id ?? 'new'}`}>
        <Input id={`rname-${role?.id ?? 'new'}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Encargado de depósito" maxLength={60} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {catalog.map((g) => (
          <fieldset key={g.label} className="space-y-1">
            <legend className="text-xs font-medium text-muted-foreground">{g.label}</legend>
            {g.permissions.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={perms.has(p.key)} onChange={() => toggle(p.key)} />
                {p.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={name.trim().length < 2 || create.isPending || update.isPending} onClick={save}>
          Guardar
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
