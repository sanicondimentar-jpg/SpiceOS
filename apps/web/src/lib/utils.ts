import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export const money = (n: number | string | null | undefined) => ars.format(Number(n ?? 0));
export const number = (n: number | string | null | undefined) => new Intl.NumberFormat('es-AR').format(Number(n ?? 0));
export const date = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString('es-AR') : '—');
