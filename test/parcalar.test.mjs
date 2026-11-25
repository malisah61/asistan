// Küçük parçalar: bağlam kısaltma, workflow girdileri, araç doğrulamaları, APK şablonu, görev başlatma yedeği, GitHub tekrar deneme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sikistir } from '../www/js/agent.js';
import { calistir, workflowGirdileri, siparisCiktilari } from '../www/js/tools.js';
import { apkWorkflow, apkEtiketi, paketAdi } from '../www/js/apk.js';
import { gorevBaslat, yeniOturum, Depo } from '../www/js/depo.js';
import { GitHub } from '../www/js/github.js';

test('bağlam kısaltma: eski haller gider, her dosyanın güncel hali kalır', () => {
  const R = 'm/k';
  const D = 'd';
  const buyuk = (h) => h.repeat(9000);
  const oku = (yol, h) => [
    { role: 'assistant', content: null, tool_calls: [{ id: yol + h, type: 'function', function: { name: 'dosya_oku', arguments: JSON.stringify({ repo: R, dal: D, yol }) } }] },
    { role: 'tool', tool_call_id: yol + h, name: 'dosya_oku', content: buyuk(h), okumaAnahtari: `${R}#${D}#${yol}#-` },
  ];
  const yaz = (yol, h) => [
    { role: 'assistant', content: null, tool_calls: [{ id: 'y' + yol, type: 'function', function: { name: 'dosya_yaz', arguments: JSON.stringify({ repo: R, dal: D, yol, icerik: buyuk(h) }) } }] },
    { role: 'tool', tool_call_id: 'y' + yol, name: 'dosya_yaz', content: 'Commit' },
  ];
  const m = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' },
    ...oku('a', 'a'), ...oku('b', 'b'), ...oku('c', 'c'), ...yaz('a', 'A'), ...oku('b', 'B'), ...oku('d', 'd'),
    ...Array.from({ length: 6 }, (_, i) => ({ role: 'user', content: 'not' + i }))];
  sikistir(m, { okunan: {} }, 40_000);
  const tool = m.filter((x) => x.role === 'tool' && x.name === 'dosya_oku').map((x) => x.content[0] + x.content.length);
  assert.deepEqual(tool, ['a448', 'b448', 'c9000', 'B9000', 'd9000']);
  assert.ok(m[8].tool_calls[0].function.arguments.length > 9000, 'a\'nın güncel hali (yazım) korunmalı');
});

test('workflow girdileri okunur', async () => {
  const yml = 'on:\n  workflow_dispatch:\n    inputs:\n      hedef:\n        description: \'Hedef\'\n        default: \'malisah61/komando\'\n      dal:\n        default: main\njobs: {}\n';
  const g = await workflowGirdileri({ dosyaOku: async () => ({ icerik: yml }) }, 'r', 'w.yml');
  assert.deepEqual(g.map((x) => [x.ad, x.varsayilan]), [['hedef', 'malisah61/komando'], ['dal', 'main']]);
});

test('gorsel_goster doğrular ve dosyanın son değişikliğini söyler', async () => {
  const eklenen = [];
  const ctx = { ayar: {}, gorev: {}, gorsel: (g) => eklenen.push(g),
    gh: { sha: async (r, y) => (y.includes('yok') ? undefined : 'x'), sonDegisiklik: async () => ({ tarih: '2026-11-25T10:00:00Z', mesaj: 'eski görseller', sha: 'abc1234' }) } };
  assert.match(await calistir('gorsel_goster', { repo: 'r/r', yol: 'a.gd' }, ctx), /^HATA: yalnızca/);
  assert.match(await calistir('gorsel_goster', { repo: 'r/r', yol: 'yok.png' }, ctx), /bulunamadı/);
  assert.match(await calistir('gorsel_goster', { repo: 'r/r', yol: 'k.png', aciklama: 'Yeni' }, ctx), /eski görseller/);
  assert.equal(eklenen.length, 1);
});

test('dosya_agaci klasöre göre daralır; sipariş çıktıları zamana göre bulunur', async () => {
  const agac = ['siparis/oyun/20261125-185123/kahraman/gorsel.png', 'siparis/oyun/20261125-190751/kahraman/gorsel.png', 'siparis/baska/20261125-190751/x/gorsel.png', 'README.md'];
  const gh = { agac: async () => agac };
  const liste = await calistir('dosya_agaci', { repo: 'r/r', klasor: 'siparis/oyun/' }, { gh, gorev: {}, ayar: {} });
  assert.equal(liste.split('\n').length, 2);
  const c = await siparisCiktilari(gh, 'r/sprite-atolye', '2026-11-25T19:01:16Z');
  assert.match(c, /20261125-190751\/kahraman/);
  assert.doesNotMatch(c, /185123/);
});

test('APK şablonu: etiket, paket adı, kaynak klasör', () => {
  assert.equal(apkEtiketi('main', 'main'), 'son');
  assert.equal(apkEtiketi('asistan/rpg tetris', 'main'), 'apk-asistan-rpg-tetris');
  assert.equal(paketAdi('malisah61/kutu-oyunu'), 'com.asistan.kutu_oyunu');
  const y = apkWorkflow({ repo: 'malisah61/kutu-oyunu', webKlasoru: 'www', uygulamaAdi: 'Kutu', varsayilanDal: 'main' });
  assert.match(y, /"www\/" _apk\/www\//);
  assert.match(y, /"appId":"com\.asistan\.kutu_oyunu"/);
  assert.match(y, /for i in 1 2 3 4/);
});

test('görev başlatma: istek gitmezse kuyruk dosyası yazılır', async () => {
  const yazilan = [];
  const gh = {
    sha: async () => undefined, dosyaSil: async () => {}, dosyaOku: async () => { throw Object.assign(new Error('404'), { status: 404 }); },
    dosyaYaz: async (repo, yol) => { yazilan.push(yol); },
    calismaBaslat: async () => { throw new TypeError('Failed to fetch'); },
  };
  await gorevBaslat({ gh, depo: new Depo(gh, 'm/h'), asistanRepo: 'm/asistan', oturum: yeniOturum({ baslik: 'x' }), istek: 'x' });
  assert.ok(yazilan.includes('kuyruk/istek.json'));
});

test('GitHub: geçici 5xx ve kural zaman aşımında tekrar dener, POST\'ta denemez', async () => {
  let n = 0;
  let post = 0;
  globalThis.fetch = async (u, o) => {
    if (o.method === 'POST') { post++; return new Response('', { status: 500 }); }
    if (++n === 1) return new Response('{"message":"Repository rule violations found\\n\\nThe rule did not run because of a timeout."}', { status: 409 });
    if (n === 2) return new Response('', { status: 502 });
    return new Response('{"ok":1}', { status: 200 });
  };
  const gh = new GitHub('t');
  assert.deepEqual(await gh.istek('/x', { method: 'PUT', body: {} }), { ok: 1 });
  await assert.rejects(gh.istek('/y', { method: 'POST', body: {} }), /geçici bir sunucu hatası/);
  assert.equal(post, 1);
});
