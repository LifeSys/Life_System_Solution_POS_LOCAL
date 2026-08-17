import { ipcMain } from 'electron';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../data/prisma.js';
import type { CreateOrderRequest, PayOrderRequest, UpdateOrderStatusRequest, UserSession } from '../../shared/ipc.js';
import { requireRole, safeDetail, toMoney, wrap } from './helpers.js';

const includeOrder = { user: true, items: { include: { variant: { include: { product: true } } } } };

const mapOrder = (order: any) => {
  const items = order.items.map((item: any) => {
    const subtotal = item.precio_unitario.mul(item.cantidad);
    return { id: item.id, variantId: item.variant_id, producto: item.variant.product.nombre, variante: item.variant.nombre, cantidad: item.cantidad, precioUnitario: toMoney(item.precio_unitario), subtotal: toMoney(subtotal) };
  });
  const total = items.reduce((sum: number, item: any) => sum + Number(item.subtotal), 0);
  const paidAudit = order.auditPayment?.[0]?.detalle_json as { paymentMethod?: string } | undefined;
  return { id: order.id, mesa: order.mesa, estado: order.estado, userId: order.user_id, userName: order.user?.nombre ?? 'Usuario', createdAt: order.created_at.toISOString(), total: total.toFixed(2), paymentMethod: paidAudit?.paymentMethod ?? null, items };
};

async function loadOrder(tx: any, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: includeOrder });
  if (!order) throw new Error('El pedido no existe');
  return order;
}

async function attachPaymentMethods(prisma: any, orders: any[]) {
  const logs = await prisma.auditLog.findMany({ where: { accion: 'ORDER_PAID' }, orderBy: { created_at: 'desc' } });
  return orders.map((order) => ({ ...order, auditPayment: logs.filter((log: any) => (log.detalle_json as any)?.orderId === order.id).slice(0, 1) }));
}

export function registerOrdersIpc() {
  ipcMain.handle('orders:create', (_e, req: CreateOrderRequest) => wrap(async () => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO', 'MESERO']);
    if (!req.items?.length) throw new Error('El pedido debe tener al menos un item');
    if (req.items.some((item) => !item.variantId || !Number.isInteger(item.cantidad) || item.cantidad <= 0)) throw new Error('Las cantidades del pedido deben ser mayores a cero');
    const merged = [...req.items.reduce((map, item) => map.set(item.variantId, (map.get(item.variantId) ?? 0) + item.cantidad), new Map<string, number>())].map(([variantId, cantidad]) => ({ variantId, cantidad }));
    const ids = merged.map((i) => i.variantId);
    const variants = await tx.productVariant.findMany({ where: { id: { in: ids } }, include: { inventory: true } });
    if (variants.length !== ids.length) throw new Error('Una o más variantes del pedido no existen');
    for (const item of merged) {
      const variant = variants.find((v: any) => v.id === item.variantId);
      if ((variant?.inventory?.current_stock ?? 0) < item.cantidad) throw new Error(`Stock insuficiente para ${variant?.nombre ?? item.variantId}`);
    }
    const order = await tx.order.create({ data: { mesa: req.mesa?.trim() || null, user_id: req.userId, items: { create: merged.map((item) => ({ variant_id: item.variantId, cantidad: item.cantidad, precio_unitario: variants.find((v: any) => v.id === item.variantId)?.precio ?? new Prisma.Decimal(0) })) } }, include: includeOrder });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: 'ORDER_CREATED', detalle_json: safeDetail({ orderId: order.id, items: merged }) } });
    return mapOrder(order);
  })));

  ipcMain.handle('orders:pay', (_e, req: PayOrderRequest) => wrap(async () => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO']);
    const order = await loadOrder(tx, req.orderId);
    if (order.estado !== 'PENDIENTE') throw new Error(order.estado === 'PAGADO' ? 'El pedido ya está pagado' : 'Solo se pueden cobrar pedidos pendientes');
    const total = order.items.reduce((sum: Prisma.Decimal, item: any) => sum.plus(item.precio_unitario.mul(item.cantidad)), new Prisma.Decimal(0));
    if (total.lte(0)) throw new Error('El total del pedido es inválido');
    if (req.paymentMethod === 'EFECTIVO' && Number(req.receivedAmount ?? 0) < Number(total)) throw new Error('El monto recibido no cubre el total');
    const cash = await tx.cashRegister.findFirst({ where: { status: 'ABIERTA' }, orderBy: { opened_at: 'desc' } });
    if (!cash) throw new Error('Debe abrir una caja antes de registrar una venta');
    for (const item of order.items) {
      const inventory = await tx.inventory.findUnique({ where: { variant_id: item.variant_id } });
      if (!inventory || inventory.current_stock < item.cantidad) throw new Error(`Stock insuficiente para ${item.variant.product.nombre} ${item.variant.nombre}`);
      await tx.inventory.update({ where: { variant_id: item.variant_id }, data: { current_stock: { decrement: item.cantidad } } });
    }
    await tx.cashMovement.create({ data: { cash_register_id: cash.id, tipo: 'VENTA', monto: total } });
    const updated = await tx.order.update({ where: { id: req.orderId }, data: { estado: 'PAGADO' }, include: includeOrder });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: 'ORDER_PAID', detalle_json: safeDetail({ orderId: req.orderId, cashRegisterId: cash.id, total: total.toString(), paymentMethod: req.paymentMethod, receivedAmount: req.receivedAmount }) } });
    return mapOrder({ ...updated, auditPayment: [{ detalle_json: { paymentMethod: req.paymentMethod } }] });
  })));

  ipcMain.handle('orders:updateStatus', (_e, req: UpdateOrderStatusRequest) => wrap(async () => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO', 'COCINA']);
    if (req.estado === 'PAGADO') throw new Error('Use el flujo de cobro para pagar pedidos');
    const order = await loadOrder(tx, req.orderId);
    if (order.estado === 'PAGADO') throw new Error('No se puede cambiar un pedido pagado');
    if (order.estado === 'CANCELADO') throw new Error('No se puede cambiar un pedido cancelado');
    const valid: Record<string, string[]> = { PENDIENTE: ['EN_COCINA', 'CANCELADO'], EN_COCINA: ['LISTO', 'CANCELADO'], LISTO: ['CANCELADO'] };
    if (!valid[order.estado]?.includes(req.estado)) throw new Error('Transición de estado inválida');
    const updated = await tx.order.update({ where: { id: req.orderId }, data: { estado: req.estado }, include: includeOrder });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: req.estado === 'CANCELADO' ? 'ORDER_CANCELLED' : 'ORDER_STATUS_CHANGED', detalle_json: safeDetail({ orderId: req.orderId, from: order.estado, to: req.estado }) } });
    return mapOrder(updated);
  })));

  ipcMain.handle('orders:list', (_e, user: UserSession) => wrap(async () => {
    const prisma = getPrisma();
    await requireRole(prisma, user.id, ['ADMIN', 'CAJERO', 'MESERO', 'COCINA']);
    return (await attachPaymentMethods(prisma, await prisma.order.findMany({ include: includeOrder, orderBy: { created_at: 'desc' } }))).map(mapOrder);
  }));
  ipcMain.handle('orders:getById', (_e, id: string) => wrap(async () => {
    const prisma = getPrisma();
    const order = await prisma.order.findUnique({ where: { id }, include: includeOrder });
    return order ? mapOrder((await attachPaymentMethods(prisma, [order]))[0]) : null;
  }));
}
