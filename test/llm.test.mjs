// EVREN bağlantısı: akış (stream) birleştirme, düz JSON yedeği, susunca yedek model,
// şart onayı, düşünme kapatmayı reddeden sunucu, zaman aşımında yedek.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Süreleri kısaltılmış kopya (llm.js'in içe aktarımı yok, data: URL ile yüklenebilir)
const kaynak = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../www/js/llm.js'), 'utf8')
  .replace('const ILK_YANIT_SURESI = 180_000', 'const ILK_YANIT_SURESI = 800')
  .replace('const SESSIZLIK_SURESI = 90_000', 'const SESSIZLIK_SURESI = 600');
assert.notEqual(kaynak.indexOf('ILK_YANIT_SURESI = 800'), -1, 'süre sabitlerinin adı değişti; testi güncelle');
const yukle = () => import('data:text/javascript;base64,' + Buffer.from(kaynak + '\n// ' + Math.random()).toString('base64'));

const enc = new TextEncoder();
const sse = (parcalar, gecikme = 100, sonsuz = false) => new Response(new ReadableStream({
  async start(c) {
    for (const p of parcalar) { await new Promise((r) => setTimeout(r, gecikme)); c.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`)); }
    if (sonsuz) return;
    c.enqueue(enc.encode('data: [DONE]\n\n'));
    c.close();
  },
}), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const json = (j, st = 200) => new Response(JSON.stringify(j), { status: st, headers: { 'content-type': 'application/json' } });
const ayar = () => ({ anahtar: { evren: 'k' }, model: { evren: 'deepseek-v4.1-flash' }, sira: ['evren'], roller: {} });
const mesaj = [{ role: 'user', content: 'x' }];

test('akışta parça parça gelen araç çağrısı birleşir', async () => {
  const llm = await yukle();
  globalThis.fetch = async () => sse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'dosya_', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'yaz', arguments: '{"yol":"a",' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"icerik":"x"}' } }] } }] },
  ], 500); // toplam süre ilk yanıt sınırını aşıyor ama parçalar aktığı için kesilmemeli
  const r = await llm.sohbet(ayar(), mesaj, [{}]);
  assert.equal(r.message.tool_calls[0].function.name, 'dosya_yaz');
  assert.deepEqual(JSON.parse(r.message.tool_calls[0].function.arguments), { yol: 'a', icerik: 'x' });
});

test('akış desteklemeyen sunucuda düz JSON okunur', async () => {
  const llm = await yukle();
  globalThis.fetch = async () => json({ choices: [{ message: { content: 'düz' } }] });
  assert.equal((await llm.sohbet(ayar(), mesaj, null)).message.content, 'düz');
});

test('ana model susarsa yedek modele geçilir', async () => {
  const llm = await yukle();
  globalThis.fetch = async (u, o) => (JSON.parse(o.body).model === 'glm-5.3'
    ? sse([{ choices: [{ delta: { content: 'yedek' } }] }], 20)
    : sse([{ choices: [{ delta: { content: 'b' } }] }], 50, true));
  const r = await llm.sohbet(ayar(), mesaj, null);
  assert.equal(r.model, 'glm-5.3');
  assert.equal(r.message.content, 'yedek');
});

test('şart onayı istenir, kabulde version 1 gönderilir', async () => {
  const llm = await yukle();
  let kabul = null;
  globalThis.fetch = async (u, o) => {
    if (String(u).endsWith('/terms/accept')) { kabul = JSON.parse(o.body); return json({}); }
    if (!kabul) return json({ error: { code: 'terms_not_accepted', message: 'kabul et' } }, 403);
    return json({ choices: [{ message: { content: 'ok' } }] });
  };
  let soruldu = 0;
  llm.sartOnayiAyarla(async () => { soruldu++; return true; });
  assert.equal((await llm.sohbet(ayar(), mesaj, null)).message.content, 'ok');
  assert.equal(soruldu, 1);
  assert.deepEqual(kabul, { version: 1 });
});

test('düşünme kapatma: reddeden sunucuda bir kez denenip bırakılır, planlayıcıda hiç gönderilmez', async () => {
  const llm = await yukle();
  const gonderilen = [];
  globalThis.fetch = async (u, o) => {
    const b = JSON.parse(o.body);
    gonderilen.push(Boolean(b.chat_template_kwargs));
    if (b.chat_template_kwargs) return json({ error: { message: 'Extra inputs are not permitted: chat_template_kwargs' } }, 400);
    return json({ choices: [{ message: { content: 'ok' } }] });
  };
  await llm.sohbet(ayar(), mesaj, null);
  await llm.sohbet(ayar(), mesaj, null);
  assert.deepEqual(gonderilen, [true, false, false]);
  const llm2 = await yukle();
  gonderilen.length = 0;
  await llm2.sohbet({ ...ayar(), roller: { planlayici: { saglayici: 'evren', model: 'glm-5.3' } } }, mesaj, null, () => {}, 'planlayici');
  assert.equal(gonderilen[0], false);
});

test('ücret hatasında sağlayıcı uzun süre dinlendirilir', async () => {
  const llm = await yukle();
  globalThis.fetch = async () => json({ error: { message: 'Payment required' } }, 402);
  const a = ayar();
  await assert.rejects(llm.sohbet(a, mesaj, null));
  assert.ok(a.dinlen.evren > Date.now() + 60 * 60_000);
});
