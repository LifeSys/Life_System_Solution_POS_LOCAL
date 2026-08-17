# Auditoría de lógica actual — Life System POS Desktop

Fecha: 2026-08-17  
Alcance: Fase 1 solicitada. Este documento audita el estado actual del repositorio después del último commit, sin implementar nuevas funcionalidades ni refactorizar diseño.

## 1. Arquitectura actual

### Stack y capas

- **Desktop:** Electron con `contextBridge` y preload seguro.
- **UI:** React + TypeScript en `src/App.tsx`.
- **Backend local:** handlers IPC en `electron/ipc/*`.
- **Persistencia:** Prisma + PostgreSQL configurado localmente mediante `electron/services/config.ts` y `electron/data/prisma.ts`.
- **Contratos compartidos:** `shared/ipc.ts` define tipos de requests/responses entre renderer e IPC.

### Flujo general de ejecución

1. `src/main.tsx` monta React.
2. `src/App.tsx` consulta `api.config.startupState()`.
3. Si no hay configuración DB, muestra pantalla de configuración PostgreSQL.
4. Si no hay usuario inicial, permite crear ADMIN inicial.
5. Login por PIN contra `auth:login`.
6. Usuario autenticado entra a un layout con módulos según rol.
7. Las acciones operativas van por IPC: productos, inventario, pedidos, caja, usuarios, auditoría.

### Módulos IPC existentes

| Archivo | Responsabilidad actual |
|---|---|
| `electron/ipc/auth.ts` | Login PIN, creación de ADMIN inicial, logout auditado. |
| `electron/ipc/users.ts` | CRUD parcial de usuarios, restringido a ADMIN. |
| `electron/ipc/products.ts` | Listar/crear/actualizar productos y variantes; lógica inicial de tipos de producto y pizza. |
| `electron/ipc/inventory.ts` | Listar inventario y ajustar stock. |
| `electron/ipc/orders.ts` | Crear pedidos, cambiar estados, pagar pedidos y descontar inventario. |
| `electron/ipc/cash.ts` | Apertura/cierre de caja, movimientos, resumen de ventas por método. |
| `electron/ipc/dashboard.ts` | Métricas generales. |
| `electron/ipc/audit.ts` | Listado de auditoría para ADMIN. |
| `electron/ipc/config.ts` | Configuración y healthcheck de PostgreSQL. |

## 2. Modelos Prisma actuales

### Enums

- `UserRole`: `ADMIN`, `CAJERO`, `MESERO`, `COCINA`.
- `OrderStatus`: `ABIERTO`, `PENDIENTE`, `EN_COCINA`, `EN_PREPARACION`, `LISTO`, `ENTREGADO`, `PAGADO`, `CANCELADO`.
- `CashRegisterStatus`: `ABIERTA`, `CERRADA`.
- `ProductType`: `PIZZA`, `CON_VARIANTES`, `SIN_VARIANTES`.
- `PaymentMethod`: `EFECTIVO`, `TARJETA`, `YAPE`.
- `CashClosureStatus`: `CUADRADA`, `DIFERENCIA`.
- `CashMovementType`: `VENTA`, `GASTO`, `APERTURA`, `RETIRO`, `DEPOSITO`, `CAJA_FUERTE_DEPOSITO`, `CAJA_FUERTE_RETIRO`, `TRANSFERENCIA_CAJA_FUERTE`.

### Tablas/modelos

| Modelo | Uso actual | Observaciones |
|---|---|---|
| `User` | Usuarios con PIN hasheado, rol y activo. | No hay sesiones persistentes ni permisos por tabla; los permisos están en handlers IPC. |
| `Product` | Producto comercial con `nombre`, `categoria`, `tipo`, `activo`. | No hay descripción ni timestamps. |
| `ProductVariant` | Variante vendible; contiene `nombre`, `precio`, `inventory_code` opcional. | El `id` es la identificación primaria actual de venta; `inventory_code` se usa para códigos especiales como masas. |
| `Inventory` | Stock por `variant_id`. | Actualmente el inventario está acoplado 1:1 a una variante. |
| `Order` | Pedido con mesa opcional, estado, usuario, fecha. | No hay tabla de mesas, notas, cierres por mesa ni timestamps de estado. |
| `OrderItem` | Ítems del pedido por `variant_id`, cantidad y precio unitario congelado. | El precio se captura al crear el pedido. |
| `CashRegister` | Caja abierta/cerrada, monto inicial y campos de cierre. | No hay tabla separada de cierres; el cierre vive en la caja. |
| `CashMovement` | Movimientos de caja. | Contiene método de pago opcional y detalle JSON. |
| `AuditLog` | Auditoría genérica por usuario, acción y JSON. | No está normalizada por entidad. |

