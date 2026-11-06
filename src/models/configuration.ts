import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database';

interface ConfigurationAttributes {
    id: number;
    settingKey: string;
    value: string;
    description: string | null;
}

type ConfigurationCreationAttributes = Optional<ConfigurationAttributes, 'id' | 'description'>;

class Configuration
    extends Model<ConfigurationAttributes, ConfigurationCreationAttributes>
    implements ConfigurationAttributes
{
    public id!: number;
    public settingKey!: string;
    public value!: string;
    public description!: string | null;
}

Configuration.init(
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        settingKey: {
            type: DataTypes.STRING(150),
            allowNull: false,
            unique: true,
        },
        value: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        description: {
            type: DataTypes.STRING(500),
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'Configurations',
        modelName: 'Configuration',
        timestamps: false,
    },
);

export default Configuration;
