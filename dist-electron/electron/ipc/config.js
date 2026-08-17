import { ipcMain } from 'electron';
import { hasDbConfig, saveDbConfig } from '../services/config.js';
import { resetPrisma, runMigrations } from '../data/prisma.js';
const wrap = async (fn) => { try {
    return { ok: true, data: await fn() };
}
catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
} };
export function registerConfigIpc() {
    ipcMain.handle('config:exists', () => wrap(() => hasDbConfig()));
    ipcMain.handle('config:save', (_e, config) => wrap(() => { saveDbConfig(config); resetPrisma(); runMigrations(); return true; }));
}
//# sourceMappingURL=config.js.map