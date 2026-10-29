const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const app = require('../index');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SAMPLE_IMAGE = path.join(FIXTURES_DIR, 'sample.png');
const SAMPLE_PDF = path.join(FIXTURES_DIR, 'sample1.pdf');
const SAMPLE_XLSX = path.join(FIXTURES_DIR, 'sample.xlsx');
const SAMPLE_DOCX = path.join(FIXTURES_DIR, 'sample.docx');

describe('Conversion APIs (POST /convert/*)', () => {
  describe('Image to PDF', () => {
    test('returns 400 if no image is uploaded', async () => {
      const res = await request(app).post('/convert/image-to-pdf');
      assert.equal(res.status, 400);
    });

    test('successfully converts uploaded images into PDF', async () => {
      const res = await request(app)
        .post('/convert/image-to-pdf')
        .attach('images', SAMPLE_IMAGE);

      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/pdf');
      const pdfMagic = res.body.slice(0, 5).toString('ascii');
      assert.equal(pdfMagic, '%PDF-');
    });
  });

  describe('PDF to Text', () => {
    test('returns 400 if no PDF is uploaded', async () => {
      const res = await request(app).post('/convert/pdf-to-text');
      assert.equal(res.status, 400);
    });

    test('extracts text from uploaded PDF', async () => {
      const res = await request(app)
        .post('/convert/pdf-to-text')
        .attach('file', SAMPLE_PDF);

      assert.equal(res.status, 200);
      assert.ok(typeof res.body.text === 'string');
      assert.ok(res.body.text.length > 0);
    });
  });

  describe('Excel to PDF', () => {
    test('returns 400 if no Excel file is uploaded', async () => {
      const res = await request(app).post('/convert/excel-to-pdf');
      assert.equal(res.status, 400);
    });

    test('converts Excel spreadsheet to PDF table layout', async () => {
      const res = await request(app)
        .post('/convert/excel-to-pdf')
        .attach('file', SAMPLE_XLSX);

      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/pdf');
      const pdfMagic = res.body.slice(0, 5).toString('ascii');
      assert.equal(pdfMagic, '%PDF-');
    });
  });

  describe('Word to PDF', () => {
    test('returns 400 if no Word file is uploaded', async () => {
      const res = await request(app).post('/convert/word-to-pdf');
      assert.equal(res.status, 400);
    });

    test('converts DOCX to PDF using mammoth and pdfkit fallback', async () => {
      const res = await request(app)
        .post('/convert/word-to-pdf')
        .attach('file', SAMPLE_DOCX);

      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/pdf');
      const pdfMagic = res.body.slice(0, 5).toString('ascii');
      assert.equal(pdfMagic, '%PDF-');
    });
  });

  describe('PDF to Excel', () => {
    test('returns 400 if no PDF is uploaded', async () => {
      const res = await request(app).post('/convert/pdf-to-excel');
      assert.equal(res.status, 400);
    });

    test('converts PDF text into an XLSX workbook', async () => {
      const res = await request(app)
        .post('/convert/pdf-to-excel')
        .attach('file', SAMPLE_PDF);

      assert.equal(res.status, 200);
      assert.ok(
        res.headers['content-type'].includes('spreadsheetml') ||
        res.headers['content-type'].includes('octet-stream') ||
        res.body.length > 500
      );
    });
  });

  describe('Client-Side Redirect Endpoints', () => {
    test('pdf-to-images informs client about browser execution', async () => {
      const res = await request(app)
        .post('/convert/pdf-to-images')
        .attach('file', SAMPLE_PDF);

      assert.equal(res.status, 400);
      assert.ok(res.text.includes('client-side'));
    });

    test('jpg-to-png informs client about browser execution', async () => {
      const res = await request(app)
        .post('/convert/jpg-to-png')
        .attach('image', SAMPLE_IMAGE);

      assert.equal(res.status, 400);
      assert.ok(res.text.includes('client-side'));
    });

    test('png-to-jpg informs client about browser execution', async () => {
      const res = await request(app)
        .post('/convert/png-to-jpg')
        .attach('image', SAMPLE_IMAGE);

      assert.equal(res.status, 400);
      assert.ok(res.text.includes('client-side'));
    });
  });

  describe('Colab / Notebook to PDF (POST /convert/colab-to-pdf)', () => {
    const SAMPLE_IPYNB = path.join(FIXTURES_DIR, 'sample.ipynb');

    test('returns 400 when neither URL nor file is provided', async () => {
      const res = await request(app).post('/convert/colab-to-pdf').send({});
      assert.equal(res.status, 400);
      assert.ok(res.body.error);
    });

    test('successfully converts uploaded .ipynb file into PDF', async () => {
      const res = await request(app)
        .post('/convert/colab-to-pdf')
        .attach('file', SAMPLE_IPYNB);

      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/pdf'));
      assert.ok(res.body.length > 500);
      assert.equal(res.body.toString('utf8', 0, 5), '%PDF-');
    });

    test('returns 400 for invalid or malformed URL', async () => {
      const res = await request(app)
        .post('/convert/colab-to-pdf')
        .send({ url: 'https://invalid-non-existent-domain-12345.xyz/notebook.ipynb' });

      assert.equal(res.status, 400);
      assert.ok(res.body.error);
    });
  });
});
