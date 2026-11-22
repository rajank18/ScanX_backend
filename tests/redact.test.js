const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const app = require('../index');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const PDF_SAMPLE = path.join(FIXTURES_DIR, 'sample1.pdf');
const PNG_SAMPLE = path.join(FIXTURES_DIR, 'sample.png');

describe('Privacy Redaction API (POST /redact)', () => {
  test('returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/redact/process');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('successfully redacts PII from a PDF document', async () => {
    const res = await request(app)
      .post('/redact/process')
      .attach('file', PDF_SAMPLE)
      .field('redactAadhaar', 'true')
      .field('redactPan', 'true')
      .field('redactEmail', 'true')
      .field('redactPhone', 'true')
      .field('customKeywords', 'Confidential, University');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.downloadUrl);
    assert.ok(typeof res.body.totalRedacted === 'number');
    assert.ok(Array.isArray(res.body.detections));
  });

  test('successfully processes and sanitizes an image', async () => {
    const res = await request(app)
      .post('/redact/process')
      .attach('file', PNG_SAMPLE)
      .field('redactionMode', 'blackout');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.downloadUrl);
  });
});
