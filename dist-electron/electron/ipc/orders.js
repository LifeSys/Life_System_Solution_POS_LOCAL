import { ipcMain } from 'electron';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../data/prisma.js';
const wrap = async (fn) => { try {
    return { ok: true, data: await fn() };
}
catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
} };
export function registerOrdersIpc() {
    ipcMain.handle('orders:create', (_e, req) => wrap(async () => getPrisma().$transaction(async (tx) => {
        const variants = await tx.productVariant.findMany({ where: { id: { in: req.items.map((i) => i.variantId) } } });
        return tx.order.create({ data: { mesa: req.mesa, user_id: req.userId, items: { create: req.items.map((item) => ({ variant_id: item.variantId, cantidad: item.cantidad, precio_unitario: variants.find((v) => v.id === item.variantId)?.precio ?? new Prisma.Decimal(0) })) } }, include: { items: true } });
    })));
    ipcMain.handle('orders:updateStatus', (_e, req) => wrap(async () => getPrisma().$transaction(async (tx) => {
        const order = await tx.order.findUniqueOrThrow({ where: { id: req.orderId }, include: { items: true } });
        if (req.estado !== 'PAGADO')
            return tx.order.update({ where: { id: req.orderId }, data: { estado: req.estado } });
        if (!req.cashRegisterId)
            throw new Error('Caja requerida para procesar pago');
        const cash = await tx.cashRegister.findUniqueOrThrow({ where: { id: req.cashRegisterId } });
        if (cash.status !== 'ABIERTA')
            throw new Error('La caja no está abierta');
        for (const item of order.items)
            await tx.inventory.update({ where: { variant_id: item.variant_id }, data: { current_stock: { decrement: item.cantidad } } });
        const total = order.items.reduce((sum, item) => sum.plus(item.precio_unitario.mul(item.cantidad)), new Prisma.Decimal(0));
        await tx.cashMovement.create({ data: { cash_register_id: req.cashRegisterId, tipo: 'VENTA', monto: total } });
        await tx.auditLog.create({ data: { user_id: req.userId, accion: 'ORDER_PAID', detalle_json: { orderId: req.orderId, total: total.toString() } } });
        return tx.order.update({ where: { id: req.orderId }, data: { estado: 'PAGADO' } });
    })));
    ipcMain.handle('orders:list', () => wrap(() => getPrisma().order.findMany({ include: { items: true }, orderBy: { created_at: 'desc' } })));
    ipcMain.handle('orders:getById', (_e, id) => wrap(() => getPrisma().order.findUnique({ where: { id }, include: { items: true } })));
}
//# sourceMappingURL=orders.js.map