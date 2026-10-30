import Transaction from './transaction';
import TxFilter from './txFilter';
import TxMatch from './txMatch';

Transaction.hasMany(TxMatch, { foreignKey: 'txId', as: 'matches', onDelete: 'CASCADE' });
TxMatch.belongsTo(Transaction, { foreignKey: 'txId', as: 'transaction', onDelete: 'CASCADE' });
TxMatch.belongsTo(TxFilter, { foreignKey: 'txFilterId', as: 'txFilter', onDelete: 'SET NULL' });
TxFilter.hasMany(TxMatch, { foreignKey: 'txFilterId', as: 'matches', onDelete: 'SET NULL' });