## 3. Flujo Producto → Variante → Inventario → Pedido

### Producto sin variantes

Estado actual esperado por el código:

1. Se crea `Product` con `tipo = SIN_VARIANTES`.
2. Se exige exactamente una variante en backend.
3. Esa variante representa la unidad vendible.
4. Se crea `Inventory` asociado al `variant_id` de esa única variante.
5. En POS, el carrito usa `variantId`.
6. Al confirmar pedido, `orders:create` valida stock de esa variante.
7. En la misma transacción, crea `Order`, `OrderItem` y descuenta `inventory.current_stock` del `variant_id`.

### Producto con variantes

Estado actual esperado por el código:

1. Se crea `Product` con `tipo = CON_VARIANTES`.
2. Cada opción comercial se guarda como `ProductVariant`.
3. Cada variante tiene su propio `Inventory` por `variant_id`.
4. El POS vende una variante específica.
5. El pedido guarda `variant_id` y `precio_unitario`.
6. La deducción de inventario se hace sólo sobre el `variant_id` vendido.

### Qué ocurre al cambiar precios

- El precio vive en `ProductVariant.precio`.
- Al crear un pedido, `orders:create` copia el precio actual a `OrderItem.precio_unitario`.
- Si luego se cambia el precio de una variante, los pedidos ya creados conservan su precio histórico en `OrderItem.precio_unitario`.
- Los nuevos pedidos usarán el nuevo precio.
- Riesgo: no hay auditoría específica de precio anterior/nuevo; `PRODUCT_UPDATED` sólo guarda `productId`.

### Qué ocurre al desactivar un producto

- El modelo `Product` tiene `activo`.
- `products:list` filtra `where: { activo: true }`, por lo que un producto inactivo deja de aparecer para venta/listado operativo.
- `products:update` permite cambiar `activo`.
- No existe handler dedicado de “eliminar”; tampoco hay confirmación backend ni regla explícita para soft-delete si tiene historial.
- Riesgo: si una variante inactiva ya está en pedidos históricos, la relación se conserva; si se hiciera delete físico en el futuro rompería historial.

### Cómo se identifica actualmente una variante

- La variante se identifica por `ProductVariant.id`.
- El frontend y los pedidos usan `variantId` como clave operativa.
- El SKU mostrado es `inventory_code` si existe; si no, deriva de los últimos 8 caracteres del `id`.
- Para variantes normales no hay SKU estable de negocio salvo el `id` generado por Prisma.

### Cómo se relaciona una venta con inventario

- La venta/pedido contiene `OrderItem.variant_id`.
- Inventario usa `Inventory.variant_id` como PK.
- La deducción actual se hace buscando `Inventory` por `variant_id` y decrementando `current_stock`.
- El pago ya no descuenta inventario; el descuento ocurre al crear/confirmar pedido.

## 4. Flujo Pizza → Tamaño/Masa → Inventario → Pedido

### Tamaños oficiales existentes en código

`electron/ipc/products.ts` define actualmente:

| Tamaño | Código global |
|---|---|
| Personal | `PZ-PER` |
| Bipersonal | `PZ-BIP` |
| Familiar | `PZ-FAM` |
| Gigante | `PZ-GIG` |
| Super Gigante | `PZ-SGI` |

### Cómo se identifica actualmente una masa

