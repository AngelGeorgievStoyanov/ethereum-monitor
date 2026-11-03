import { Sequelize } from 'sequelize';
import { env } from './config/env';
import { publishDatabaseMetricEvent } from './metrics/databaseMetricsEventBus';

const databaseUrl = new URL(env.databaseUrl);
databaseUrl.pathname = '/' + env.blockchainNetworkAndDatabaseName;

function skipSqlTrivia(sql: string, startIndex: number): number {
    let index = startIndex;
    while (index < sql.length) {
        if (/\s/.test(sql[index])) {
            index += 1;
            continue;
        }
        if (sql.startsWith('--', index)) {
            const lineEnd = sql.indexOf('\n', index + 2);
            index = lineEnd === -1 ? sql.length : lineEnd + 1;
            continue;
        }
        if (sql.startsWith('/*', index)) {
            let commentDepth = 1;
            index += 2;
            while (index < sql.length && commentDepth > 0) {
                if (sql.startsWith('/*', index)) {
                    commentDepth += 1;
                    index += 2;
                } else if (sql.startsWith('*/', index)) {
                    commentDepth -= 1;
                    index += 2;
                } else {
                    index += 1;
                }
            }
            continue;
        }
        break;
    }
    return index;
}

function skipSqlQuotedValue(sql: string, startIndex: number): number {
    const quote = sql[startIndex];
    let index = startIndex + 1;
    while (index < sql.length) {
        if (sql[index] === quote) {
            if (sql[index + 1] === quote) {
                index += 2;
                continue;
            }
            return index + 1;
        }
        if (sql[index] === '\\') {
            index += 2;
            continue;
        }
        index += 1;
    }
    return sql.length;
}

function skipSqlParenthesized(sql: string, startIndex: number): number {
    let depth = 0;
    let index = startIndex;
    while (index < sql.length) {
        if (sql.startsWith('--', index) || sql.startsWith('/*', index)) {
            index = skipSqlTrivia(sql, index);
            continue;
        }
        if (sql[index] === "'" || sql[index] === '"') {
            index = skipSqlQuotedValue(sql, index);
            continue;
        }
        if (sql[index] === '$') {
            const delimiter = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
            if (delimiter) {
                const closingIndex = sql.indexOf(delimiter, index + delimiter.length);
                index = closingIndex === -1 ? sql.length : closingIndex + delimiter.length;
                continue;
            }
        }
        if (sql[index] === '(') depth += 1;
        if (sql[index] === ')') {
            depth -= 1;
            if (depth === 0) return index + 1;
        }
        index += 1;
    }
    return sql.length;
}

function readSqlWord(sql: string, startIndex: number): { word: string; nextIndex: number } {
    const match = sql.slice(startIndex).match(/^[A-Za-z_][A-Za-z0-9_$]*/);
    return match
        ? { word: match[0].toUpperCase(), nextIndex: startIndex + match[0].length }
        : { word: '', nextIndex: startIndex };
}

function skipSqlIdentifier(sql: string, startIndex: number): number {
    if (sql[startIndex] === '"') return skipSqlQuotedValue(sql, startIndex);
    return readSqlWord(sql, startIndex).nextIndex;
}

function getCteMainStatement(sql: string): string | null {
    let index = skipSqlTrivia(sql, 0);
    const withKeyword = readSqlWord(sql, index);
    if (withKeyword.word !== 'WITH') return null;
    index = skipSqlTrivia(sql, withKeyword.nextIndex);

    const recursiveKeyword = readSqlWord(sql, index);
    if (recursiveKeyword.word === 'RECURSIVE') index = skipSqlTrivia(sql, recursiveKeyword.nextIndex);

    while (index < sql.length) {
        index = skipSqlIdentifier(sql, index);
        if (index === 0) return null;
        index = skipSqlTrivia(sql, index);

        if (sql[index] === '(') {
            index = skipSqlParenthesized(sql, index);
            index = skipSqlTrivia(sql, index);
        }

        const asKeyword = readSqlWord(sql, index);
        if (asKeyword.word !== 'AS') return null;
        index = skipSqlTrivia(sql, asKeyword.nextIndex);

        const notKeyword = readSqlWord(sql, index);
        if (notKeyword.word === 'NOT') {
            index = skipSqlTrivia(sql, notKeyword.nextIndex);
            const materializedKeyword = readSqlWord(sql, index);
            if (materializedKeyword.word !== 'MATERIALIZED') return null;
            index = materializedKeyword.nextIndex;
        } else if (notKeyword.word === 'MATERIALIZED') {
            index = notKeyword.nextIndex;
        }

        index = skipSqlTrivia(sql, index);
        if (sql[index] !== '(') return null;
        index = skipSqlParenthesized(sql, index);
        index = skipSqlTrivia(sql, index);

        if (sql[index] === ',') {
            index = skipSqlTrivia(sql, index + 1);
            continue;
        }
        return readSqlWord(sql, index).word || null;
    }
    return null;
}

function getQueryOperation(sql: string): { operation: 'read' | 'write' | 'other'; queryType: string } {
    // Sequelize prefixes benchmark log messages with "Executing (connection):".
    // Strip that wrapper before classifying the actual SQL statement.
    const statement = sql.replace(/^\s*Executing\s+\([^)]*\):\s*/i, '');
    const firstKeywordIndex = skipSqlTrivia(statement, 0);
    const firstKeyword = readSqlWord(statement, firstKeywordIndex).word || 'UNKNOWN';
    const queryType = firstKeyword === 'WITH' ? getCteMainStatement(statement) ?? 'WITH' : firstKeyword;
    if (['SELECT', 'SHOW', 'EXPLAIN'].includes(queryType)) {
        return { operation: 'read', queryType };
    }
    if (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(queryType)) {
        return { operation: 'write', queryType };
    }
    return { operation: 'other', queryType };
}

const sequelize = new Sequelize(databaseUrl.toString(), {
    dialect: 'postgres',
    benchmark: true,
    logging: (sql, timing) => {
        if (typeof timing !== 'number' || !Number.isFinite(timing) || timing < 0) return;
        const query = getQueryOperation(sql);
        publishDatabaseMetricEvent({ ...query, durationMs: timing });
    },
});

export default sequelize;
