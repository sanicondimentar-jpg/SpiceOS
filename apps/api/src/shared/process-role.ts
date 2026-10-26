/** Un mismo código, tres procesos: api (HTTP), worker (consumidores + relay), scheduler. */
export type ProcessRole = 'api' | 'worker' | 'scheduler';

export const processRole = (): ProcessRole => (process.env.SPICEOS_PROCESS as ProcessRole) ?? 'api';
export const isWorker = () => processRole() === 'worker';
export const isScheduler = () => processRole() === 'scheduler';
