import { DataTypes, Model } from 'sequelize';
import sequelize from '../database';

class ScannerState extends Model {
    public id!: string;
    public lastProcessedBlock!: number;
    public lastRescanFromBlock!: number | null;
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
    },
    {
        sequelize,
        tableName: 'ScannerStates',
        modelName: 'ScannerState',
        timestamps: true,
    }
);

export default ScannerState;
