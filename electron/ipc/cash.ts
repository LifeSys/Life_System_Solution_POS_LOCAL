import { ipcMain } from 'electron';
import { getPrisma } from '../data/prisma.js';
import type { CashCloseRequest, CashMovementRequest, CashOpenRequest } from '../../shared/ipc.js';
import { requireRole, safeDetail, toMoney, wrap } from './helpers.js';

const includeCash = { openedBy: true, movements: { orderBy: { created_at: 'desc' as const } } };
const mapCash = async (cash: any, tx: any = getPrisma()) => {
  const result = await tx.cashMovement.aggregate({ where: { cash_register_id: cash.id }, _sum: { monto: true } });
  return {
    id: cash.id,
    openedBy: cash.opened_by,
    openedByName: cash.openedBy?.nombre ?? 'Usuario',
    initialAmount: toMoney(cash.initial_amount),
    status: cash.status,
    openedAt: cash.opened_at.toISOString(),
    closedAt: cash.closed_at?.toISOString() ?? null,
    balance: toMoney(result._sum.monto ?? 0),
    movements: cash.movements.map((m: any) => ({ id: m.id, tipo: m.tipo, monto: toMoney(m.monto), createdAt: m.created_at.toISOString() })),
  };
};

export function registerCashIpc() {
  ipcMain.handle('cash:current', () => wrap(async () => {
    const cash = await getPrisma().cashRegister.findFirst({ where: { status: 'ABIERTA' }, include: includeCash, orderBy: { opened_at: 'desc' } });
    return cash ? mapCash(cash) : null;
  }));
  ipcMain.handle('cash:list', () => wrap(async () => Promise.all((await getPrisma().cashRegister.findMany({ include: includeCash, orderBy: { opened_at: 'desc' }, take: 20 })).map((cash) => mapCash(cash)))));
  ipcMain.handle('cash:open', (_e, req: CashOpenRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO']);
    if (Number(req.initialAmount) < 0) throw new Error('El monto inicial no puede ser negativo');
    const openCash = await tx.cashRegister.findFirst({ where: { status: 'ABIERTA' } });
    if (openCash) throw new Error('Ya existe una caja abierta');
    const cash = await tx.cashRegister.create({ data: { opened_by: req.userId, initial_amount: req.initialAmount, movements: { create: { tipo: 'APERTURA', monto: req.initialAmount } } }, include: includeCash });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: 'CASH_OPENED', detalle_json: safeDetail({ cashRegisterId: cash.id, initialAmount: req.initialAmount }) } });
    return mapCash(cash, tx);
  })));
  ipcMain.handle('cash:close', (_e, req: CashCloseRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO']);
    const existing = await tx.cashRegister.findUnique({ where: { id: req.cashRegisterId }, include: includeCash });
    if (!existing) throw new Error('La caja no existe');
    if (existing.status === 'CERRADA') throw new Error('La caja ya está cerrada');
    const cash = await tx.cashRegister.update({ where: { id: req.cashRegisterId }, data: { status: 'CERRADA', closed_at: new Date() }, include: includeCash });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: 'CASH_CLOSED', detalle_json: safeDetail({ cashRegisterId: cash.id }) } });
    return mapCash(cash, tx);
  })));
  ipcMain.handle('cash:registerMovement', (_e, req: CashMovementRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO']);
    if (req.tipo === 'VENTA') throw new Error('Las ventas se registran al pagar un pedido');
    if (Number(req.monto) <= 0) throw new Error('El monto debe ser mayor a cero');
    const cash = await tx.cashRegister.findUnique({ where: { id: req.cashRegisterId }, include: includeCash });
    if (!cash) throw new Error('La caja no existe');
    if (cash.status !== 'ABIERTA') throw new Error('La caja no está abierta');
    const signed = req.tipo === 'GASTO' || req.tipo === 'RETIRO' ? `-${req.monto}` : req.monto;
    const balance = await tx.cashMovement.aggregate({ where: { cash_register_id: req.cashRegisterId }, _sum: { monto: true } });
    if (Number(balance._sum.monto ?? 0) + Number(signed) < 0) throw new Error('El movimiento dejaría saldo negativo');
    await tx.cashMovement.create({ data: { cash_register_id: req.cashRegisterId, tipo: req.tipo, monto: signed } });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: `CASH_${req.tipo}`, detalle_json: safeDetail({ cashRegisterId: req.cashRegisterId, tipo: req.tipo, monto: signed, detalle: req.detalle }) } });
    return mapCash(await tx.cashRegister.findUniqueOrThrow({ where: { id: req.cashRegisterId }, include: includeCash }), tx);
  })));
  ipcMain.handle('cash:getBalance', (_e, cashRegisterId: string) => wrap(async () => {
    const prisma = getPrisma();
    const cash = await prisma.cashRegister.findUnique({ where: { id: cashRegisterId } });
    if (!cash) throw new Error('La caja no existe');
    const result = await prisma.cashMovement.aggregate({ where: { cash_register_id: cashRegisterId }, _sum: { monto: true } });
    return toMoney(result._sum.monto ?? 0);
  }));
}
