import { Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../database';

const MIGRATION_ID = '20261027_block_history_and_statuses';
const REORG_MIGRATION_ID = '20261027_reorg_recovery_state';

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

const reorgRecoveryStatements = [
    `ALTER TABLE "ScannerStates" ADD COLUMN IF NOT EXISTS "reorgRecoveryActive" BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE "ScannerStates" ADD COLUMN IF NOT EXISTS "reorgRecoveryStableBlocks" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "ScannerStates" ADD COLUMN IF NOT EXISTS "reorgRecoveryStartBlock" INTEGER;`,
];

export async function runMigrations(): Promise<void> {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS "SchemaMigrations" ("id" VARCHAR(255) PRIMARY KEY, "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await sequelize.transaction(async (transaction: SequelizeTransaction) => {
        await sequelize.query('SELECT pg_advisory_xact_lock(20261027)', { transaction });
        const migrations = [
            { id: MIGRATION_ID, statements: migrationStatements },
            { id: REORG_MIGRATION_ID, statements: reorgRecoveryStatements },
        ];
        for (const migration of migrations) {
            const [rows] = await sequelize.query(
                'SELECT "id" FROM "SchemaMigrations" WHERE "id" = :id',
                { replacements: { id: migration.id }, transaction },
            );
            if ((rows as Array<{ id: string }>).length > 0) continue;
            for (const statement of migration.statements) await sequelize.query(statement, { transaction });
            await sequelize.query(
                'INSERT INTO "SchemaMigrations" ("id") VALUES (:id)',
                { replacements: { id: migration.id }, transaction },
            );
        }
    });
}