- La masa se intenta identificar mediante `ProductVariant.inventory_code`.
- Los códigos globales son `PZ-PER`, `PZ-BIP`, `PZ-FAM`, `PZ-GIG`, `PZ-SGI`.
- `ensurePizzaDoughInventory` intenta crear productos operativos `Masa Personal`, `Masa Familiar`, etc. con `activo = false`, y variantes con `inventory_code` global.

### Cómo se relaciona actualmente una pizza con una masa

- Para `tipo = PIZZA`, el producto comercial representa el sabor.
- Cada tamaño con precio válido se guarda como `ProductVariant` del sabor.
- Esa variante recibe `inventory_code` igual al código global de masa.

### Problema crítico detectado en pizza

El schema actual tiene `ProductVariant.inventory_code String? @unique`.

Esto impide que varias pizzas/sabores compartan el mismo código global `PZ-FAM`, porque el código debe ser único en `product_variants`. Por ejemplo:

- Americana Familiar → `inventory_code = PZ-FAM`
- Suprema Familiar → `inventory_code = PZ-FAM`

La segunda inserción violaría el índice único.

Además, `Inventory` sigue ligado a `variant_id`, no a `inventory_code` ni a una unidad de inventario independiente. Por eso, aunque el código pretende que la masa sea global, el modelo sigue forzando stock por variante. La arquitectura todavía no separa correctamente:

- producto comercial,
- variante/precio comercial,
- unidad real de inventario,
- masa global de pizza.

### Consecuencia

La lógica actual no garantiza correctamente que todas las pizzas familiares descuenten el mismo stock `PZ-FAM`. Para lograrlo bien, se requiere una entidad de inventario global o una relación explícita desde variante vendible hacia unidad de inventario.

## 5. Categorías especiales encontradas

Categorías explícitas o implícitas detectadas en el código actual:

- `PIZZAS`: usada por `ensurePizzaDoughInventory` para productos operativos de masa.
- Categoría libre ingresada por usuario en formulario de productos.
- Inferencia legacy: si `categoria` contiene `PIZZA`, `inferType` devuelve `PIZZA`.

No hay catálogo de categorías normalizado. Tampoco hay lista cerrada de `PASTAS`, `BEBIDAS`, `ENTRADAS`, etc. En fases posteriores no se deben inventar categorías nuevas sin migración/decisión explícita; debe trabajarse con las categorías existentes en datos o con un catálogo definido.

## 6. Diferencias con la lógica anterior / lógica objetivo

### Alineado parcialmente

- Ya existen roles básicos.
- Ya existe login por PIN.
- Ya existe `ProductType` con tres tipos lógicos.
- Ya existe precio histórico en `OrderItem.precio_unitario`.
- Ya existe auditoría genérica.
- Ya existe caja y movimientos.
- Ya se filtra navegación en frontend por rol.
- Ya no hay selector visible de locales.

### No alineado o incompleto

- No existe entidad `InventoryItem` independiente de `ProductVariant`.
- No existe separación formal entre variante comercial y unidad de inventario.
- La pizza intenta usar `inventory_code`, pero el `@unique` bloquea que varios sabores compartan una masa.
- `ensurePizzaDoughInventory` crea variantes operativas con `inventory_code`, pero las variantes comerciales de pizza también usan el mismo código; esto genera conflicto conceptual y de DB.
- No hay tabla `PizzaSize`, `PizzaPrice` ni catálogo oficial persistido de tamaños.
- No hay tabla de mesas real.
- No hay flujo real de mesas ocupadas/disponibles/reservadas.
- No hay cocina optimizada por columnas; la UI actual usa tabla genérica de pedidos.
- No hay pagos mixtos en UI, aunque el backend acepta `payments`.
- No hay caja fuerte como módulo completo; sólo tipos de movimiento preparados.
- No hay reportes completos.
- No hay comprobantes internos más allá de placeholder.
- No hay rutas reales en React Router; el control de acceso es por estado de módulo, no por URL.

## 7. Problemas encontrados

### Problemas críticos

