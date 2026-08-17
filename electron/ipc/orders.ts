import { ipcMain } from 'electron';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../data/prisma.js';
import type { CreateOrderRequest, PayOrderRequest, UpdateOrderStatusRequest, UserSession } from '../../shared/ipc.js';
import { requireRole, safeDetail, toMoney, wrap } from './helpers.js';

const includeOrder = { user: true, items: { include: { variant: { include: { product: true } } } } };
const mapOrder = (order: any) => { const items = order.items.map((item: any) => ({ id: item.id, variantId: item.variant_id, producto: item.variant.product.nombre, variante: item.variant.nombre, cantidad: item.cantidad, precioUnitario: toMoney(item.precio_unitario), subtotal: toMoney(item.precio_unitario.mul(item.cantidad)) })); const total = items.reduce((s: number, i: any) => s + Number(i.subtotal), 0); const paidAudit = order.auditPayment?.[0]?.detalle_json as any; return { id: order.id, mesa: order.mesa, estado: order.estado, userId: order.user_id, userName: order.user?.nombre ?? 'Usuario', createdAt: order.created_at.toISOString(), total: total.toFixed(2), paymentMethod: paidAudit?.paymentMethod ?? null, note: (order.auditCreate?.[0]?.detalle_json as any)?.note ?? null, items }; };
async function loadOrder(tx: any, orderId: string) { const order = await tx.order.findUnique({ where: { id: orderId }, include: includeOrder }); if (!order) throw new Error('El pedido no existe'); return order; }
async function attachAudits(prisma: any, orders: any[]) { const logs = await prisma.auditLog.findMany({ where: { accion: { in: ['ORDER_PAID', 'ORDER_CREATED'] } }, orderBy: { created_at: 'desc' } }); return orders.map((o) => ({ ...o, auditPayment: logs.filter((l: any) => l.accion === 'ORDER_PAID' && (l.detalle_json as any)?.orderId === o.id).slice(0, 1), auditCreate: logs.filter((l: any) => l.accion === 'ORDER_CREATED' && (l.detalle_json as any)?.orderId === o.id).slice(0, 1) })); }

