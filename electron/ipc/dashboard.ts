import { ipcMain } from 'electron';
import { Prisma } from '@prisma/client';
import { getPrisma, checkDatabaseHealth } from '../data/prisma.js';
import type { UserSession } from '../../shared/ipc.js';
import { readDbConfig } from '../services/config.js';
import { requireRole, toMoney, wrap } from './helpers.js';

export function registerDashboardIpc() {
  ipcMain.handle('dashboard:summary', (_e, user: UserSession) => wrap(async () => {
    const prisma = getPrisma();
    await requireRole(prisma, user.id, ['ADMIN', 'CAJERO', 'MESERO', 'COCINA']);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [ordersToday, productsCount, lowStockCount, openCash, paidOrders, latestPaidOrders, dbConfig] = await Promise.all([
      prisma.order.count({ where: { created_at: { gte: start } } }),
      prisma.product.count(),
      prisma.inventory.count({ where: { current_stock: { lte: 5 } } }),
      prisma.cashRegister.findFirst({ where: { status: 'ABIERTA' } }),
      prisma.order.findMany({ where: { estado: 'PAGADO', created_at: { gte: start } }, include: { items: true } }),
      prisma.order.findMany({ where: { estado: 'PAGADO', created_at: { gte: start } }, include: { user: true, items: true }, orderBy: { created_at: 'desc' }, take: 5 }),
      Promise.resolve(readDbConfig()),
    ]);
    const salesToday = paidOrders.reduce((sum, order) => sum.plus(order.items.reduce((itemSum, item) => itemSum.plus(item.precio_unitario.mul(item.cantidad)), new Prisma.Decimal(0))), new Prisma.Decimal(0));
    const health = dbConfig ? await checkDatabaseHealth(dbConfig) : { ok: false as const, message: 'PostgreSQL no configurado.' };
    const cashBalance = openCash ? await prisma.cashMovement.aggregate({ where: { cash_register_id: openCash.id }, _sum: { monto: true } }) : null;
    const paidLogs = await prisma.auditLog.findMany({ where: { accion: 'ORDER_PAID', created_at: { gte: start } }, orderBy: { created_at: 'desc' } });
    const latestSales = latestPaidOrders.map((order) => {
      const total = order.items.reduce((sum, item) => sum.plus(item.precio_unitario.mul(item.cantidad)), new Prisma.Decimal(0));
      const log = paidLogs.find((audit) => (audit.detalle_json as any)?.orderId === order.id);
      return { time: order.created_at.toISOString(), orderId: order.id, userName: order.user.nombre, total: toMoney(total), paymentMethod: (log?.detalle_json as any)?.paymentMethod ?? null };
    });
    return { salesToday: toMoney(salesToday), ordersToday, productsCount, lowStockCount, cashStatus: openCash ? 'ABIERTA' : 'SIN_CAJA', cashBalance: toMoney(cashBalance?._sum.monto ?? 0), latestSales, currentUser: user, database: { connected: health.ok, message: health.message } };
  }));
}
