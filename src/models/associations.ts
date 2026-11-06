import Transaction from './transaction';
import TxFilter from './txFilter';
import TxMatch from './txMatch';

Transaction.hasMany(TxMatch, { foreignKey: 'txId', as: 'matches', onDelete: 'CASCADE' });
TxMatch.belongsTo(Transaction, { foreignKey: 'txId', as: 'transaction', onDelete: 'CASCADE' });
TxMatch.belongsTo(TxFilter, { foreignKey: 'txFilterId', as: 'txFilter', constraints: false });
TxFilter.hasMany(TxMatch, { foreignKey: 'txFilterId', as: 'matches', constraints: false });
