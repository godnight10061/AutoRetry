import test from 'node:test';
import assert from 'node:assert/strict';
import { hasValidZhengwenTag } from '../../src/core.js';

test('hasValidZhengwenTag: false when no tag', () => {
  assert.equal(hasValidZhengwenTag('hello'), false);
});

test('hasValidZhengwenTag: true when non-empty <正文>...</正文> exists', () => {
  assert.equal(hasValidZhengwenTag('x<正文>ok</正文>y'), true);
});

test('hasValidZhengwenTag: false when <正文>...</正文> is whitespace-only', () => {
  assert.equal(hasValidZhengwenTag('<正文>  \n\t </正文>'), false);
});

test('hasValidZhengwenTag: true when any pair is valid', () => {
  assert.equal(hasValidZhengwenTag('<正文> </正文><正文>good</正文>'), true);
});

test('hasValidZhengwenTag: false for unmatched tags', () => {
  assert.equal(hasValidZhengwenTag('<正文>missing close'), false);
});

