import { ipcMain } from 'electron';
import { getPrisma } from '../data/prisma.js';
import type { TableInput, TableUpdateRequest, UserSession } from '../../shared/ipc.js';
import { requireRole, safeDetail, wrap } from './helpers.js';

const openStatuses = ['PENDIENTE', 'EN_COCINA', 'EN_PREPARACION', 'LISTO', 'ENTREGADO'];
const includeTable = { orders: { where: { estado: { in: openStatuses as any } }, orderBy: { created_at: 'desc' as const }, take: 1, include: { items: { include: { variant: { include: { product: true } } } } } } };

const mapTable = (table: any) => {
  const activeOrder = table.orders?.[0] ?? null;
  return { id: table.id, nombre: table.nombre, capacidad: table.capacidad, estado: table.estado, activa: table.activa, activeOrderId: activeOrder?.id ?? null, activeOrderTotal: activeOrder ? activeOrder.items.reduce((s: number, i: any) => s + Number(i.precio_unitario) * i.cantidad, 0).toFixed(2) : null };
};

export async function syncTableStates(tx: any) {
  const tables = await tx.restaurantTable.findMany({ include: includeTable });
  for (const table of tables) {
    if (table.estado === 'RESERVADA') continue;
    const next = table.orders?.length ? 'OCUPADA' : 'DISPONIBLE';
    if (table.estado !== next) await tx.restaurantTable.update({ where: { id: table.id }, data: { estado: next } });
  }
}

export function registerTablesIpc() {
  ipcMain.handle('tables:list', (_e, user: UserSession) => wrap(async () => {
    const prisma = getPrisma();
    await requireRole(prisma, user.id, ['ADMIN', 'CAJERO', 'MESERO', 'COCINA']);
    await syncTableStates(prisma);
    return (await prisma.restaurantTable.findMany({ where: user.rol === 'ADMIN' ? {} : { activa: true }, include: includeTable, orderBy: { nombre: 'asc' } })).map(mapTable);
  }));
  ipcMain.handle('tables:create', (_e, req: TableInput) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.actorId, ['ADMIN']);
    if (!req.nombre.trim()) throw new Error('El nombre de mesa es obligatorio');
    const table = await tx.restaurantTable.create({ data: { nombre: req.nombre.trim(), capacidad: req.capacidad, activa: req.activa ?? true }, include: includeTable });
    await tx.auditLog.create({ data: { user_id: req.actorId, accion: 'TABLE_CREATED', detalle_json: safeDetail({ tableId: table.id }) } });
    return mapTable(table);
  })));
  ipcMain.handle('tables:update', (_e, req: TableUpdateRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.actorId, ['ADMIN']);
    const open = await tx.order.count({ where: { table_id: req.id, estado: { in: openStatuses as any } } });
    if (req.activa === false && open) throw new Error('No se puede desactivar una mesa con pedido abierto');
    const table = await tx.restaurantTable.update({ where: { id: req.id }, data: { nombre: req.nombre?.trim(), capacidad: req.capacidad, activa: req.activa, estado: req.estado }, include: includeTable });
    await tx.auditLog.create({ data: { user_id: req.actorId, accion: 'TABLE_UPDATED', detalle_json: safeDetail({ tableId: table.id }) } });
    return mapTable(table);
  })));
}
