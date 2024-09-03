import { QueryTypes  } from 'sequelize'; 
import sequelize from '../database';
import Transaction from '../models/transaction';
import TransactionAttributes from '../models/transaction';
import { Request, Response } from 'express';

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
     const destr=   await Transaction.destroy({ where: {} });
     console.log(destr)
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


export async function deleteTransactionsWithQuery(req: Request, res: Response): Promise<Response> {
    try {
        const { where } = req.query;

        let whereClause: any = {};

        if (where) {
            try {
                whereClause = JSON.parse(where as string);
            } catch (error) {
                return res.status(400).json({ message: 'Invalid "where" query parameter format' });
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
        res.status(500).json({ message: 'Failed to delete transactions', error: error.message });
    }
}


export async function getTransactionsWithQuery(req: Request, res: Response): Promise<Response> {
    try {
        const { sql } = req.query;
      
        if (!sql) {
            return res.status(400).json({ message: 'SQL query is required as a query parameter' });
        }

       
        const transactions = await sequelize.query(sql as string, {
            type: QueryTypes.SELECT, 
            replacements: req.query 
        });

        return res.status(200).json(transactions);
    } catch (error) {
        console.error('Error executing SQL query:', error);
        return res.status(500).json({ message: 'Failed to retrieve transactions', error: error.message });
    }
}