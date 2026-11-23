import { permissionsToGrant } from './role-seed';

const all = ['a', 'b', 'c', 'nuevo'];

describe('permissionsToGrant', () => {
  it('el Dueño recibe todo lo que le falte', () => {
    expect(permissionsToGrant({ isOwner: true, isNew: false, defaults: all, current: ['a'], distributed: all, all })).toEqual(['b', 'c', 'nuevo']);
  });

  it('un rol nuevo arranca con sus permisos por defecto', () => {
    expect(permissionsToGrant({ isOwner: false, isNew: true, defaults: ['a', 'b'], current: [], distributed: all, all })).toEqual(['a', 'b']);
  });

  it('no devuelve un permiso que le sacaron a mano', () => {
    expect(permissionsToGrant({ isOwner: false, isNew: false, defaults: ['a', 'b'], current: ['a'], distributed: ['a', 'b', 'c'], all })).toEqual([]);
  });

  it('reparte solo los permisos que aparecieron desde el último deploy', () => {
    expect(permissionsToGrant({ isOwner: false, isNew: false, defaults: ['a', 'nuevo'], current: [], distributed: ['a', 'b', 'c'], all })).toEqual(['nuevo']);
  });
});
