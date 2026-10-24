import Transaction, { TransactionCreationAttributes } from '../models/transaction';

export function findExistingTransfer(
    configurationId: string,
    hash: string,
    transferType: 'native' | 'erc20',
    logIndex: number,
) {
    return Transaction.findOne({
        where: { configurationId, hash, transferType, logIndex },
    });
}

export function createTransaction(data: TransactionCreationAttributes) {
    return Transaction.create(data);
}

export function findAllTransactions() {
    return Transaction.findAll();
}

export function deleteTransactionById(id: string) {
    return Transaction.destroy({ where: { id } });
}
