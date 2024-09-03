import Transaction from '../models/transaction';
import TransactionAttributes from '../models/transaction';

export async function createTransactionFromEthereumData(tx: any, receipt: any, config: any) {
    const data: Partial<TransactionAttributes> = {
        configurationId: config.id,
        hash: tx.hash,
        nonce: tx.nonce,
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber,
        transactionIndex: receipt.index !== undefined ? receipt.index : 0,
        from: tx.from,
        to: tx.to,
        value: tx.value.toString(),
        gas: receipt.gasUsed.toString(),
        gasPrice: tx.gasPrice.toString(),
        input: tx.data,
        status: receipt.status === 1 ? 'success' : 'failed',
        transactionType: tx.type,
        contractAddress: receipt.contractAddress,
        timestamp: receipt.timestamp !== undefined ? new Date(receipt.timestamp * 1000) : new Date(),
        requiredConfirmations: config.requiredConfirmations,
        gasLimit: tx.gasLimit ? tx.gasLimit : null,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? tx.maxPriorityFeePerGas.toString() : null,
        maxFeePerGas: tx.maxFeePerGas ? tx.maxFeePerGas.toString() : null,
        maxFeePerBlobGas: tx.maxFeePerBlobGas ? tx.maxFeePerBlobGas.toString() : null,
        accessList: tx.accessList ? JSON.stringify(tx.accessList) : null,
        blobVersionedHashes: tx.blobVersionedHashes ? JSON.stringify(tx.blobVersionedHashes) : null,
        logsBloom: receipt.logsBloom,
        gasUsed: receipt.gasUsed.toString(),
        cumulativeGasUsed: receipt.cumulativeGasUsed.toString(),
        root: receipt.root || null,
        blobGasUsed: receipt.blobGasUsed ? receipt.blobGasUsed.toString() : null
    };


    try {
        const transaction = await Transaction.create(data);
        return transaction;
    } catch (error) {
        console.error('Error creating transaction:', error);
        throw error;
    }
}



