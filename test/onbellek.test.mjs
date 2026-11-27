// Model listesi önbelleği: her turda /models çağrılmasın, tazele ile atlanabilsin.
// Ayrı dosya: llm.test.mjs'teki import.meta tabanlı yükleyici yerine cwd kullanır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const kaynak = fs.readFileSync(path.join(process.cwd(), 'www/js/llm.js'), 'utf8');
const yukle = () => import('data:text/javascript;base64,' + Buffer.from(kaynak + '\n// ' + Math.random()).toString('base64'));

const json = (j, st = 200) => new Response(JSON.stringify(j), { status: st, headers: { 'content-type': 'application/json' } });

test('model listesi önbelleklenir, tazele ile yeniden çekilir', async () => {
  const llm = await yukle();
  let istek = 0;
  globalThis.fetch = async () => {
    istek++;
    return json({ data: [{ id: 'models/m-' + istek }] });
  };
  // İlk çağrı ağa gider, ikincisi önbellekten döner: her turda model listesi çekilmesin
  assert.deepEqual(await llm.modelleriGetir('evren', 'k'), ['m-1']);
  assert.deepEqual(await llm.modelleriGetir('evren', 'k'), ['m-1']);
  assert.equal(istek, 1);
  // tazele: true önbelleği atlar
  assert.deepEqual(await llm.modelleriGetir('evren', 'k', { tazele: true }), ['m-2']);
  assert.equal(istek, 2);
});
