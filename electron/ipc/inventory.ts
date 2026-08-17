import { ipcMain } from 'electron';
import { getPrisma } from '../data/prisma.js';
import type { InventoryAdjustRequest } from '../../shared/ipc.js';
import { requireRole, safeDetail, toMoney, wrap } from './helpers.js';

const stockState = (stock: number) => stock <= 0 ? 'sin_stock' : stock <= 5 ? 'stock_bajo' : 'normal';
const mapInventory = (inventory: any) => ({ variantId: inventory.variant_id, productId: inventory.variant.product.id, sku: inventory.variant_id.slice(-8).toUpperCase(), producto: inventory.variant.product.nombre, variante: inventory.variant.nombre, precio: toMoney(inventory.variant.precio), stock: inventory.current_stock, estado: stockState(inventory.current_stock) });

export function registerInventoryIpc() {
  ipcMain.handle('inventory:get', () => wrap(async () => (await getPrisma().inventory.findMany({ include: { variant: { include: { product: true } } }, orderBy: { variant: { nombre: 'asc' } } })).map(mapInventory)));
  ipcMain.handle('inventory:adjust', (_e, req: InventoryAdjustRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    await requireRole(tx, req.userId, ['ADMIN', 'CAJERO']);
    if (!Number.isInteger(req.delta) || req.delta === 0) throw new Error('El ajuste debe ser un número entero distinto de 0');
    const variant = await tx.productVariant.findUnique({ where: { id: req.variantId } });
    if (!variant) throw new Error('La variante no existe');
    const current = await tx.inventory.findUnique({ where: { variant_id: req.variantId } });
    if ((current?.current_stock ?? 0) + req.delta < 0) throw new Error('No se puede reducir el stock por debajo de 0');
    const inventory = await tx.inventory.upsert({ where: { variant_id: req.variantId }, update: { current_stock: { increment: req.delta } }, create: { variant_id: req.variantId, current_stock: req.delta }, include: { variant: { include: { product: true } } } });
    await tx.auditLog.create({ data: { user_id: req.userId, accion: 'INVENTORY_ADJUSTED', detalle_json: safeDetail({ variantId: req.variantId, productId: inventory.variant.product.id, producto: inventory.variant.product.nombre, variante: inventory.variant.nombre, previousStock: current?.current_stock ?? 0, newStock: inventory.current_stock, delta: req.delta, reason: req.reason }) } });
    return mapInventory(inventory);
  })));
}
