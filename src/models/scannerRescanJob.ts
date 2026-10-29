import { DataTypes, Model } from 'sequelize';
import sequelize from '../database';

class ScannerRescanJob extends Model {
    public id!: string;
    public fromBlock!: number;
    public toBlock!: number;
    public currentBlock!: number | null;
    public blocksProcessed!: number;
    public status!:
        'QUEUED' | 'RUNNING' | 'COMPLETED' | 'RECOVERY_STARTED' | 'FAILED' | 'INTERRUPTED';
    public error!: string | null;
    public startedAt!: Date | null;
    public completedAt!: Date | null;
    public createdAt!: Date;
    public updatedAt!: Date;
}

ScannerRescanJob.init(
    {
        id: {
            type: DataTypes.STRING,
            primaryKey: true,
        },
        fromBlock: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        toBlock: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        currentBlock: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        blocksProcessed: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        status: {
            type: DataTypes.STRING(32),
            allowNull: false,
            defaultValue: 'QUEUED',
        },
        error: {
            type: DataTypes.STRING(1000),
            allowNull: true,
            defaultValue: null,
        },
        startedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
        completedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
    },
    {
        sequelize,
        tableName: 'ScannerRescanJobs',
        modelName: 'ScannerRescanJob',
        timestamps: true,
    },
);

export default ScannerRescanJob;
