import { ipcMain } from 'electron';
import { getPrisma } from '../data/prisma.js';
import { requireRole, wrap } from './helpers.js';

export function registerAuditIpc() {
  ipcMain.handle('audit:list', (_e, actorId: string) => wrap(async () => {
    const prisma = getPrisma();
    await requireRole(prisma, actorId, ['ADMIN']);
    return (await prisma.auditLog.findMany({ include: { user: true }, orderBy: { created_at: 'desc' }, take: 100 })).map((log) => ({ id: log.id, userName: log.user.nombre, accion: log.accion, detalle: log.detalle_json, createdAt: log.created_at.toISOString() }));
  }));
}
