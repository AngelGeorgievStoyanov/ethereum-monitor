import { Request, Response } from 'express';
import Transaction from '../models/transaction';
import Configuration from '../models/configuration';
import { TransactionReceipt, TransactionResponse } from 'ethers';

export async function createTransactionFromEthereumData(
    tx: TransactionResponse,
    receipt: TransactionReceipt,
    config: Configuration,
    blockTimestamp: number
) {
    const existing = await Transaction.findOne({
        where: {
            configurationId: config.id,
            hash: tx.hash,
        },
    });

    if (existing) {
        return existing;
    }

    const data = {
        configurationId: config.id,
        hash: tx.hash,
        nonce: tx.nonce,
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber,
        transactionIndex: receipt.index,
        from: tx.from,
        to: tx.to,
        value: tx.value.toString(),
        gas: Number(receipt.gasUsed),
        gasPrice: tx.gasPrice?.toString() ?? tx.maxFeePerGas?.toString() ?? '0',
        input: tx.data,
        status: receipt.status === 1 ? 'success' : 'failed',
        transactionType: tx.type?.toString(),
        contractAddress: receipt.contractAddress ?? undefined,
        timestamp: new Date(blockTimestamp * 1000),
        gasLimit: Number(tx.gasLimit),
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString() ?? undefined,
        maxFeePerGas: tx.maxFeePerGas?.toString() ?? undefined,
        maxFeePerBlobGas: tx.maxFeePerBlobGas?.toString() ?? undefined,
        accessList: tx.accessList ? JSON.stringify(tx.accessList) : undefined,
        blobVersionedHashes: tx.blobVersionedHashes ? JSON.stringify(tx.blobVersionedHashes) : undefined,
        logsBloom: receipt.logsBloom ?? undefined,
        gasUsed: Number(receipt.gasUsed),
        cumulativeGasUsed: Number(receipt.cumulativeGasUsed),
        root: receipt.root ?? undefined,
        blobGasUsed: receipt.blobGasUsed ? Number(receipt.blobGasUsed) : undefined,
    };

    return Transaction.create(data);
}

export async function getAllStoredTransactions(req: Request, res: Response): Promise<void> {
    try {
        const transactions = await Transaction.findAll();
        res.json(transactions);
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export async function deleteAllTransactions(req: Request, res: Response): Promise<void> {
    try {
        await Transaction.destroy({ where: {} });
        res.status(200).json({ message: 'All transactions deleted successfully' });
    } catch (error) {
        console.error('Error deleting transactions:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export async function deleteTransactionById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    try {
        const result = await Transaction.destroy({ where: { id } });
        if (result === 0) {
            res.status(404).send('Transaction not found');
        } else {
            res.status(200).json({ message: 'Transaction deleted successfully' });
        }
    } catch (error) {
        console.error('Error deleting transaction:', error);
        res.status(500).send('Internal Server Error');
    }
}

export async function deleteTransactionsWithQuery(req: Request, res: Response): Promise<void> {
    try {
        const { where } = req.query;
        let whereClause: Record<string, unknown> = {};

        if (where) {
            try {
                whereClause = JSON.parse(where as string);
            } catch {
                res.status(400).json({ message: 'Invalid "where" query parameter format' });
                return;
            }
        }

        const deleted = await Transaction.destroy({ where: whereClause });
        if (deleted > 0) {
            res.status(200).json({ message: `${deleted} transactions deleted successfully` });
        } else {
            res.status(404).json({ message: 'No transactions found to delete' });
        }
    } catch (error) {
        console.error('Error deleting transactions:', error);
        res.status(500).json({ message: 'Failed to delete transactions' });
    }
}
