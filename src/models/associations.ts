import Transaction from './transaction';
import TxFilter from './txFilter';
import TxMatch from './txMatch';
import TxFilterGroup from './txFilterGroup';
import TxFilterCondition from './txFilterCondition';

Transaction.hasMany(TxMatch, { foreignKey: 'txId', as: 'matches' });
TxMatch.belongsTo(Transaction, { foreignKey: 'txId', as: 'transaction' });
TxMatch.belongsTo(TxFilter, { foreignKey: 'txFilterId', as: 'txFilter' });
TxFilter.hasMany(TxMatch, { foreignKey: 'txFilterId', as: 'matches' });

TxFilter.hasMany(TxFilterGroup, { foreignKey: 'txFilterId', as: 'groups' });
TxFilterGroup.belongsTo(TxFilter, { foreignKey: 'txFilterId', as: 'txFilter' });
TxFilterGroup.hasMany(TxFilterGroup, { foreignKey: 'parentGroupId', as: 'childGroups' });
TxFilterGroup.belongsTo(TxFilterGroup, { foreignKey: 'parentGroupId', as: 'parentGroup' });
TxFilterGroup.hasMany(TxFilterCondition, { foreignKey: 'groupId', as: 'conditions' });
TxFilterCondition.belongsTo(TxFilterGroup, { foreignKey: 'groupId', as: 'group' });
