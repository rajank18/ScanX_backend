const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const app = require('../index');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const PDF_SAMPLE = path.join(FIXTURES_DIR, 'sample1.pdf');
const PNG_SAMPLE = path.join(FIXTURES_DIR, 'sample.png');

describe('Metadata & AI Tag Remover API (/metadata)', () => {
  test('POST /metadata/inspect returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/metadata/inspect');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('POST /metadata/inspect detects tags from PDF', async () => {
    const res = await request(app)
      .post('/metadata/inspect')
      .attach('file', PDF_SAMPLE);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.tagCount === 'number');
    assert.ok(typeof res.body.isAiGenerated === 'boolean');
    assert.ok(res.body.tags);
  });

  test('POST /metadata/inspect detects image metadata and format', async () => {
    const res = await request(app)
      .post('/metadata/inspect')
      .attach('file', PNG_SAMPLE);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.tags['Format']);
    assert.ok(res.body.tags['Resolution']);
  });

  test('POST /metadata/strip strips metadata from PDF and returns clean file', async () => {
    const res = await request(app)
      .post('/metadata/strip')
      .attach('file', PDF_SAMPLE);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.downloadUrl);
    assert.ok(res.body.strippedCount > 0);
  });

  test('POST /metadata/strip purges all EXIF & AI parameters from image', async () => {
    const res = await request(app)
      .post('/metadata/strip')
      .attach('file', PNG_SAMPLE);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.downloadUrl);
    assert.ok(res.body.strippedCount > 0);
  });
});
