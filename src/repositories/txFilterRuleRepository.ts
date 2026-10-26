import { Op, Transaction } from 'sequelize';
import sequelize from '../database';
import TxFilterGroup from '../models/txFilterGroup';
import TxFilterCondition from '../models/txFilterCondition';
import { TxFilterGroupRule } from '../services/txFilterEvaluatorService';

export async function findRuleForFilter(txFilterId: number): Promise<TxFilterGroupRule | null> {
    const groups = await TxFilterGroup.findAll({ where: { txFilterId }, order: [['id', 'ASC']] });
    if (groups.length === 0) return null;

    const groupIds = groups.map((group) => group.id);
    const conditions = await TxFilterCondition.findAll({
        where: { groupId: { [Op.in]: groupIds } },
        order: [['id', 'ASC']],
    });
    const groupById = new Map<number, TxFilterGroupRule>();
    const rootIds: number[] = [];

    for (const group of groups) {
        groupById.set(group.id, { logic: group.logic, conditions: [], groups: [] });
    }
    for (const group of groups) {
        if (group.parentGroupId === null) rootIds.push(group.id);
        else {
            const parent = groupById.get(group.parentGroupId);
            const child = groupById.get(group.id);
            if (parent && child) parent.groups.push(child);
        }
    }
    for (const condition of conditions) {
        groupById.get(condition.groupId)?.conditions.push({
            field: condition.field,
            operator: condition.operator,
            value: condition.value,
        }, { transaction });
    }

    if (rootIds.length !== 1) {
        throw new Error(`Filter ${txFilterId} must have exactly one root rule group`);
    }
    return groupById.get(rootIds[0]) ?? null;
}

async function deleteRuleForFilter(txFilterId: number, transaction: Transaction): Promise<void> {
    const groups = await TxFilterGroup.findAll({ where: { txFilterId }, attributes: ['id'], transaction });
    const ids = groups.map((group) => group.id);
    if (ids.length > 0) {
        await TxFilterCondition.destroy({ where: { groupId: { [Op.in]: ids } }, transaction });
        await TxFilterGroup.destroy({ where: { txFilterId }, transaction });
    }
}

async function persistGroup(
    txFilterId: number,
    group: TxFilterGroupRule,
    parentGroupId: number | null,
    transaction: Transaction,
): Promise<void> {
    const savedGroup = await TxFilterGroup.create(
        { txFilterId, parentGroupId, logic: group.logic },
        { transaction },
    );
    for (const condition of group.conditions) {
        await TxFilterCondition.create({
            groupId: savedGroup.id,
            field: condition.field,
            operator: condition.operator,
            value: condition.value,
        });
    }
    for (const child of group.groups) {
        await persistGroup(txFilterId, child, savedGroup.id, transaction);
    }
}

export async function saveRuleForFilter(
    txFilterId: number,
    rule: TxFilterGroupRule | null,
): Promise<void> {
    await sequelize.transaction(async (transaction) => {
        await deleteRuleForFilter(txFilterId, transaction);
        if (rule) await persistGroup(txFilterId, rule, null, transaction);
    });
}