export function registerOrdersIpc() {
  ipcMain.handle('orders:create', (_e, req: CreateOrderRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO', 'MESERO']);
    if (!req.items?.length) throw new Error('El pedido debe tener al menos un item');
    if (req.items.some((i) => !i.variantId || !Number.isInteger(i.cantidad) || i.cantidad <= 0)) throw new Error('Las cantidades del pedido deben ser mayores a cero');
    const merged = [...req.items.reduce((m, i) => m.set(i.variantId, (m.get(i.variantId) ?? 0) + i.cantidad), new Map<string, number>())].map(([variantId, cantidad]) => ({ variantId, cantidad }));
    const variants = await tx.productVariant.findMany({ where: { id: { in: merged.map((i) => i.variantId) } }, include: { inventory: true, product: true } });
    if (variants.length !== merged.length) throw new Error('Una o más variantes del pedido no existen');
    for (const item of merged) { const v = variants.find((x: any) => x.id === item.variantId); if ((v?.inventory?.current_stock ?? 0) < item.cantidad) throw new Error(`Stock insuficiente para ${v?.product?.nombre ?? ''} ${v?.nombre ?? item.variantId}`); }
    const order = await tx.order.create({ data: { mesa: req.mesa?.trim() || null, user_id: req.userId, estado: 'PENDIENTE', items: { create: merged.map((i) => ({ variant_id: i.variantId, cantidad: i.cantidad, precio_unitario: variants.find((v: any) => v.id === i.variantId)?.precio ?? new Prisma.Decimal(0) })) } }, include: includeOrder });
    for (const item of order.items) await tx.inventory.update({ where: { variant_id: item.variant_id }, data: { current_stock: { decrement: item.cantidad } } });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: 'ORDER_CREATED', detalle_json: safeDetail({ orderId: order.id, mesa: req.mesa, note: req.note, items: merged, inventoryDeducted: true }) } });
    return mapOrder(order);
  })));
  ipcMain.handle('orders:pay', (_e, req: PayOrderRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO']); const order = await loadOrder(tx, req.orderId);
    if (!['PENDIENTE','EN_COCINA','EN_PREPARACION','LISTO','ENTREGADO'].includes(order.estado)) throw new Error(order.estado === 'PAGADO' ? 'El pedido ya está pagado' : 'No se puede cobrar este pedido');
    const total = order.items.reduce((s: Prisma.Decimal, i: any) => s.plus(i.precio_unitario.mul(i.cantidad)), new Prisma.Decimal(0));
    const cash = await tx.cashRegister.findFirst({ where: { status: 'ABIERTA' }, orderBy: { opened_at: 'desc' } }); if (!cash) throw new Error('Debe abrir una caja antes de registrar una venta');
    const payments = req.payments?.length ? req.payments : [{ method: req.paymentMethod ?? 'EFECTIVO', amount: req.receivedAmount ?? total.toString() }];
    const nonCash = payments.filter((p) => p.method !== 'EFECTIVO').reduce((s, p) => s + Number(p.amount), 0); const cashAmount = payments.filter((p) => p.method === 'EFECTIVO').reduce((s, p) => s + Number(p.amount), 0); const paid = nonCash + cashAmount;
    if (nonCash > Number(total)) throw new Error('Los pagos no efectivo no pueden exceder el total'); if (paid < Number(total)) throw new Error('Pago incompleto'); const cashApplied = Math.max(0, Number(total) - nonCash);
    for (const p of payments) if (p.method !== 'EFECTIVO') await tx.cashMovement.create({ data: { cash_register_id: cash.id, tipo: 'VENTA', monto: p.amount, payment_method: p.method } });
    if (cashApplied > 0) await tx.cashMovement.create({ data: { cash_register_id: cash.id, tipo: 'VENTA', monto: cashApplied.toFixed(2), payment_method: 'EFECTIVO', detalle_json: safeDetail({ recibido: cashAmount.toFixed(2), vuelto: Math.max(0, paid - Number(total)).toFixed(2) }) } });
    const updated = await tx.order.update({ where: { id: req.orderId }, data: { estado: 'PAGADO' }, include: includeOrder });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: 'ORDER_PAID', detalle_json: safeDetail({ orderId: req.orderId, cashRegisterId: cash.id, total: total.toString(), paymentMethod: payments.length > 1 ? 'MIXTO' : payments[0].method, payments, paid, change: Math.max(0, paid - Number(total)).toFixed(2) }) } });
    return mapOrder({ ...updated, auditPayment: [{ detalle_json: { paymentMethod: payments.length > 1 ? 'MIXTO' : payments[0].method } }] });
  })));
  ipcMain.handle('orders:updateStatus', (_e, req: UpdateOrderStatusRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO', 'COCINA']); if (req.estado === 'PAGADO') throw new Error('Use el flujo de cobro para pagar pedidos'); const order = await loadOrder(tx, req.orderId);
    if (['PAGADO','CANCELADO'].includes(order.estado)) throw new Error('No se puede cambiar un pedido finalizado');
    const valid: Record<string, string[]> = { ABIERTO: ['PENDIENTE','CANCELADO'], PENDIENTE: ['EN_COCINA','EN_PREPARACION','CANCELADO'], EN_COCINA: ['EN_PREPARACION','LISTO','CANCELADO'], EN_PREPARACION: ['LISTO','CANCELADO'], LISTO: ['ENTREGADO','CANCELADO'], ENTREGADO: ['CANCELADO'] };
    if (!valid[order.estado]?.includes(req.estado)) throw new Error('Transición de estado inválida'); const updated = await tx.order.update({ where: { id: req.orderId }, data: { estado: req.estado }, include: includeOrder });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: req.estado === 'CANCELADO' ? 'ORDER_CANCELLED' : 'ORDER_STATUS_CHANGED', detalle_json: safeDetail({ orderId: req.orderId, from: order.estado, to: req.estado }) } }); return mapOrder(updated);
  })));
  ipcMain.handle('orders:list', (_e, user: UserSession) => wrap(async () => { const prisma = getPrisma(); await requireRole(prisma, user.id, ['ADMIN', 'CAJERO', 'MESERO', 'COCINA']); return (await attachAudits(prisma, await prisma.order.findMany({ include: includeOrder, orderBy: { created_at: 'desc' } }))).map(mapOrder); }));
  ipcMain.handle('orders:getById', (_e, id: string) => wrap(async () => { const prisma = getPrisma(); const order = await prisma.order.findUnique({ where: { id }, include: includeOrder }); return order ? mapOrder((await attachAudits(prisma, [order]))[0]) : null; }));
}
