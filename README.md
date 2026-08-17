# Life System Solution POS Desktop

POS de escritorio single-tenant construido con Electron, React 18, Vite, Tailwind CSS, TypeScript y PostgreSQL local mediante Prisma.

## Requisitos

- Node.js 20+
- npm
- PostgreSQL local corriendo en `localhost:5432` o el host/puerto que configures
- Una base de datos PostgreSQL creada previamente; la app crea tablas con `prisma migrate deploy`, no instala PostgreSQL

## Desarrollo

```bash
npm install
npm run prisma:generate
npm run dev
```

En el primer arranque, la ventana mostrará una pantalla de configuración para host, puerto, usuario, password y base de datos. Esa configuración se guarda fuera del código fuente en `app.getPath('userData')/config.json`. Después de guardar, la app inyecta `DATABASE_URL` en tiempo de ejecución y ejecuta `prisma migrate deploy` automáticamente.

## Build e instalador Windows

```bash
npm run build
npm run dist
```

`npm run dist` usa `electron-builder` con target NSIS y genera un `.exe` instalable para Windows. El instalador no incluye pasos para instalar PostgreSQL.

## Seguridad de datos

El renderer no importa Prisma ni se conecta a PostgreSQL. Toda comunicación con datos pasa por `window.api`, expuesto en `electron/preload.ts` con `contextBridge`, y handlers `ipcMain` en el proceso principal.

## Modelo de caja y auditoría

Las operaciones financieras se ejecutan con `prisma.$transaction`: validan estado, escriben movimientos de negocio, registran `CashMovement` y agregan `AuditLog` en la misma transacción. El saldo operativo se calcula con agregación de movimientos y también existe la vista SQL `cash_register_balances` en la migración inicial.
