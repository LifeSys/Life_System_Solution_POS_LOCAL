import { ipcMain } from 'electron';
import { getPrisma } from '../data/prisma.js';
import type { ProductInput, ProductUpdateRequest } from '../../shared/ipc.js';
import { requireRole, safeDetail, toMoney, wrap } from './helpers.js';

const mapProduct = (product: any) => ({
  id: product.id,
  nombre: product.nombre,
  categoria: product.categoria,
  variants: product.variants.map((variant: any) => ({ id: variant.id, nombre: variant.nombre, precio: toMoney(variant.precio), stock: variant.inventory?.current_stock ?? 0 })),
});

export function registerProductsIpc() {
  ipcMain.handle('products:list', () => wrap(async () => (await getPrisma().product.findMany({ include: { variants: { include: { inventory: true }, orderBy: { nombre: 'asc' } } }, orderBy: { nombre: 'asc' } })).map(mapProduct)));
  ipcMain.handle('products:create', (_e, req: ProductInput) => wrap(() => getPrisma().$transaction(async (tx) => {
    if (!req.actorId) throw new Error('Usuario requerido');
    await requireRole(tx, req.actorId, ['ADMIN']);
    if (!req.nombre.trim() || !req.categoria.trim()) throw new Error('Nombre y categoría son obligatorios');
    const variants = req.variants ?? [];
    for (const variant of variants) {
      if (!variant.nombre.trim()) throw new Error('El nombre de la variante es obligatorio');
      if (Number(variant.precio) < 0) throw new Error('El precio no puede ser negativo');
      if ((variant.stock ?? 0) < 0) throw new Error('El stock inicial no puede ser negativo');
    }
    const product = await tx.product.create({ data: { nombre: req.nombre.trim(), categoria: req.categoria.trim(), variants: { create: variants.map((v) => ({ nombre: v.nombre.trim(), precio: v.precio, inventory: { create: { current_stock: v.stock ?? 0 } } })) } }, include: { variants: { include: { inventory: true } } } });
    await tx.auditLog.create({ data: { user_id: req.actorId, accion: 'PRODUCT_CREATED', detalle_json: safeDetail({ productId: product.id, nombre: product.nombre }) } });
    return mapProduct(product);
  })));
  ipcMain.handle('products:update', (_e, req: ProductUpdateRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    if (!req.actorId) throw new Error('Usuario requerido');
    await requireRole(tx, req.actorId, ['ADMIN']);
    const product = await tx.product.update({ where: { id: req.id }, data: { nombre: req.nombre?.trim(), categoria: req.categoria?.trim() }, include: { variants: { include: { inventory: true } } } });
    for (const variant of req.variants ?? []) {
      if (Number(variant.precio) < 0) throw new Error('El precio no puede ser negativo');
      if (variant.id) {
        await tx.productVariant.update({ where: { id: variant.id }, data: { nombre: variant.nombre.trim(), precio: variant.precio } });
      } else {
        if ((variant.stock ?? 0) < 0) throw new Error('El stock inicial no puede ser negativo');
        await tx.productVariant.create({ data: { product_id: req.id, nombre: variant.nombre.trim(), precio: variant.precio, inventory: { create: { current_stock: variant.stock ?? 0 } } } });
      }
    }
    await tx.auditLog.create({ data: { user_id: req.actorId, accion: 'PRODUCT_UPDATED', detalle_json: safeDetail({ productId: req.id }) } });
    return mapProduct(await tx.product.findUniqueOrThrow({ where: { id: product.id }, include: { variants: { include: { inventory: true } } } }));
  })));
}
