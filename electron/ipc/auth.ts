import { ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import { getPrisma } from '../data/prisma.js';
import type { CreateAdminRequest, LoginRequest } from '../../shared/ipc.js';
const wrap = async <T>(fn: () => Promise<T>) => { try { return { ok: true as const, data: await fn() }; } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : 'Unknown error' }; } };
export function registerAuthIpc() {
  ipcMain.handle('auth:login', (_e, req: LoginRequest) => wrap(async () => {
    const users = await getPrisma().user.findMany({ where: { activo: true } });
    const user = users.find((u) => bcrypt.compareSync(req.pin, u.pin_hash));
    if (!user) throw new Error('PIN inválido');
    return { id: user.id, nombre: user.nombre, rol: user.rol };
  }));
  ipcMain.handle('auth:createInitialAdmin', (_e, req: CreateAdminRequest) => wrap(async () => {
    if (!req.nombre.trim()) throw new Error('El nombre del ADMIN es obligatorio');
    if (!/^\d{4,12}$/.test(req.pin)) throw new Error('El PIN debe tener entre 4 y 12 dígitos');
    const prisma = getPrisma();
    const count = await prisma.user.count();
    if (count > 0) throw new Error('Ya existe al menos un usuario. No se puede crear el ADMIN inicial.');
    const user = await prisma.user.create({ data: { nombre: req.nombre.trim(), pin_hash: bcrypt.hashSync(req.pin, 10), rol: 'ADMIN', activo: true } });
    return { id: user.id, nombre: user.nombre, rol: user.rol };
  }));
  ipcMain.handle('auth:logout', () => ({ ok: true, data: true }));
}
