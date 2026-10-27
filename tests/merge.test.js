const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const app = require('../index');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const PDF1 = path.join(FIXTURES_DIR, '23DIT024_PRACT1.ipynb - Colab.pdf');
const PDF2 = path.join(FIXTURES_DIR, '23DIT024_PRACT2 - Colab.pdf');

describe('PDF Merge API (POST /merge/merge)', () => {
  test('returns 400 when less than 2 PDF files are uploaded', async () => {
    const res = await request(app)
      .post('/merge/merge')
      .attach('pdfs', PDF1);

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('successfully merges multiple uploaded PDFs', async () => {
    const res = await request(app)
      .post('/merge/merge')
      .attach('pdfs', PDF1)
      .attach('pdfs', PDF2);

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    const pdfMagic = res.body.slice(0, 5).toString('ascii');
    assert.equal(pdfMagic, '%PDF-');
    assert.ok(res.body.length > 1000);
  });
});
