import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATISTICS_YEAR, restoreStatisticsYearSelection } from '../lib/statisticsYear.js';

test('new and empty legacy drafts select the latest supported year', () => {
  assert.equal(DEFAULT_STATISTICS_YEAR, '2025');
  for (const saved of [{}, { statisticsYear: '2024' }, { statisticsYear: '2024', landuseAreas: { 전: '' }, zoningRows: [{ area: null }] },
    { statisticsYear: '2024', statisticsYearMode: 'auto' }]) {
    assert.deepEqual(restoreStatisticsYearSelection(saved), { statisticsYear: '2025', statisticsYearMode: 'auto' });
  }
});

test('stored totals, partial values and real zero retain their reference year', () => {
  for (const data of [{ landuseAreas: { 전: '123' } }, { zoningRows: [{ area: 0 }] }, { landuseSourceTotal: 0 },
    { zoningBaseYear: '2024' }, { statisticsDataKey: 'kosis-landuse:서초구:2024' }]) {
    assert.equal(restoreStatisticsYearSelection({ statisticsYear: '2024', ...data }).statisticsYear, '2024');
  }
});

test('explicit year choices persist even before extraction; legacy nondefault choices remain', () => {
  assert.deepEqual(restoreStatisticsYearSelection({ statisticsYear: '2024', statisticsYearMode: 'manual' }),
    { statisticsYear: '2024', statisticsYearMode: 'manual' });
  assert.equal(restoreStatisticsYearSelection({ statisticsYear: '2023' }).statisticsYear, '2023');
});
