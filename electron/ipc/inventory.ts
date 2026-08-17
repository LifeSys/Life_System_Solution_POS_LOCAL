import { ipcMain } from 'electron';
import { getPrisma } from '../data/prisma.js';
import type { InventoryAdjustRequest } from '../../shared/ipc.js';
const wrap = async <T>(fn: () => Promise<T>) => { try { return { ok: true as const, data: await fn() }; } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : 'Unknown error' }; } };
export function registerInventoryIpc() {
  ipcMain.handle('inventory:get', () => wrap(() => getPrisma().inventory.findMany({ include: { variant: { include: { product: true } } } })));
  ipcMain.handle('inventory:adjust', (_e, req: InventoryAdjustRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    const inventory = await tx.inventory.upsert({ where: { variant_id: req.variantId }, update: { current_stock: { increment: req.delta } }, create: { variant_id: req.variantId, current_stock: req.delta } });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: 'INVENTORY_ADJUSTED', detalle_json: req } });
    return inventory;
  })));
}
