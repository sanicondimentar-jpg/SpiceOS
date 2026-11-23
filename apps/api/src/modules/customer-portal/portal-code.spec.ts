import { loginCodeIn, loginMessage, newLoginCode } from './portal-code';

describe('código del portal de clientes', () => {
  it('genera 6 cifras', () => {
    for (let i = 0; i < 50; i++) expect(newLoginCode()).toMatch(/^[1-9]\d{5}$/);
  });

  it('lee el código del mensaje que arma el portal', () => {
    expect(loginCodeIn(loginMessage('482913'))).toBe('482913');
  });

  it('acepta el mensaje aunque el cliente lo edite un poco', () => {
    expect(loginCodeIn('hola! codigo portal 482913')).toBe('482913');
  });

  it('no toma mensajes que no son para el portal', () => {
    expect(loginCodeIn('Quiero 482913 cajas')).toBeNull();
    expect(loginCodeIn('*Pedido PED-00048291 — Sabor a Casa*')).toBeNull();
    expect(loginCodeIn('portal 12345')).toBeNull();
    expect(loginCodeIn(null)).toBeNull();
  });
});
