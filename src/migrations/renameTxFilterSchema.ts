import sequelize from '../database';

export async function renameTxFilterSchema() {
    const queryInterface = sequelize.getQueryInterface();
    const tables = await queryInterface.showAllTables();

    if (tables.includes('Configurations') && !tables.includes('TxFilters')) {
        await queryInterface.renameTable('Configurations', 'TxFilters');
    }

    if (tables.includes('Transactions')) {
        const columns = await queryInterface.describeTable('Transactions');
        if ('configurationId' in columns && !('txFilterId' in columns)) {
            await queryInterface.renameColumn('Transactions', 'configurationId', 'txFilterId');
        }
    }
}
