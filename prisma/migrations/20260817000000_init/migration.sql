CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CAJERO', 'MESERO', 'COCINA');
CREATE TYPE "OrderStatus" AS ENUM ('PENDIENTE', 'EN_COCINA', 'LISTO', 'PAGADO', 'CANCELADO');
CREATE TYPE "CashRegisterStatus" AS ENUM ('ABIERTA', 'CERRADA');
CREATE TYPE "CashMovementType" AS ENUM ('VENTA', 'GASTO', 'APERTURA', 'RETIRO', 'DEPOSITO');

CREATE TABLE "users" ("id" TEXT NOT NULL, "nombre" TEXT NOT NULL, "pin_hash" TEXT NOT NULL, "rol" "UserRole" NOT NULL, "activo" BOOLEAN NOT NULL DEFAULT true, CONSTRAINT "users_pkey" PRIMARY KEY ("id"));
CREATE TABLE "products" ("id" TEXT NOT NULL, "nombre" TEXT NOT NULL, "categoria" TEXT NOT NULL, CONSTRAINT "products_pkey" PRIMARY KEY ("id"));
CREATE TABLE "product_variants" ("id" TEXT NOT NULL, "product_id" TEXT NOT NULL, "nombre" TEXT NOT NULL, "precio" DECIMAL(12,2) NOT NULL, CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"));
CREATE TABLE "inventory" ("variant_id" TEXT NOT NULL, "current_stock" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "inventory_pkey" PRIMARY KEY ("variant_id"));
CREATE TABLE "orders" ("id" TEXT NOT NULL, "mesa" TEXT, "estado" "OrderStatus" NOT NULL DEFAULT 'PENDIENTE', "user_id" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "orders_pkey" PRIMARY KEY ("id"));
CREATE TABLE "order_items" ("id" TEXT NOT NULL, "order_id" TEXT NOT NULL, "variant_id" TEXT NOT NULL, "cantidad" INTEGER NOT NULL, "precio_unitario" DECIMAL(12,2) NOT NULL, CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"));
CREATE TABLE "cash_registers" ("id" TEXT NOT NULL, "opened_by" TEXT NOT NULL, "initial_amount" DECIMAL(12,2) NOT NULL, "status" "CashRegisterStatus" NOT NULL DEFAULT 'ABIERTA', "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "closed_at" TIMESTAMP(3), CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id"));
CREATE TABLE "cash_movements" ("id" TEXT NOT NULL, "cash_register_id" TEXT NOT NULL, "tipo" "CashMovementType" NOT NULL, "monto" DECIMAL(12,2) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id"));
CREATE TABLE "audit_logs" ("id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "accion" TEXT NOT NULL, "detalle_json" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"));

ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE VIEW "cash_register_balances" AS SELECT "cash_register_id", COALESCE(SUM("monto"), 0)::DECIMAL(12,2) AS "balance" FROM "cash_movements" GROUP BY "cash_register_id";
