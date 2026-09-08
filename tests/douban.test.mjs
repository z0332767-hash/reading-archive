import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context = { module: { exports: {} }, URL, require: () => ({}) };
vm.runInNewContext(readFileSync(new URL('../desktop/douban.cjs', import.meta.url), 'utf8'), context);
const { allowed, collection } = context.module.exports;
test('Douban window excludes local services, lookalike hosts and non-HTTPS navigation', () => {
  for (const url of ['http://127.0.0.1:4174', 'https://movie.douban.com.evil.test/', 'file:///tmp/test', 'javascript:alert(1)', 'http://movie.douban.com/']) assert.equal(allowed(url), false);
  assert.equal(allowed('https://accounts.douban.com/passport/login'), true);
});
test('collection validation rejects login, reviews and other origins', () => {
  assert.equal(collection('https://movie.douban.com/people/example/collect?start=15'), true);
  for (const url of ['https://accounts.douban.com/people/example/collect', 'https://movie.douban.com/people/example/reviews', 'https://movie.douban.com/mine?status=collect']) assert.equal(collection(url), false);
});
