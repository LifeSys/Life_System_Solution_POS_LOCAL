import { ipcMain } from 'electron';
import { hasDbConfig, readDbConfig, saveDbConfig } from '../services/config.js';
import { checkDatabaseHealth, getStartupState, prepareDatabase, resetPrisma } from '../data/prisma.js';
import type { DbConfig } from '../../shared/ipc.js';
import { wrap } from './helpers.js';

export function registerConfigIpc() {
  ipcMain.handle('config:exists', () => wrap(() => hasDbConfig()));
  ipcMain.handle('config:startupState', () => wrap(() => getStartupState()));
  ipcMain.handle('config:getPublic', () => wrap(() => {
    const config = readDbConfig();
    if (!config) return null;
    return { host: config.host, port: config.port, user: config.user, database: config.database, hasPassword: Boolean(config.password) };
  }));
  ipcMain.handle('config:test', () => wrap(async () => {
    const config = readDbConfig();
    if (!config) return { connected: false, message: 'PostgreSQL no configurado.' };
    const health = await checkDatabaseHealth(config);
    return { connected: health.ok, message: health.message };
  }));
  ipcMain.handle('config:save', (_e, config: DbConfig) => wrap(async () => {
    saveDbConfig(config);
    resetPrisma();
    const result = await prepareDatabase(config);
    return { configured: true, databaseReady: true, needsAdmin: result.needsAdmin };
  }));
}
