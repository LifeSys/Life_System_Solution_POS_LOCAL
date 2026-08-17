CREATE TYPE "TableStatus" AS ENUM ('DISPONIBLE', 'OCUPADA', 'RESERVADA');
CREATE TABLE IF NOT EXISTS "restaurant_tables" (
  "id" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "capacidad" INTEGER NOT NULL DEFAULT 4,
  "estado" "TableStatus" NOT NULL DEFAULT 'DISPONIBLE',
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_tables_nombre_key" ON "restaurant_tables"("nombre");
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "table_id" TEXT;
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "restaurant_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS "payments" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "received_amount" DECIMAL(12,2),
  "change_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
INSERT INTO "restaurant_tables" ("id", "nombre", "capacidad", "estado", "activa")
SELECT 'table-' || gs::text, 'Mesa ' || gs::text, 4, 'DISPONIBLE', true FROM generate_series(1, 12) AS gs
ON CONFLICT ("nombre") DO NOTHING;
