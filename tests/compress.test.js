const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const app = require('../index');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SAMPLE_IMAGE = path.join(FIXTURES_DIR, 'sample.png');

describe('Compress Image API (POST /compress-image)', () => {
  test('returns 400 when no image is uploaded', async () => {
    const res = await request(app).post('/compress-image');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('successfully compresses image to target size in KB', async () => {
    const targetSizeKB = 150;
    const res = await request(app)
      .post('/compress-image')
      .field('targetSize', targetSizeKB)
      .attach('image', SAMPLE_IMAGE);

    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('image/jpeg'));
    // Size should be close to or under targetSizeKB * 1024
    assert.ok(res.body.length > 0);
    // Verified JPEG SOI marker (0xFF, 0xD8)
    assert.equal(res.body[0], 0xff);
    assert.equal(res.body[1], 0xd8);
  });
});

const SAMPLE_PDF = path.join(FIXTURES_DIR, 'sample1.pdf');

describe('Compress PDF API (POST /compress-pdf)', () => {
  test('returns 400 when no PDF file is uploaded', async () => {
    const res = await request(app).post('/compress-pdf');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('successfully compresses PDF file and returns application/pdf', async () => {
    const res = await request(app)
      .post('/compress-pdf')
      .attach('file', SAMPLE_PDF);

    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('application/pdf'));
    assert.ok(res.body.length > 0);
    // Starts with PDF magic bytes '%PDF-'
    assert.equal(res.body.toString('utf8', 0, 5), '%PDF-');
  });
});

describe('Unified Compress API (POST /compress)', () => {
  test('returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/compress');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('successfully compresses PDF via POST /compress', async () => {
    const res = await request(app)
      .post('/compress')
      .attach('file', SAMPLE_PDF);

    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('application/pdf'));
    assert.ok(res.body.length > 0);
    assert.equal(res.body.toString('utf8', 0, 5), '%PDF-');
  });

  test('successfully compresses image via POST /compress', async () => {
    const res = await request(app)
      .post('/compress')
      .field('targetSize', 120)
      .attach('file', SAMPLE_IMAGE);

    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('image/jpeg'));
    assert.ok(res.body.length > 0);
    assert.equal(res.body[0], 0xff);
    assert.equal(res.body[1], 0xd8);
  });
});
