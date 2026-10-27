import { Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../database';

const MIGRATION_ID = '20261027_block_history_and_statuses';

const migrationStatements = [
    `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Transactions' AND column_name = 'status')
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Transactions' AND column_name = 'chainStatus') THEN
            ALTER TABLE "Transactions" RENAME COLUMN "status" TO "chainStatus";
        END IF;
    END $$;`,
    `ALTER TABLE "Transactions" ADD COLUMN IF NOT EXISTS "chainStatus" VARCHAR(20);`,
    `UPDATE "Transactions" SET "chainStatus" = UPPER("chainStatus") WHERE "chainStatus" IS NOT NULL AND "chainStatus" <> UPPER("chainStatus");`,
    `UPDATE "Transactions" SET "chainStatus" = 'SUCCESS' WHERE "chainStatus" IS NULL;`,
    `ALTER TABLE "Transactions" ALTER COLUMN "chainStatus" SET DEFAULT 'SUCCESS';`,
    `ALTER TABLE "Transactions" ALTER COLUMN "chainStatus" SET NOT NULL;`,
    `ALTER TABLE "Transactions" ADD COLUMN IF NOT EXISTS "recordStatus" VARCHAR(20) NOT NULL DEFAULT 'NORMAL';`,
    `ALTER TABLE "TxMatches" ADD COLUMN IF NOT EXISTS "matchStatus" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE';`,
    `UPDATE "TxMatches" SET "matchStatus" = 'FILTER_DELETED' WHERE "txFilterId" IS NULL AND "txFilterDescription" IS NOT NULL AND "matchStatus" = 'ACTIVE';`,
    `DROP INDEX IF EXISTS "transactions_native_identity_unique";`,
    `DROP INDEX IF EXISTS "transactions_erc20_identity_unique";`,
    `CREATE UNIQUE INDEX "transactions_native_identity_unique" ON "Transactions" ("txHash", "transferType", "blockHash") WHERE "transferType" = 'native';`,
    `CREATE UNIQUE INDEX "transactions_erc20_identity_unique" ON "Transactions" ("txHash", "transferType", "logIndex", "blockHash") WHERE "transferType" = 'erc20';`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "blocks_block_hash_unique" ON "Blocks" ("blockHash");`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "blocks_canonical_height_unique" ON "Blocks" ("blockNumber") WHERE "status" = 'CANONICAL';`,
    `CREATE INDEX IF NOT EXISTS "blocks_number_status_index" ON "Blocks" ("blockNumber", "status");`,
];

export async function runMigrations(): Promise<void> {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS "SchemaMigrations" ("id" VARCHAR(255) PRIMARY KEY, "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await sequelize.transaction(async (transaction: SequelizeTransaction) => {
        await sequelize.query('SELECT pg_advisory_xact_lock(20261027)', { transaction });
        const [rows] = await sequelize.query('SELECT "id" FROM "SchemaMigrations" WHERE "id" = :id', { replacements: { id: MIGRATION_ID }, transaction });
        if ((rows as Array<{ id: string }>).length > 0) return;
        for (const statement of migrationStatements) await sequelize.query(statement, { transaction });
        await sequelize.query('INSERT INTO "SchemaMigrations" ("id") VALUES (:id)', { replacements: { id: MIGRATION_ID }, transaction });
    });
}
