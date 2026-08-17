import { ipcMain } from 'electron';
import { getPrisma } from '../data/prisma.js';
const wrap = async (fn) => { try {
    return { ok: true, data: await fn() };
}
catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
} };
export function registerCashIpc() {
    ipcMain.handle('cash:open', (_e, req) => wrap(() => getPrisma().$transaction(async (tx) => {
        const cash = await tx.cashRegister.create({ data: { opened_by: req.userId, initial_amount: req.initialAmount, movements: { create: { tipo: 'APERTURA', monto: req.initialAmount } } } });
        await tx.auditLog.create({ data: { user_id: req.userId, accion: 'CASH_OPENED', detalle_json: { cashRegisterId: cash.id, initialAmount: req.initialAmount } } });
        return cash;
    })));
    ipcMain.handle('cash:close', (_e, req) => wrap(() => getPrisma().$transaction(async (tx) => {
        const cash = await tx.cashRegister.update({ where: { id: req.cashRegisterId }, data: { status: 'CERRADA', closed_at: new Date() } });
        await tx.auditLog.create({ data: { user_id: req.userId, accion: 'CASH_CLOSED', detalle_json: { cashRegisterId: cash.id } } });
        return cash;
    })));
    ipcMain.handle('cash:registerMovement', (_e, req) => wrap(() => getPrisma().$transaction(async (tx) => {
        const cash = await tx.cashRegister.findUniqueOrThrow({ where: { id: req.cashRegisterId } });
        if (cash.status !== 'ABIERTA')
            throw new Error('La caja no está abierta');
        const signed = req.tipo === 'GASTO' || req.tipo === 'RETIRO' ? `-${req.monto}` : req.monto;
        const movement = await tx.cashMovement.create({ data: { cash_register_id: req.cashRegisterId, tipo: req.tipo, monto: signed } });
        await tx.auditLog.create({
            data: {
                user_id: req.userId,
                accion: `CASH_${req.tipo}`,
                detalle_json: JSON.parse(JSON.stringify({ ...req, monto: signed })),
            },
        });
        return movement;
    })));
    ipcMain.handle('cash:getBalance', (_e, cashRegisterId) => wrap(async () => {
        const result = await getPrisma().cashMovement.aggregate({ where: { cash_register_id: cashRegisterId }, _sum: { monto: true } });
        return result._sum.monto?.toString() ?? '0.00';
    }));
}
//# sourceMappingURL=cash.js.map