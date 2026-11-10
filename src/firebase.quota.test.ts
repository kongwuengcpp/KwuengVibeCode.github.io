import test from 'node:test';
import assert from 'node:assert/strict';
import { describeFirestoreError } from './firebase';

test('nhận ra lỗi hết hạn mức đọc miễn phí (đúng thông báo thật của Firestore)', () => {
  const real = new Error(
    "Quota limit exceeded. Retry after quota limits are reset or enable billing for this project to avoid quota checks. Cause - Quota exceeded for quota metric 'Free daily read units per project (free tier database)'"
  );
  assert.match(describeFirestoreError(real), /hết hạn mức ĐỌC/);
  assert.match(describeFirestoreError(Object.assign(new Error('x'), { code: 'resource-exhausted' })), /hết hạn mức/);
});

test('các lỗi khác vẫn được nhận diện như trước', () => {
  assert.match(describeFirestoreError(new Error('Missing or insufficient permissions.')), /quyền/);
  assert.match(describeFirestoreError(new Error('Document exceeds the maximum allowed size')), /quá nặng/);
});
