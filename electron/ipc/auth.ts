import { ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import { getPrisma } from '../data/prisma.js';
import type { CreateAdminRequest, LoginRequest } from '../../shared/ipc.js';
import { safeDetail, wrap } from './helpers.js';

export function registerAuthIpc() {
  ipcMain.handle('auth:login', (_e, req: LoginRequest) => wrap(async () => {
    authDebug('auth:login received', { pinLength: req.pin?.length ?? 0 });
    if (!/^\d{4,12}$/.test(req.pin)) throw new Error('PIN inválido');

    const users = await getPrisma().user.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, rol: true, activo: true, pin_hash: true },
    });
    authDebug('active users loaded', {
      count: users.length,
      roles: [...new Set(users.map((user) => user.rol))],
      allActive: users.every((user) => user.activo),
      usersWithHash: users.filter((user) => Boolean(user.pin_hash)).length,
    });

    for (const user of users) {
      const matches = await bcrypt.compare(req.pin, user.pin_hash);
      authDebug('bcrypt comparison completed', { userId: user.id, role: user.rol, matches });
      if (matches) {
        await getPrisma().auditLog.create({ data: { user_id: user.id, accion: 'LOGIN_SUCCESS', detalle_json: safeDetail({ userId: user.id, rol: user.rol }) } });
        return { id: user.id, nombre: user.nombre, rol: user.rol };
      }
    }

    throw new Error('PIN inválido');
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
  ipcMain.handle('auth:logout', (_e, userId?: string) => wrap(async () => {
    if (userId) {
      await getPrisma().auditLog.create({ data: { user_id: userId, accion: 'LOGOUT', detalle_json: safeDetail({ userId }) } });
    }
    return true;
  }));
}

function authDebug(message: string, detail?: Record<string, unknown>) {
  if (process.env.LSS_AUTH_DEBUG === '1') {
    console.debug(`[auth] ${message}`, detail ?? {});
  }
}

function authDebug(message: string, detail?: Record<string, unknown>) {
  if (process.env.LSS_AUTH_DEBUG === '1') {
    console.debug(`[auth] ${message}`, detail ?? {});
  }
}
