import { describe, it, expect } from 'vitest';
import { CsvEtl } from '../csv/CsvEtl.js';

const etl = new CsvEtl();

const SAMPLE_CSV = `name,age,city,active
Alice,30,Amsterdam,true
Bob,25,Berlin,false
Carol,35,Paris,true
Dave,28,Amsterdam,true
Eve,,London,false`;

const NUMERIC_CSV = `product,price,quantity
Widget,9.99,100
Gadget,49.95,25
Thingamajig,4.50,500
Doohickey,19.99,75`;

describe('CsvEtl', () => {
  describe('parsing', () => {
    it('parses a basic CSV with headers', () => {
      const result = etl.queryString(SAMPLE_CSV);
      expect(result.totalRows).toBe(5);
      expect(result.schema.fields.map((f) => f.name)).toEqual(['name', 'age', 'city', 'active']);
    });

    it('handles nullable fields', () => {
      const result = etl.queryString(SAMPLE_CSV);
      const ageField = result.schema.fields.find((f) => f.name === 'age');
      expect(ageField?.nullable).toBe(true);
    });

    it('infers boolean type', () => {
      const result = etl.queryString(SAMPLE_CSV);
      const activeField = result.schema.fields.find((f) => f.name === 'active');
      expect(activeField?.type).toBe('boolean');
    });

    it('infers number type', () => {
      const result = etl.queryString(NUMERIC_CSV);
      const priceField = result.schema.fields.find((f) => f.name === 'price');
      expect(priceField?.type).toBe('number');
    });

    it('coerces typed values', () => {
      const result = etl.queryString(SAMPLE_CSV);
      const alice = result.rows[0];
      expect(alice?.['age']).toBe(30);
      expect(alice?.['active']).toBe(true);
    });

    it('handles quoted fields with commas', () => {
      const csv = `name,address\nAlice,"123 Main St, Apt 4"\nBob,456 Oak Ave`;
      const result = etl.queryString(csv);
      expect(result.rows[0]?.['address']).toBe('123 Main St, Apt 4');
    });

    it('handles escaped quotes', () => {
      const csv = `name,bio\nAlice,"She said ""hello"""\nBob,Normal bio`;
      const result = etl.queryString(csv);
      expect(result.rows[0]?.['bio']).toBe('She said "hello"');
    });

    it('respects maxRows option', () => {
      const result = etl.queryString(SAMPLE_CSV, { maxRows: 2 });
      expect(result.totalRows).toBe(2);
    });
  });

  describe('filtering', () => {
    it('filters by equality', () => {
      const result = etl.queryString(SAMPLE_CSV, { where: { city: 'Amsterdam' } });
      expect(result.rows.length).toBe(2);
      expect(result.rows.every((r) => r['city'] === 'Amsterdam')).toBe(true);
    });

    it('returns empty when no matches', () => {
      const result = etl.queryString(SAMPLE_CSV, { where: { city: 'Tokyo' } });
      expect(result.rows.length).toBe(0);
    });
  });

  describe('projection', () => {
    it('projects specific columns', () => {
      const result = etl.queryString(SAMPLE_CSV, { columns: ['name', 'city'] });
      expect(Object.keys(result.rows[0] ?? {})).toEqual(['name', 'city']);
    });
  });

  describe('limit', () => {
    it('limits returned rows and marks truncated', () => {
      const result = etl.queryString(SAMPLE_CSV, { limit: 2 });
      expect(result.returnedRows).toBe(2);
      expect(result.truncated).toBe(true);
    });
  });

  describe('stats', () => {
    it('computes numeric stats', () => {
      const stats = etl.statsString(NUMERIC_CSV, 'price');
      expect(stats.count).toBe(4);
      expect(stats.min).toBe(4.5);
      expect(stats.max).toBe(49.95);
      expect(typeof stats.mean).toBe('number');
      expect(typeof stats.sum).toBe('number');
    });

    it('computes string stats (min/max alphabetically)', () => {
      const stats = etl.statsString(SAMPLE_CSV, 'city');
      expect(stats.count).toBe(5);
      expect(stats.min).toBe('Amsterdam');
      expect(stats.max).toBe('Paris');
    });

    it('reports null count', () => {
      const stats = etl.statsString(SAMPLE_CSV, 'age');
      expect(stats.nullCount).toBe(1);
    });
  });

  describe('delimiter', () => {
    it('parses semicolon-delimited CSV', () => {
      const csv = `name;age\nAlice;30\nBob;25`;
      const result = etl.queryString(csv, { delimiter: ';' });
      expect(result.totalRows).toBe(2);
      expect(result.rows[0]?.['name']).toBe('Alice');
    });

    it('parses tab-delimited CSV', () => {
      const csv = `name\tage\nAlice\t30`;
      const result = etl.queryString(csv, { delimiter: '\t' });
      expect(result.rows[0]?.['age']).toBe(30);
    });
  });
});
