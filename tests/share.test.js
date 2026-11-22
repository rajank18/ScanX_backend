const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const app = require('../index');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SAMPLE_FILE = path.join(FIXTURES_DIR, 'sample.docx');

describe('File Share API (POST /share/upload, GET /share/info, GET /share/download)', () => {
  let shareId = null;

  test('returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/share/upload');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('successfully uploads a file and returns direct share link', async () => {
    const res = await request(app)
      .post('/share/upload')
      .attach('file', SAMPLE_FILE)
      .field('expiryHours', '24');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.shareId);
    assert.ok(res.body.downloadUrl);
    assert.ok(res.body.expiresAt);
    assert.equal(res.body.originalName, 'sample.docx');

    shareId = res.body.shareId;
  });

  test('retrieves public file info without passwords or OTP', async () => {
    assert.ok(shareId, 'ShareId must exist from upload step');
    const res = await request(app).get(`/share/info/${shareId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.shareId, shareId);
    assert.equal(res.body.originalName, 'sample.docx');
    assert.ok(typeof res.body.size === 'number');
  });

  test('directly downloads the shared file with attachment header', async () => {
    assert.ok(shareId, 'ShareId must exist');
    const res = await request(app).get(`/share/download/${shareId}`).buffer(true);
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-disposition'].includes('attachment'));
    assert.ok(res.headers['content-disposition'].includes('sample.docx'));
    assert.ok(parseInt(res.headers['content-length'], 10) > 0);
  });

  test('returns 404 for non-existent share link', async () => {
    const res = await request(app).get('/share/info/nonexistent123');
    assert.equal(res.status, 404);
  });
});
