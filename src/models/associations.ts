import Transaction from './transaction';
import TxFilter from './txFilter';
import TxMatch from './txMatch';
import TxFilterGroup from './txFilterGroup';
import TxFilterCondition from './txFilterCondition';

Transaction.hasMany(TxMatch, { foreignKey: 'txId', as: 'matches', onDelete: 'CASCADE' });
TxMatch.belongsTo(Transaction, { foreignKey: 'txId', as: 'transaction', onDelete: 'CASCADE' });
TxMatch.belongsTo(TxFilter, { foreignKey: 'txFilterId', as: 'txFilter', onDelete: 'SET NULL' });
TxFilter.hasMany(TxMatch, { foreignKey: 'txFilterId', as: 'matches', onDelete: 'SET NULL' });

TxFilter.hasMany(TxFilterGroup, {
    foreignKey: 'txFilterId',
    as: 'groups',
    onDelete: 'CASCADE',
});
TxFilterGroup.belongsTo(TxFilter, {
    foreignKey: 'txFilterId',
    as: 'txFilter',
    onDelete: 'CASCADE',
});
TxFilterGroup.hasMany(TxFilterGroup, {
    foreignKey: 'parentGroupId',
    as: 'childGroups',
    onDelete: 'CASCADE',
});
TxFilterGroup.belongsTo(TxFilterGroup, {
    foreignKey: 'parentGroupId',
    as: 'parentGroup',
    onDelete: 'CASCADE',
});
TxFilterGroup.hasMany(TxFilterCondition, {
    foreignKey: 'groupId',
    as: 'conditions',
    onDelete: 'CASCADE',
});
TxFilterCondition.belongsTo(TxFilterGroup, {
    foreignKey: 'groupId',
    as: 'group',
    onDelete: 'CASCADE',
});
