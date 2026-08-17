import { ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import { getPrisma } from '../data/prisma.js';
import type { LoginRequest } from '../../shared/ipc.js';
const wrap = async <T>(fn: () => Promise<T>) => { try { return { ok: true as const, data: await fn() }; } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : 'Unknown error' }; } };
export function registerAuthIpc() {
  ipcMain.handle('auth:login', (_e, req: LoginRequest) => wrap(async () => {
    const users = await getPrisma().user.findMany({ where: { activo: true } });
    const user = users.find((u) => bcrypt.compareSync(req.pin, u.pin_hash));
    if (!user) throw new Error('PIN inválido');
    return { id: user.id, nombre: user.nombre, rol: user.rol };
  }));
  ipcMain.handle('auth:logout', () => ({ ok: true, data: true }));
}
