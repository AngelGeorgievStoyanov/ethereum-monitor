import { Request, Response } from 'express';
import Transaction from '../models/transaction';
import Configuration from '../models/configuration';
import { TransactionResponse } from 'ethers';

export interface TransferMetadata {
    transferType: 'native' | 'erc20';
    logIndex: number;
    from: string;
    to: string;
    value: string;
    tokenAddress?: string;
}

export async function createTransactionFromEthereumData(
    tx: TransactionResponse,
    receipt: any,
    config: Configuration,
    blockTimestamp: number,
    transfer: TransferMetadata
) {
    const existing = await Transaction.findOne({
        where: {
            configurationId: config.id,
            hash: tx.hash,
            transferType: transfer.transferType,
            logIndex: transfer.logIndex,
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
        blockNumber: Number(BigInt(receipt.blockNumber)),
        transactionIndex: Number(BigInt(receipt.transactionIndex ?? receipt.index)),
        from: transfer.from,
        to: transfer.to,
        value: transfer.value,
        transferType: transfer.transferType,
        tokenAddress: transfer.tokenAddress,
        logIndex: transfer.logIndex,
        gas: Number(BigInt(receipt.gasUsed ?? '0x0')),
        gasPrice: tx.gasPrice?.toString() ?? tx.maxFeePerGas?.toString() ?? '0',
        input: tx.data,
        status: Number(BigInt(receipt.status ?? '0x0')) === 1 ? 'success' : 'failed',
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
        gasUsed: Number(BigInt(receipt.gasUsed ?? '0x0')),
        cumulativeGasUsed: Number(BigInt(receipt.cumulativeGasUsed ?? '0x0')),
        root: receipt.root ?? undefined,
        blobGasUsed: receipt.blobGasUsed ? Number(BigInt(receipt.blobGasUsed)) : undefined,
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
        let whereClause: any = {};

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
