import { ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import { getPrisma } from '../data/prisma.js';
import type { UserCreateRequest, UserUpdateRequest } from '../../shared/ipc.js';
import { requireRole, safeDetail, wrap } from './helpers.js';

const roles = ['ADMIN', 'CAJERO', 'MESERO', 'COCINA'] as const;
const mapUser = (user: any) => ({ id: user.id, nombre: user.nombre, rol: user.rol, activo: user.activo });

export function registerUsersIpc() {
  ipcMain.handle('users:list', (_e, actorId: string) => wrap(async () => {
    const prisma = getPrisma();
    await requireRole(prisma, actorId, ['ADMIN']);
    return (await prisma.user.findMany({ select: { id: true, nombre: true, rol: true, activo: true }, orderBy: { nombre: 'asc' } })).map(mapUser);
  }));
  ipcMain.handle('users:create', (_e, req: UserCreateRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.actorId, ['ADMIN']);
    if (!req.nombre.trim()) throw new Error('El nombre es obligatorio');
    if (!/^\d{4,12}$/.test(req.pin)) throw new Error('El PIN debe tener entre 4 y 12 dígitos');
    if (!roles.includes(req.rol)) throw new Error('Rol inválido');
    const user = await tx.user.create({ data: { nombre: req.nombre.trim(), pin_hash: await bcrypt.hash(req.pin, 10), rol: req.rol, activo: true }, select: { id: true, nombre: true, rol: true, activo: true } });
    await tx.auditLog.create({ data: { user_id: req.actorId, accion: 'USER_CREATED', detalle_json: safeDetail({ userId: user.id, rol: user.rol }) } });
    return mapUser(user);
  })));
  ipcMain.handle('users:update', (_e, req: UserUpdateRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.actorId, ['ADMIN']);
    if (req.pin && !/^\d{4,12}$/.test(req.pin)) throw new Error('El PIN debe tener entre 4 y 12 dígitos');
    if (req.rol && !roles.includes(req.rol)) throw new Error('Rol inválido');
    const user = await tx.user.update({ where: { id: req.id }, data: { nombre: req.nombre?.trim(), rol: req.rol, activo: req.activo, pin_hash: req.pin ? await bcrypt.hash(req.pin, 10) : undefined }, select: { id: true, nombre: true, rol: true, activo: true } });
    await tx.auditLog.create({ data: { user_id: req.actorId, accion: 'USER_UPDATED', detalle_json: safeDetail({ userId: user.id, rol: user.rol, activo: user.activo, pinChanged: Boolean(req.pin) }) } });
    return mapUser(user);
  })));
}
