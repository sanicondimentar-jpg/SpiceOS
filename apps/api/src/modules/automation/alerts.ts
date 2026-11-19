/** Avisos automáticos: qué revisa el sistema todos los días y con qué umbral. */

export const ALERT_KINDS = ['overdueDebt', 'lowStock', 'expiring', 'webOrders', 'staleQuotes', 'lapsedCustomers'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface AlertSetting {
  enabled: boolean;
  /** Días u horas según el aviso (ver ALERT_PARAM). */
  value?: number;
}
export type AlertSettings = Record<AlertKind, AlertSetting>;

/** Parámetro de cada aviso: qué significa y entre qué valores puede estar. */
export const ALERT_PARAM: Partial<Record<AlertKind, { unit: 'días' | 'horas'; min: number; max: number; default: number }>> = {
  expiring: { unit: 'días', min: 7, max: 365, default: 60 },
  webOrders: { unit: 'horas', min: 1, max: 72, default: 2 },
  staleQuotes: { unit: 'días', min: 1, max: 30, default: 2 },
};

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  overdueDebt: { enabled: true },
  lowStock: { enabled: true },
  expiring: { enabled: true, value: 60 },
  webOrders: { enabled: true, value: 2 },
  staleQuotes: { enabled: true, value: 2 },
  lapsedCustomers: { enabled: true },
};

/** Mezcla lo guardado con los valores por defecto y acota los parámetros (lo guardado puede ser viejo o inválido). */
export function resolveSettings(saved: unknown): AlertSettings {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<string, Partial<AlertSetting>>>;
  const out = {} as AlertSettings;
  for (const kind of ALERT_KINDS) {
    const d = DEFAULT_ALERT_SETTINGS[kind];
    const v = s[kind] ?? {};
    const p = ALERT_PARAM[kind];
    const value = p ? Math.min(p.max, Math.max(p.min, Math.round(Number(v.value ?? d.value ?? p.default)) || p.default)) : undefined;
    out[kind] = { enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled, ...(p && { value }) };
  }
  return out;
}

export interface Alert {
  kind: AlertKind;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  link: string;
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || ALERT_KINDS.indexOf(a.kind) - ALERT_KINDS.indexOf(b.kind));
}