1. **Modelo de pizza incorrecto para stock global.** `inventory_code @unique` en `ProductVariant` impide compartir `PZ-FAM` entre múltiples sabores.
2. **Inventario acoplado a variante vendible.** Esto funciona para productos normales, pero no para pizzas con masa global compartida.
3. **Productos operativos de masa y variantes comerciales compiten por el mismo `inventory_code`.** Esto puede causar conflicto al crear pizzas y masas.
4. **El frontend de productos no soporta todavía el formulario real por tipo.** Sólo captura una variante simple.
5. **No hay validación de nombres duplicados de variantes dentro del producto.**
6. **No hay validación estricta de tamaños oficiales de pizza.** `variantCreateData` puede devolver `inventory_code` undefined si el tamaño no coincide.
7. **`products:list` oculta productos inactivos.** Esto es correcto para venta, pero insuficiente para administración, donde se deben ver y reactivar.
8. **No hay gestión real de mesas persistida.** Las mesas en Admin son cards estáticas.
9. **No hay flujo real Mesa → Pedido activo → Cocina → Caja.** Existe pedido con `mesa` opcional, pero no entidad/estado de mesa.
10. **No hay UI para pagos mixtos.** Backend preparado, UI limitada a pago rápido.

### Problemas medios

- `cashSales.orders` cuenta movimientos de venta, no pedidos; un pago mixto genera múltiples movimientos y puede inflar conteo.
- Dashboard calcula ventas desde pedidos pagados, pero caja calcula ventas desde movimientos; pueden divergir si hay pagos mixtos o movimientos manuales mal categorizados.
- Auditoría no registra detalles suficientes para cambios de precio/producto.
- `OrderStatus` tiene estados nuevos, pero UI/semántica cocina aún no están modeladas como flujo operativo.
- `CashMovementType` mezcla caja operativa y caja fuerte, pero no existe entidad separada para caja fuerte/saldo histórico.
- El control de rutas directas no aplica porque no hay rutas; si se introduce routing, debe protegerse en capa de ruta e IPC.

## 8. Riesgos

1. **Riesgo de datos:** migraciones actuales agregan enums/campos, pero no migran productos legacy a tipos correctos de forma completa.
2. **Riesgo de inventario:** pizzas podrían descontar stock por variante de sabor en vez de masa global.
3. **Riesgo de operación:** descontar inventario al crear pedido puede ser correcto si “Enviar a cocina” equivale a confirmar, pero se debe definir reversión si se cancela antes de preparación/pago.
4. **Riesgo de reportes:** caja y dashboard pueden calcular ventas desde fuentes distintas.
5. **Riesgo de permisos:** frontend oculta módulos, IPC protege varias operaciones, pero faltan permisos granulares para futuros endpoints.
6. **Riesgo de UX:** la UI actual no cumple todavía la experiencia operativa solicitada para tablets, cocina y caja.
7. **Riesgo de auditoría:** logs JSON genéricos pueden ser suficientes temporalmente, pero dificultan reportes/auditoría financiera detallada.

## 9. Funcionalidades pendientes

### Datos/modelo

- Crear separación definitiva entre producto comercial, variante/precio comercial y unidad de inventario.
- Resolver pizza global por masa sin inventario por sabor.
- Migrar productos existentes a `SIN_VARIANTES`, `CON_VARIANTES`, `PIZZA` de forma segura.
- Definir catálogo o estrategia de categorías comerciales.
- Crear entidad persistente de mesas.
- Crear entidad/tabla de caja fuerte si se requiere saldo independiente robusto.

### Backend

- Validaciones completas por tipo de producto.
- Validación de variantes duplicadas.
- Validación estricta de tamaños oficiales de pizza.
- Soft-delete/activar/desactivar producto con reglas por historial.
- Auditoría detallada de cambios de precio, cambios de stock, cancelaciones y reversión de inventario.
- Reportes consistentes desde una fuente de verdad.

### Frontend

- Administración de productos con formulario dinámico por tipo.
- Gestión de variantes múltiples.
- Gestión visual de precios por tamaño para pizza.
- Lista de productos agrupada por categoría.
- Pantalla real de mesas con estados y pedido activo.
- Flujo rápido de mesero con búsqueda/categorías/carrito.
- Cocina por columnas/tarjetas.
- Caja con pagos mixtos en UI, pedidos por cobrar, cierre y caja fuerte.
- Reportes y comprobantes internos.

