import Transaction from './transaction';
import TxFilter from './txFilter';
import TxMatch from './txMatch';

Transaction.hasMany(TxMatch, { foreignKey: 'txId', as: 'matches' });
TxMatch.belongsTo(Transaction, { foreignKey: 'txId', as: 'transaction' });
TxMatch.belongsTo(TxFilter, { foreignKey: 'txFilterId', as: 'txFilter' });
TxFilter.hasMany(TxMatch, { foreignKey: 'txFilterId', as: 'matches' });
