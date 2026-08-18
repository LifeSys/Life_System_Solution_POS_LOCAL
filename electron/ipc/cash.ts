import { ipcMain } from 'electron';
import { getPrisma } from '../data/prisma.js';
import type { CashCloseRequest, CashMovementRequest, CashOpenRequest } from '../../shared/ipc.js';
import { requireRole, safeDetail, toMoney, wrap } from './helpers.js';

const includeCash = { openedBy: true, movements: { orderBy: { created_at: 'desc' as const } } };
async function cashSales(cashId: string, tx: any, initial: any = 0) {
  const movements = await tx.cashMovement.findMany({ where: { cash_register_id: cashId, tipo: 'VENTA' } });
  const by = (method: string) => movements.filter((m: any) => m.payment_method === method).reduce((s: number, m: any) => s + Number(m.monto), 0);
  const efectivo = by('EFECTIVO'), tarjeta = by('TARJETA'), yape = by('YAPE');
  const total = efectivo + tarjeta + yape;
  return { efectivo: toMoney(efectivo), tarjeta: toMoney(tarjeta), yape: toMoney(yape), total: toMoney(total), orders: movements.length, averageTicket: toMoney(movements.length ? total / movements.length : 0), expectedCash: toMoney(Number(initial) + efectivo) };
}

async function getCloseSummary(cashId: string, tx: any) {
  const cash = await tx.cashRegister.findUnique({ where: { id: cashId }, include: includeCash });
  if (!cash) throw new Error('La caja no existe');
  const movements = cash.movements;
  const salesBy = (method: string | null) => movements.filter((m: any) => m.tipo === 'VENTA' && m.payment_method === method).reduce((sum: number, m: any) => sum + Number(m.monto), 0);
  const efectivo = salesBy('EFECTIVO');
  const tarjeta = salesBy('TARJETA');
  const yape = salesBy('YAPE');
  const totalSales = efectivo + tarjeta + yape;
  const ingresos = movements.filter((m: any) => ['INGRESO', 'DEPOSITO'].includes(m.tipo)).reduce((sum: number, m: any) => sum + Number(m.monto), 0);
  const gastos = Math.abs(movements.filter((m: any) => m.tipo === 'GASTO').reduce((sum: number, m: any) => sum + Number(m.monto), 0));
  const retiros = Math.abs(movements.filter((m: any) => m.tipo === 'RETIRO').reduce((sum: number, m: any) => sum + Number(m.monto), 0));
  const expected = Number(cash.initial_amount) + efectivo + ingresos - gastos - retiros;
  return {
    cashRegisterId: cash.id,
    initialAmount: toMoney(cash.initial_amount),
    sales: { efectivo: toMoney(efectivo), tarjeta: toMoney(tarjeta), yape: toMoney(yape), mixto: toMoney(0), total: toMoney(totalSales) },
    manual: { ingresos: toMoney(ingresos), gastos: toMoney(gastos), retiros: toMoney(retiros) },
    expectedCash: toMoney(expected),
    countedCash: cash.counted_cash == null ? null : toMoney(cash.counted_cash),
    difference: cash.difference == null ? null : toMoney(cash.difference),
    movements: movements.map((m: any) => ({ id: m.id, tipo: m.tipo, monto: toMoney(m.monto), createdAt: m.created_at.toISOString(), paymentMethod: m.payment_method, detalle: m.detalle_json })),
  };
}

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
    countedCash: cash.counted_cash == null ? null : toMoney(cash.counted_cash),
    expectedCash: cash.expected_cash == null ? null : toMoney(cash.expected_cash),
    difference: cash.difference == null ? null : toMoney(cash.difference),
    sales: await cashSales(cash.id, tx, cash.initial_amount),
    movements: cash.movements.map((m: any) => ({ id: m.id, tipo: m.tipo, monto: toMoney(m.monto), createdAt: m.created_at.toISOString(), paymentMethod: m.payment_method, detalle: m.detalle_json })),
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
    const summary = await getCloseSummary(existing.id, tx);
    const counted = req.countedCash ?? summary.expectedCash;
    const diff = Number(counted) - Number(summary.expectedCash);
    const cash = await tx.cashRegister.update({ where: { id: req.cashRegisterId }, data: { status: 'CERRADA', closed_at: new Date(), counted_cash: counted, expected_cash: summary.expectedCash, difference: diff.toFixed(2), closure_status: Math.abs(diff) < 0.01 ? 'CUADRADA' : 'DIFERENCIA' }, include: includeCash });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: 'CASH_CLOSED', detalle_json: safeDetail({ cashRegisterId: cash.id, summary, countedCash: counted, difference: diff.toFixed(2) }) } });
    return mapCash(cash, tx);
  })));
  ipcMain.handle('cash:registerMovement', (_e, req: CashMovementRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO']);
    if (Number(req.monto) <= 0) throw new Error('El monto debe ser mayor a cero');
    const cash = req.cashRegisterId ? await tx.cashRegister.findUnique({ where: { id: req.cashRegisterId }, include: includeCash }) : await tx.cashRegister.findFirst({ where: { status: 'ABIERTA' }, include: includeCash, orderBy: { opened_at: 'desc' } });
    if (!cash) throw new Error('La caja no existe');
    if (cash.status !== 'ABIERTA') throw new Error('La caja no está abierta');
    const tipo = req.tipo === 'DEPOSITO' ? 'INGRESO' : req.tipo;
    const signed = tipo === 'GASTO' || tipo === 'RETIRO' ? `-${req.monto}` : req.monto;
    const balance = await tx.cashMovement.aggregate({ where: { cash_register_id: cash.id }, _sum: { monto: true } });
    if (Number(balance._sum.monto ?? 0) + Number(signed) < 0) throw new Error('El movimiento dejaría saldo negativo');
    await tx.cashMovement.create({ data: { cash_register_id: cash.id, tipo, monto: signed, detalle_json: safeDetail(req.detalle ?? {}) } });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: `CASH_${tipo}`, detalle_json: safeDetail({ cashRegisterId: cash.id, tipo, monto: signed, detalle: req.detalle }) } });
    return mapCash(await tx.cashRegister.findUniqueOrThrow({ where: { id: cash.id }, include: includeCash }), tx);
  })));
  ipcMain.handle('cash:getSummary', (_e, cashRegisterId?: string) => wrap(async () => {
    const prisma = getPrisma();
    const cash = cashRegisterId ? await prisma.cashRegister.findUnique({ where: { id: cashRegisterId } }) : await prisma.cashRegister.findFirst({ where: { status: 'ABIERTA' }, orderBy: { opened_at: 'desc' } });
    if (!cash) throw new Error('No hay una caja abierta');
    return getCloseSummary(cash.id, prisma);
  }));
  ipcMain.handle('cash:getBalance', (_e, cashRegisterId: string) => wrap(async () => {
    const prisma = getPrisma();
    const cash = await prisma.cashRegister.findUnique({ where: { id: cashRegisterId } });
    if (!cash) throw new Error('La caja no existe');
    const result = await prisma.cashMovement.aggregate({ where: { cash_register_id: cashRegisterId }, _sum: { monto: true } });
    return toMoney(result._sum.monto ?? 0);
  }));
}
