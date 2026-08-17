import { ipcMain } from 'electron';
import { getPrisma } from '../data/prisma.js';
import type { ProductInput, ProductUpdateRequest, ProductVariantInput } from '../../shared/ipc.js';
import { requireRole, safeDetail, toMoney, wrap } from './helpers.js';

export const PIZZA_SIZES = [
  { nombre: 'Personal', code: 'PZ-PER' },
  { nombre: 'Bipersonal', code: 'PZ-BIP' },
  { nombre: 'Familiar', code: 'PZ-FAM' },
  { nombre: 'Gigante', code: 'PZ-GIG' },
  { nombre: 'Super Gigante', code: 'PZ-SGI' },
] as const;

const mapProduct = (product: any) => ({
  id: product.id,
  codigo: product.id.slice(-8).toUpperCase(),
  nombre: product.nombre,
  descripcion: null,
  categoria: product.categoria,
  tipo: product.tipo ?? inferType(product),
  activo: product.activo ?? true,
  variants: product.variants.map((variant: any) => ({ id: variant.id, sku: variant.inventory_code ?? variant.id.slice(-8).toUpperCase(), nombre: variant.nombre, precio: toMoney(variant.precio), stock: variant.inventory?.current_stock ?? 0, inventoryCode: variant.inventory_code })),
});

function inferType(product: any) {
  if (String(product.categoria).toUpperCase().includes('PIZZA')) return 'PIZZA';
  return product.variants?.length === 1 && product.variants[0]?.nombre === 'Unidad' ? 'SIN_VARIANTES' : 'CON_VARIANTES';
}

function validate(req: ProductInput | ProductUpdateRequest) {
  if (req.nombre !== undefined && !req.nombre.trim()) throw new Error('El nombre es obligatorio');
  if (req.categoria !== undefined && !req.categoria.trim()) throw new Error('La categoría es obligatoria');
  const variants = req.variants ?? [];
  if (req.tipo === 'PIZZA') {
    if (!variants.some((v) => Number(v.precio) > 0)) throw new Error('La pizza debe tener al menos un precio válido');
  } else if (req.tipo === 'SIN_VARIANTES') {
    if (variants.length !== 1 || Number(variants[0].precio) <= 0) throw new Error('Producto sin variantes requiere un precio base mayor a cero');
  } else if (req.tipo === 'CON_VARIANTES') {
    if (!variants.length) throw new Error('Debe registrar al menos una variante');
  }
  for (const variant of variants) {
    if (!variant.nombre.trim()) throw new Error('El nombre de la variante es obligatorio');
    if (!Number.isFinite(Number(variant.precio)) || Number(variant.precio) < 0) throw new Error('El precio no puede ser negativo');
    if ((req.tipo !== 'PIZZA' || Number(variant.precio) > 0) && Number(variant.precio) === 0) throw new Error('El precio debe ser mayor a cero');
    if (!Number.isInteger(variant.stock ?? 0) || (variant.stock ?? 0) < 0) throw new Error('El stock inicial no puede ser negativo');
  }
}

function variantCreateData(v: ProductVariantInput, tipo?: string) {
  const pizza = tipo === 'PIZZA';
  const size = PIZZA_SIZES.find((s) => s.nombre === v.nombre || s.code === v.inventoryCode);
  return { nombre: v.nombre.trim(), precio: v.precio, inventory_code: pizza ? size?.code : v.inventoryCode, inventory: { create: { current_stock: pizza ? 0 : v.stock ?? 0 } } };
}

export async function ensurePizzaDoughInventory(tx: any) {
  for (const size of PIZZA_SIZES) {
    let variant = await tx.productVariant.findFirst({ where: { inventory_code: size.code }, include: { inventory: true } });
    if (!variant) {
      const product = await tx.product.upsert({ where: { id: `pizza-dough-${size.code}` }, update: {}, create: { id: `pizza-dough-${size.code}`, nombre: `Masa ${size.nombre}`, categoria: 'PIZZAS', tipo: 'PIZZA', activo: false } });
      variant = await tx.productVariant.create({ data: { product_id: product.id, nombre: size.nombre, precio: '0', inventory_code: size.code, inventory: { create: { current_stock: 0 } } }, include: { inventory: true } });
    } else if (!variant.inventory) {
      await tx.inventory.create({ data: { variant_id: variant.id, current_stock: 0 } });
    }
  }
}

export function registerProductsIpc() {
  ipcMain.handle('products:list', () => wrap(async () => (await getPrisma().product.findMany({ where: { activo: true }, include: { variants: { include: { inventory: true }, orderBy: { nombre: 'asc' } } }, orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }] })).map(mapProduct)));
  ipcMain.handle('products:create', (_e, req: ProductInput) => wrap(() => getPrisma().$transaction(async (tx) => {
    if (!req.actorId) throw new Error('Usuario requerido');
    await requireRole(tx, req.actorId, ['ADMIN']);
    validate(req);
    if (req.tipo === 'PIZZA') await ensurePizzaDoughInventory(tx);
    const variants = (req.variants ?? []).filter((v) => req.tipo !== 'PIZZA' || Number(v.precio) > 0);
    const product = await tx.product.create({ data: { nombre: req.nombre.trim(), categoria: req.categoria.trim(), tipo: req.tipo, activo: req.activo ?? true, variants: { create: variants.map((v) => variantCreateData(v, req.tipo)) } }, include: { variants: { include: { inventory: true } } } });
    await tx.auditLog.create({ data: { user_id: req.actorId, accion: 'PRODUCT_CREATED', detalle_json: safeDetail({ productId: product.id, tipo: product.tipo }) } });
    return mapProduct(product);
  })));
  ipcMain.handle('products:update', (_e, req: ProductUpdateRequest) => wrap(() => getPrisma().$transaction(async (tx) => {
    if (!req.actorId) throw new Error('Usuario requerido');
    await requireRole(tx, req.actorId, ['ADMIN']);
    validate(req);
    const product = await tx.product.update({ where: { id: req.id }, data: { nombre: req.nombre?.trim(), categoria: req.categoria?.trim(), tipo: req.tipo, activo: req.activo }, include: { variants: { include: { inventory: true } } } });
    for (const variant of req.variants ?? []) {
      if (variant.id) await tx.productVariant.update({ where: { id: variant.id }, data: { nombre: variant.nombre.trim(), precio: variant.precio, inventory_code: variant.inventoryCode } });
      else await tx.productVariant.create({ data: { product_id: req.id, ...variantCreateData(variant, req.tipo ?? product.tipo) } });
    }
    await tx.auditLog.create({ data: { user_id: req.actorId, accion: 'PRODUCT_UPDATED', detalle_json: safeDetail({ productId: req.id }) } });
    return mapProduct(await tx.product.findUniqueOrThrow({ where: { id: product.id }, include: { variants: { include: { inventory: true } } } }));
  })));
}
