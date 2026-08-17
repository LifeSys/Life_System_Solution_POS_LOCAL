import { ipcMain } from 'electron';
import { getPrisma } from '../data/prisma.js';
const wrap = async (fn) => { try {
    return { ok: true, data: await fn() };
}
catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
} };
export function registerProductsIpc() {
    ipcMain.handle('products:list', () => wrap(() => getPrisma().product.findMany({ include: { variants: { include: { inventory: true } } } })));
    ipcMain.handle('products:create', (_e, req) => wrap(() => getPrisma().product.create({ data: { nombre: req.nombre, categoria: req.categoria, variants: { create: req.variants?.map((v) => ({ nombre: v.nombre, precio: v.precio, inventory: { create: { current_stock: v.stock ?? 0 } } })) ?? [] } }, include: { variants: true } })));
    ipcMain.handle('products:update', (_e, req) => wrap(() => getPrisma().product.update({ where: { id: req.id }, data: { nombre: req.nombre, categoria: req.categoria } })));
}
//# sourceMappingURL=products.js.map