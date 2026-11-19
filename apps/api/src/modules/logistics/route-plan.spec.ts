import { mapsUrl, notReadyToLeave, routeDone, zoneOf } from './route-plan';

describe('hojas de ruta', () => {
  it('no deja salir con pedidos sin preparar', () => {
    expect(notReadyToLeave([{ number: 'A', status: 'READY' }, { number: 'B', status: 'PICKING' }, { number: 'C', status: 'DISPATCHED' }])).toEqual(['B']);
  });

  it('termina cuando todas las paradas se entregaron o fallaron', () => {
    expect(routeDone([{ status: 'DELIVERED' }, { status: 'FAILED' }])).toBe(true);
    expect(routeDone([{ status: 'DELIVERED' }, { status: 'IN_TRANSIT' }])).toBe(false);
    expect(routeDone([])).toBe(false);
  });

  it('agrupa por localidad sin importar mayúsculas ni espacios', () => {
    expect(zoneOf('  vicente   lopez ')).toBe('Vicente Lopez');
    expect(zoneOf('SAN ISIDRO')).toBe('San Isidro');
    expect(zoneOf('villa de mayo')).toBe('Villa de Mayo');
    expect(zoneOf(null)).toBe('Sin dirección');
  });

  it('arma el link de Google Maps', () => {
    expect(mapsUrl({ street: 'Av. Maipú 100', city: 'Olivos', province: 'Buenos Aires' })).toContain('Av.%20Maip%C3%BA%20100%2C%20Olivos');
    expect(mapsUrl(null)).toBeNull();
  });
});