## 10. Plan recomendado de implementación por fases

### Fase 2 — Modelo definitivo de productos, variantes e inventario

Objetivo: corregir la base de datos antes de tocar UI.

Archivos a modificar:

- `prisma/schema.prisma`
- nueva migración en `prisma/migrations/*`
- `shared/ipc.ts`
- `electron/ipc/products.ts`
- `electron/ipc/inventory.ts`
- `electron/ipc/orders.ts`
- opcional: seed si se agrega/encuentra archivo de seed
- nuevo documento `docs/PRODUCT_MODEL.md`

Decisiones recomendadas:

- Introducir una entidad `InventoryItem` o equivalente con código único de inventario.
- Mantener `ProductVariant` como variante comercial vendible.
- Agregar relación de `ProductVariant` hacia `InventoryItem` para consumo de stock.
- Para pizzas, todas las variantes comerciales de tamaño familiar deben apuntar al mismo `InventoryItem(code='PZ-FAM')`.
- Eliminar el uso de `ProductVariant.inventory_code @unique` como fuente de verdad para stock global; reemplazarlo por FK a unidad de inventario.
- Migrar variantes existentes a unidades de inventario sin borrar datos.

### Fase 3 — Administración de productos y UX

Archivos a modificar:

- `src/App.tsx` o componentes nuevos bajo `src/components/products/*` si se divide UI.
- `shared/ipc.ts`
- `electron/ipc/products.ts`
- `electron/ipc/inventory.ts`
- tests/manual test notes si existen.

Objetivo:

- Formulario real por tipo.
- Variantes dinámicas.
- Pizza con precios por tamaño y códigos globales no editables.
- Lista compacta agrupada por categoría.
- Soft-delete con `activo=false`.

### Fase 4 — Mesas y flujo mesero

Archivos a modificar:

- `prisma/schema.prisma`
- migración de `Table`/`DiningTable` y relación con `Order`
- `shared/ipc.ts`
- nuevo `electron/ipc/tables.ts`
- `electron/ipc/orders.ts`
- `electron/main.ts`
- `electron/preload.cts`
- UI de Mesas/POS en `src/App.tsx` o componentes separados

Objetivo:

- Mesa disponible/ocupada/reservada.
- Pedido activo por mesa.
- Búsqueda, categorías, productos agrupados, carrito y envío a cocina.

### Fase 5 — Cocina operativa

Archivos a modificar:

- `electron/ipc/orders.ts`
- `shared/ipc.ts`
- UI de Cocina
- potencialmente schema para timestamps de estado/item.

Objetivo:

- Columnas Nuevos / En preparación / Listos.
- Transiciones controladas.
- Auditoría de cambios.

### Fase 6 — Caja, pagos mixtos, cierres y caja fuerte

Archivos a modificar:

- `prisma/schema.prisma`
- migración para caja fuerte si aplica
- `electron/ipc/cash.ts`
- `electron/ipc/orders.ts`
- `shared/ipc.ts`
- UI de Caja

Objetivo:

- Pedidos por cobrar.
- Pago rápido y mixto.
- Cierre con contado/diferencia.
- Caja fuerte con saldo y movimientos auditados.

### Fase 7 — Reportes y comprobantes internos

Archivos a modificar:

- `electron/ipc/dashboard.ts`
- nuevo `electron/ipc/reports.ts`
- `electron/main.ts`
- `electron/preload.cts`
- `shared/ipc.ts`
- UI Reportes/Comprobantes

Objetivo:

- Reportes por día/período/producto/categoría/tamaño/método.
- Comprobantes internos sin SUNAT.

## Conclusión de auditoría

El sistema tiene una base funcional para usuarios, productos, inventario, pedidos, caja y auditoría. Sin embargo, la lógica de pizzas globales por masa todavía no está correctamente representada en el modelo relacional porque el inventario sigue unido a `ProductVariant` y `inventory_code` es único en la variante. La siguiente fase debe corregir primero el modelo de datos y las validaciones backend antes de continuar con formularios avanzados o rediseño de UI.
