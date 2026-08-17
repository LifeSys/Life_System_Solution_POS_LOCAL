# Life System Solution POS Desktop

POS de escritorio local construido con Electron, React 18, Vite, TypeScript, Prisma 6.19.3 y PostgreSQL local.

## Requisitos

- Windows 10/11 para el uso final del instalador.
- Node.js 20+ y npm.
- PostgreSQL local instalado y ejecutándose.
- Una base de datos PostgreSQL creada previamente. La aplicación ejecuta migraciones, pero no instala PostgreSQL ni crea el servidor.

## Instalación

```bash
git clone https://github.com/LifeSys/Life_System_Solution_POS_LOCAL.git
cd Life_System_Solution_POS_LOCAL
npm install
npm run prisma:generate
```

## Configuración de PostgreSQL

1. Verifica que PostgreSQL esté iniciado.
2. Crea la base de datos que usará el POS, por ejemplo `postgres1`.
3. Conserva a mano estos datos: host, puerto, usuario, contraseña y nombre de base.

Ejemplo de conexión local:

- Host: `localhost`
- Puerto: `5432`
- Usuario: `postgres`
- Password: la contraseña local de PostgreSQL
- Base de datos: `postgres1`

Electron no depende obligatoriamente de un archivo `.env`: durante el arranque construye `DATABASE_URL` desde `app.getPath('userData')/config.json`. La contraseña se usa para conectarse, pero no debe imprimirse en logs.

Para usar herramientas CLI de Prisma manualmente en PowerShell puedes definir `DATABASE_URL` antes del comando:

```powershell
$env:DATABASE_URL = "postgresql://postgres:TU_PASSWORD@localhost:5432/postgres1?schema=public"
npm run prisma:migrate
npx prisma migrate status --schema prisma/schema.prisma
```

El arranque automático usa únicamente `prisma migrate deploy`; no ejecuta `prisma migrate reset`.

## Desarrollo

```bash
npm run dev
```

El comando inicia Vite, compila el proceso principal de Electron y abre Electron automáticamente. No abras `http://localhost:5173/` directamente en un navegador para probar IPC, porque `window.api` solo existe dentro de Electron mediante `electron/preload.cts`.

## Build

```bash
npm run build
```

Este comando ejecuta TypeScript, construye el renderer en `dist-renderer/` y compila Electron en `dist-electron/`.

## Instalador

```bash
npm run dist
```

`electron-builder` genera el instalador. La configuración incluye el esquema y migraciones de Prisma, y desempaqueta los archivos necesarios de Prisma para poder ejecutar `prisma migrate deploy` sin depender de `npx`, npm global ni descargas de Internet durante la ejecución de la app.

## Primer arranque

Si no existe configuración, la aplicación muestra **Configurar PostgreSQL local**. Al guardar los datos:

1. Se guarda `userData/config.json` con `host`, `port`, `user`, `password` y `database`.
2. Se prueba la conexión a PostgreSQL.
3. Se ejecuta `prisma migrate deploy` con `prisma/schema.prisma`.
4. Si la base no tiene usuarios, se muestra la pantalla para crear el primer ADMIN.
5. Después de crear el ADMIN inicial, se muestra el login por PIN.

No existe un PIN hardcodeado. El primer PIN ADMIN lo define el usuario en el wizard inicial.

## Errores controlados

Si PostgreSQL está apagado, el puerto es incorrecto, la contraseña no coincide, la base de datos no existe o falla una migración, Electron debe permanecer abierto y mostrar un error legible. El detalle de Prisma se conserva para diagnóstico, pero se redactan contraseñas.

## Comandos útiles

```bash
npm run prisma:generate
npm run typecheck
npm run build
npm run dist
```

## Archivos generados

No deben versionarse `node_modules/`, `dist-electron/`, `dist-renderer/`, logs, `.env*` ni `userData/`. Sí deben versionarse `prisma/schema.prisma`, `prisma/migrations/`, `package.json`, `package-lock.json`, `src/`, `electron/` y `shared/`.
