import { DataTypes, Model } from 'sequelize';
import sequelize from '../database';

class ScannerState extends Model {
    public id!: string;
    public lastProcessedBlock!: number;
    public lastRescanFromBlock!: number | null;
    public reorgRecoveryActive!: boolean;
    public reorgRecoveryBlocked!: boolean;
    public reorgRecoveryBlockReason!: string | null;
    public reorgRecoveryStableBlocks!: number;
    public reorgRecoveryStartBlock!: number | null;
    public reorgRecoveryTargetBlock!: number | null;
    public scannerPaused!: boolean;
    public scannerPauseMode!: 'manual' | 'temporary' | null;
    public scannerPauseRequestedAtBlock!: number | null;
    public scannerPauseUntil!: Date | null;
    public scannerPauseTargetBlock!: number | null;
    public scannerPauseDurationMinutes!: number;
}

ScannerState.init(
    {
        id: {
            type: DataTypes.STRING,
            primaryKey: true,
        },
        lastProcessedBlock: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        lastRescanFromBlock: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        reorgRecoveryActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        reorgRecoveryBlocked: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        reorgRecoveryBlockReason: {
            type: DataTypes.STRING(500),
            allowNull: true,
            defaultValue: null,
        },
        reorgRecoveryStableBlocks: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        reorgRecoveryStartBlock: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        reorgRecoveryTargetBlock: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
        },
        scannerPaused: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        scannerPauseMode: {
            type: DataTypes.STRING(16),
            allowNull: true,
            defaultValue: null,
        },
        scannerPauseRequestedAtBlock: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
        },
        scannerPauseUntil: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
        scannerPauseTargetBlock: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
        },
        scannerPauseDurationMinutes: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 5,
        },
    },
    {
        sequelize,
        tableName: 'ScannerStates',
        modelName: 'ScannerState',
        timestamps: true,
    },
);

export default ScannerState;
