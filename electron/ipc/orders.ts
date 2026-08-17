import { ipcMain } from 'electron';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../data/prisma.js';
import type { CreateOrderRequest, UpdateOrderStatusRequest, UserSession } from '../../shared/ipc.js';
import { requireRole, safeDetail, toMoney, wrap } from './helpers.js';

const mapOrder = (order: any) => {
  const items = order.items.map((item: any) => {
    const subtotal = item.precio_unitario.mul(item.cantidad);
    return { id: item.id, variantId: item.variant_id, producto: item.variant.product.nombre, variante: item.variant.nombre, cantidad: item.cantidad, precioUnitario: toMoney(item.precio_unitario), subtotal: toMoney(subtotal) };
  });
  const total = items.reduce((sum: number, item: any) => sum + Number(item.subtotal), 0);
  return { id: order.id, mesa: order.mesa, estado: order.estado, userId: order.user_id, userName: order.user?.nombre ?? 'Usuario', createdAt: order.created_at.toISOString(), total: total.toFixed(2), items };
};

const includeOrder = { user: true, items: { include: { variant: { include: { product: true } } } } };

export function registerOrdersIpc() {
  ipcMain.handle('orders:create', (_e, req: CreateOrderRequest) => wrap(async () => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO', 'MESERO']);
    if (req.items.length === 0) throw new Error('El pedido debe tener al menos un item');
    if (req.items.some((item) => !Number.isInteger(item.cantidad) || item.cantidad <= 0)) throw new Error('Las cantidades del pedido deben ser mayores a cero');
    const ids = [...new Set(req.items.map((i) => i.variantId))];
    const variants = await tx.productVariant.findMany({ where: { id: { in: ids } } });
    if (variants.length !== ids.length) throw new Error('Una o más variantes del pedido no existen');
    const order = await tx.order.create({ data: { mesa: req.mesa?.trim() || null, user_id: req.userId, items: { create: req.items.map((item) => ({ variant_id: item.variantId, cantidad: item.cantidad, precio_unitario: variants.find((v) => v.id === item.variantId)?.precio ?? new Prisma.Decimal(0) })) } }, include: includeOrder });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: 'ORDER_CREATED', detalle_json: safeDetail({ orderId: order.id, items: req.items.length }) } });
    return mapOrder(order);
  })));
  ipcMain.handle('orders:updateStatus', (_e, req: UpdateOrderStatusRequest) => wrap(async () => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO', 'COCINA']);
    const order = await tx.order.findUniqueOrThrow({ where: { id: req.orderId }, include: includeOrder });
    if (order.estado === 'PAGADO' && req.estado === 'PAGADO') return mapOrder(order);
    if (req.estado !== 'PAGADO') {
      const updated = await tx.order.update({ where: { id: req.orderId }, data: { estado: req.estado }, include: includeOrder });
      await tx.auditLog.create({ data: { user_id: req.userId, accion: req.estado === 'CANCELADO' ? 'ORDER_CANCELLED' : 'ORDER_STATUS_CHANGED', detalle_json: safeDetail({ orderId: req.orderId, estado: req.estado }) } });
      return mapOrder(updated);
    }
    if (!req.cashRegisterId) throw new Error('Caja requerida para procesar pago');
    const cash = await tx.cashRegister.findUniqueOrThrow({ where: { id: req.cashRegisterId } });
    if (cash.status !== 'ABIERTA') throw new Error('La caja no está abierta');
    for (const item of order.items) {
      const inventory = await tx.inventory.findUnique({ where: { variant_id: item.variant_id } });
      if (!inventory) throw new Error(`No existe inventario para la variante ${item.variant_id}`);
      if (inventory.current_stock < item.cantidad) throw new Error(`Stock insuficiente para ${item.variant.product.nombre} ${item.variant.nombre}`);
      await tx.inventory.update({ where: { variant_id: item.variant_id }, data: { current_stock: { decrement: item.cantidad } } });
    }
    const total = order.items.reduce((sum: Prisma.Decimal, item: any) => sum.plus(item.precio_unitario.mul(item.cantidad)), new Prisma.Decimal(0));
    await tx.cashMovement.create({ data: { cash_register_id: req.cashRegisterId, tipo: 'VENTA', monto: total } });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: 'ORDER_PAID', detalle_json: safeDetail({ orderId: req.orderId, total: total.toString(), paymentMethod: req.paymentMethod ?? 'EFECTIVO' }) } });
    return mapOrder(await tx.order.update({ where: { id: req.orderId }, data: { estado: 'PAGADO' }, include: includeOrder }));
  })));
  ipcMain.handle('orders:list', (_e, user: UserSession) => wrap(async () => {
    const prisma = getPrisma();
    await requireRole(prisma, user.id, ['ADMIN', 'CAJERO', 'MESERO', 'COCINA']);
    return (await prisma.order.findMany({ include: includeOrder, orderBy: { created_at: 'desc' } })).map(mapOrder);
  }));
  ipcMain.handle('orders:getById', (_e, id: string) => wrap(async () => {
    const order = await getPrisma().order.findUnique({ where: { id }, include: includeOrder });
    return order ? mapOrder(order) : null;
  }));
}
