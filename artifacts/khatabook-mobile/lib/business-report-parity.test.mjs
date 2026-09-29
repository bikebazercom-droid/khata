import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGlobalLedgerReportQuery,
  calculateGlobalLedgerReportTotals,
} from '../../../lib/api-client-react/src/global-ledger-report.ts';

function entry({
  id,
  partyName,
  partyPhone = '01700000000',
  type,
  amount,
  description,
  createdAt,
}) {
  return {
    id,
    partyId: `party-${partyName}`,
    partyName,
    partyPhone,
    type,
    amount,
    description,
    billReference: null,
    billImage: null,
    dueDate: null,
    createdAt,
  };
}

function filterLikeGlobalLedgerEndpoint(entries, query) {
  const start = query.startDate
    ? Date.parse(`${query.startDate}T00:00:00.000Z`)
    : -Infinity;
  const end = query.endDate
    ? Date.parse(`${query.endDate}T23:59:59.999Z`)
    : Infinity;
  const search = query.search?.toLowerCase();

  return entries.filter((item) => {
    const createdAt = Date.parse(item.createdAt);
    if (createdAt < start || createdAt > end) return false;
    if (!search) return true;
    return [item.partyName, item.partyPhone, item.description]
      .some((value) => value.toLowerCase().includes(search));
  });
}

const FIXTURE = [
  entry({
    id: 'regular-debit',
    partyName: 'Acme Traders',
    type: 'YOU_GAVE',
    amount: 110,
    description: 'Stock received',
    createdAt: '2026-08-15T10:00:00.000Z',
  }),
  entry({
    id: 'regular-credit',
    partyName: 'Beta Store',
    type: 'YOU_GOT',
    amount: 75,
    description: 'Cash payment',
    createdAt: '2026-08-16T10:00:00.000Z',
  }),
  entry({
    id: 'transfer-out',
    partyName: 'Acme Traders',
    type: 'YOU_GAVE',
    amount: 40,
    description: 'Paid via transfer to Beta Store',
    createdAt: '2026-08-17T10:00:00.000Z',
  }),
  entry({
    id: 'transfer-in',
    partyName: 'Beta Store',
    type: 'YOU_GOT',
    amount: 40,
    description: 'Transfer from Acme Traders',
    createdAt: '2026-08-17T10:00:00.000Z',
  }),
  entry({
    id: 'outside-range',
    partyName: 'Acme Traders',
    type: 'YOU_GOT',
    amount: 90,
    description: 'Older payment',
    createdAt: '2026-07-31T23:59:59.999Z',
  }),
];

test('both reports share inclusive date params and trimmed search', () => {
  const query = buildGlobalLedgerReportQuery(
    'CUSTOM_RANGE',
    new Date(2026, 7, 1, 12),
    new Date(2026, 7, 31, 12),
    '  Acme Traders  ',
    new Date(2026, 7, 20, 12),
  );

  assert.deepEqual(query, {
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    search: 'Acme Traders',
  });
});

test('matching filters return the same debit, credit, net, and count including a transfer pair', () => {
  const query = buildGlobalLedgerReportQuery(
    'CUSTOM_RANGE',
    new Date(2026, 7, 1, 12),
    new Date(2026, 7, 31, 12),
    '',
    new Date(2026, 7, 20, 12),
  );
  const matchingEntries = filterLikeGlobalLedgerEndpoint(FIXTURE, query);

  assert.deepEqual(
    matchingEntries.map((item) => item.id).sort(),
    ['regular-credit', 'regular-debit', 'transfer-in', 'transfer-out'],
  );
  assert.deepEqual(calculateGlobalLedgerReportTotals(matchingEntries), {
    totalDebit: 150,
    totalCredit: 115,
    netBalance: -35,
    entryCount: 4,
  });

  const transferPair = matchingEntries.filter((item) => item.id.startsWith('transfer-'));
  assert.deepEqual(calculateGlobalLedgerReportTotals(transferPair), {
    totalDebit: 40,
    totalCredit: 40,
    netBalance: 0,
    entryCount: 2,
  });
});

test('search keeps both matched transfer sides and excludes older matches outside the range', () => {
  const query = buildGlobalLedgerReportQuery(
    'CUSTOM_RANGE',
    new Date(2026, 7, 1, 12),
    new Date(2026, 7, 31, 12),
    ' Acme Traders ',
    new Date(2026, 7, 20, 12),
  );
  const matchingEntries = filterLikeGlobalLedgerEndpoint(FIXTURE, query);

  assert.deepEqual(
    matchingEntries.map((item) => item.id).sort(),
    ['regular-debit', 'transfer-in', 'transfer-out'],
  );
  assert.deepEqual(calculateGlobalLedgerReportTotals(matchingEntries), {
    totalDebit: 150,
    totalCredit: 40,
    netBalance: -110,
    entryCount: 3,
  });
});

test('ALL with blank search leaves both date bounds and search unset', () => {
  const query = buildGlobalLedgerReportQuery(
    'ALL',
    null,
    null,
    '   ',
    new Date(2026, 7, 20, 12),
  );

  assert.equal(query.startDate, undefined);
  assert.equal(query.endDate, undefined);
  assert.equal(query.search, undefined);
});