import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjustmentDestinations, validAdjustmentSelection } from './adjustment-access.ts';

const parties = ['a', 'b', 'c'].map(id => ({ id }));
test('exact destination IDs require source AND destination grants', () => {
  const ids = (source, staff, grants) => adjustmentDestinations(parties, source, staff, grants).map(p => p.id);
  assert.deepEqual(ids('a', true, []), []);
  assert.deepEqual(ids('a', true, ['b']), []);
  assert.deepEqual(ids('a', true, ['a']), []);
  assert.deepEqual(ids('a', true, ['a', 'b']), ['b']);
  assert.deepEqual(ids('b', true, ['a', 'b']), ['a']);
  assert.deepEqual(ids('c', true, ['a', 'b']), []);
  assert.deepEqual(ids('a', false, []), ['b', 'c']);
});
test('open draft selection clears on either endpoint revocation, not search filtering', () => {
  assert.equal(validAdjustmentSelection('b', 'a', true, ['a', 'b']), 'b');
  assert.equal(validAdjustmentSelection('b', 'a', true, ['a']), null);
  assert.equal(validAdjustmentSelection('b', 'a', true, ['b']), null);
  assert.equal(validAdjustmentSelection('b', 'a', true, []), null);
  assert.equal(validAdjustmentSelection('a', 'a', false, []), null);
});