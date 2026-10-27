const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const app = require('../index');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SAMPLE_IMAGE = path.join(FIXTURES_DIR, 'sample.png');

describe('Scan API (POST /scan)', () => {
  test('returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/scan');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('successfully processes image with CamScanner filter and returns PNG', async () => {
    const res = await request(app)
      .post('/scan')
      .attach('image', SAMPLE_IMAGE);

    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('image/png'));
    assert.ok(res.body.length > 0);
  });

  test('successfully processes image and returns PDF when format is pdf', async () => {
    const res = await request(app)
      .post('/scan')
      .field('format', 'pdf')
      .attach('image', SAMPLE_IMAGE);

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    // PDF files start with %PDF- header magic bytes
    const pdfMagic = res.body.slice(0, 5).toString('ascii');
    assert.equal(pdfMagic, '%PDF-');
  });
});
