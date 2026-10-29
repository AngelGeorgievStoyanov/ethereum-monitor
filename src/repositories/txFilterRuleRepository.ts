import { Op, Transaction } from 'sequelize';
import sequelize from '../database';
import TxFilterGroup from '../models/txFilterGroup';
import TxFilterCondition from '../models/txFilterCondition';
import { TxFilterGroupRule } from '../types/tx-filter.types';

export async function findRulesForFilters(
    txFilterIds: number[],
): Promise<Map<number, TxFilterGroupRule | null>> {
    const rules = new Map<number, TxFilterGroupRule | null>();
    for (const id of txFilterIds) rules.set(id, null);
    if (txFilterIds.length === 0) return rules;

    const groups = await TxFilterGroup.findAll({
        where: { txFilterId: { [Op.in]: txFilterIds } },
        order: [['id', 'ASC']],
    });
    if (groups.length === 0) return rules;

    const groupIds = groups.map((group) => group.id);
    const conditions = await TxFilterCondition.findAll({
        where: { groupId: { [Op.in]: groupIds } },
        order: [['id', 'ASC']],
    });
    const conditionsByGroupId = new Map<number, typeof conditions>();
    for (const condition of conditions) {
        const current = conditionsByGroupId.get(condition.groupId) ?? [];
        current.push(condition);
        conditionsByGroupId.set(condition.groupId, current);
    }

    const groupsByFilterId = new Map<number, typeof groups>();
    for (const group of groups) {
        const current = groupsByFilterId.get(group.txFilterId) ?? [];
        current.push(group);
        groupsByFilterId.set(group.txFilterId, current);
    }

    for (const txFilterId of txFilterIds) {
        const filterGroups = groupsByFilterId.get(txFilterId);
        if (!filterGroups?.length) continue;

        const groupById = new Map<number, TxFilterGroupRule>();
        const rootIds: number[] = [];
        for (const group of filterGroups) {
            groupById.set(group.id, { logic: group.logic, conditions: [], groups: [] });
        }
        for (const group of filterGroups) {
            if (group.parentGroupId === null) {
                rootIds.push(group.id);
            } else {
                const parent = groupById.get(group.parentGroupId);
                const child = groupById.get(group.id);
                if (parent && child) parent.groups.push(child);
            }

            const ruleGroup = groupById.get(group.id);
            if (!ruleGroup) continue;
            for (const condition of conditionsByGroupId.get(group.id) ?? []) {
                ruleGroup.conditions.push({
                    field: condition.field,
                    operator: condition.operator,
                    value: condition.value,
                });
            }
        }

        if (rootIds.length !== 1) {
            throw new Error(`Filter ${txFilterId} must have exactly one root rule group`);
        }
        rules.set(txFilterId, groupById.get(rootIds[0]) ?? null);
    }

    return rules;
}

export async function findRuleForFilter(txFilterId: number): Promise<TxFilterGroupRule | null> {
    const rules = await findRulesForFilters([txFilterId]);
    return rules.get(txFilterId) ?? null;
}

async function deleteRuleForFilter(txFilterId: number, transaction: Transaction): Promise<void> {
    const groups = await TxFilterGroup.findAll({
        where: { txFilterId },
        attributes: ['id'],
        transaction,
    });
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
        await TxFilterCondition.create(
            {
                groupId: savedGroup.id,
                field: condition.field,
                operator: condition.operator,
                value: condition.value,
            },
            { transaction },
        );
    }
    for (const child of group.groups) {
        await persistGroup(txFilterId, child, savedGroup.id, transaction);
    }
}

export async function saveRuleForFilter(
    txFilterId: number,
    rule: TxFilterGroupRule | null,
    transaction?: Transaction,
): Promise<void> {
    const save = async (activeTransaction: Transaction) => {
        await deleteRuleForFilter(txFilterId, activeTransaction);
        if (rule) await persistGroup(txFilterId, rule, null, activeTransaction);
    };

    if (transaction) {
        await save(transaction);
        return;
    }
    await sequelize.transaction(save);
}
