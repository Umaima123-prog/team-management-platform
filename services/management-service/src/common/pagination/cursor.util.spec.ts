import { ObjectId } from 'mongodb';
import { BadRequestException } from '@nestjs/common';
import { clampLimit, decodeCursor, encodeCursor, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './cursor.util';

describe('cursor.util', () => {
  it('encode/decode roundtrips an ObjectId', () => {
    const id = new ObjectId();
    const cursor = encodeCursor(id);
    expect(decodeCursor(cursor).equals(id)).toBe(true);
  });

  it('rejects a cursor that is not valid base64url', () => {
    expect(() => decodeCursor('***not valid***')).toThrow(BadRequestException);
  });

  it('rejects a cursor that decodes to the wrong byte length', () => {
    const tooShort = Buffer.from('abc').toString('base64url');
    expect(() => decodeCursor(tooShort)).toThrow(BadRequestException);
  });

  it('clampLimit falls back to the default when unset or invalid', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(-5)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('clampLimit caps at the maximum page size', () => {
    expect(clampLimit(MAX_PAGE_SIZE + 500)).toBe(MAX_PAGE_SIZE);
  });

  it('clampLimit passes through a valid in-range value', () => {
    expect(clampLimit(10)).toBe(10);
  });
});
