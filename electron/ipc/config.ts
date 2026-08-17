import { ipcMain } from 'electron';
import { hasDbConfig, saveDbConfig } from '../services/config.js';
import { resetPrisma, runMigrations } from '../data/prisma.js';
import type { DbConfig } from '../../shared/ipc.js';
const wrap = async <T>(fn: () => Promise<T> | T) => { try { return { ok: true as const, data: await fn() }; } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : 'Unknown error' }; } };
export function registerConfigIpc() {
  ipcMain.handle('config:exists', () => wrap(() => hasDbConfig()));
  ipcMain.handle('config:save', (_e, config: DbConfig) => wrap(() => { saveDbConfig(config); resetPrisma(); runMigrations(); return true; }));
}
