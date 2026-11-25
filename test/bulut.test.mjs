// Uçtan uca: uygulama görevi başlatır → bulut çalıştırıcısı (gerçek bulut/calistir.mjs, ayrı süreç) çalıştırır.
// Şart onayı sorusu sohbete gelir, cevaplanınca görev biter, metrik yazılır. Gece görevi saati gelince bir kez çalışır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DURUM = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'asistan-')), 'durum.json');
process.env.SAHTE_DURUM = DURUM;
const { sahteDurum } = await import('./yardimci/sahte.mjs');
fs.writeFileSync(DURUM, JSON.stringify(sahteDurum()));
const { GitHub } = await import('../www/js/github.js');
const { Depo, gorevBaslat, yeniOturum, trSimdi } = await import('../www/js/depo.js');

const gh = new GitHub('t');
const ortam = { ...process.env, GH_TOKEN: 't', EVREN_ANAHTAR: 'k', SAHTE_DURUM: DURUM };
const calistirici = ['--import', path.join(KOK, 'test/yardimci/sahte.mjs'), path.join(KOK, 'bulut/calistir.mjs')];

test('görev başlar, şart sorusu cevaplanır, biter', async () => {
  await gh.ozelRepoOlustur('asistan-hafiza');
  const depo = new Depo(gh, 'malisah61/asistan-hafiza');
  const o = yeniOturum({ baslik: 'deneme', repo: 'malisah61/oyun' });
  await gorevBaslat({ gh, depo, asistanRepo: 'malisah61/asistan', oturum: o, istek: 'oyunu incele' });
  assert.equal(JSON.parse(fs.readFileSync(DURUM)).dispatch.at(-1).inputs.oturum, o.id);

  const c = spawn('node', calistirici, { cwd: KOK, env: { ...ortam, OTURUM: o.id } });
  let cikti = '';
  c.stdout.on('data', (d) => { cikti += d; });
  c.stderr.on('data', (d) => { cikti += d; });
  let soruldu = false;
  const yokla = setInterval(async () => {
    const s = await depo.oturum(o.id).catch(() => null);
    if (s?.soru && !soruldu) { soruldu = true; await depo.cevapla(o.id, s.soru.id, true); }
  }, 300);
  const kod = await new Promise((r) => c.on('exit', r));
  clearInterval(yokla);
  assert.equal(kod, 0, cikti);
  assert.ok(soruldu, 'EVREN şart sorusu sohbete gelmeli');

  const son = await depo.oturum(o.id);
  assert.equal(son.durum, 'bitti');
  assert.deepEqual(son.mesajlar.map((m) => m.rol).slice(0, 3), ['kullanici', 'arac', 'asistan']);
  const durum = JSON.parse(fs.readFileSync(DURUM));
  assert.ok(Object.keys(durum.repos['malisah61/asistan-hafiza']).some((k) => k.startsWith('metrikler/')), 'metrik yazılmalı');
  // Açık loga içerik sızmamalı
  assert.ok(!cikti.includes('oyunu incele'), 'log sohbet içeriği taşımamalı');
});

test('gece görevi saatinde bir kez çalışır', async () => {
  const depo = new Depo(gh, 'malisah61/asistan-hafiza');
  const { saat } = trSimdi();
  await depo.geceGorevleriYaz([
    { id: 'a', ad: 'Gece', repo: 'malisah61/oyun', istek: 'incele', saat, aktif: true },
    { id: 'b', ad: 'Sonra', repo: 'malisah61/oyun', istek: 'x', saat: (saat + 2) % 24, aktif: true },
  ]);
  const kos = () => execFileSync('node', calistirici, { cwd: KOK, env: { ...ortam, OTURUM: '' } }).toString();
  assert.match(kos(), /gece görevi başlıyor/);
  assert.match(kos(), /zamanı gelen gece görevi yok/);
  const g = await depo.geceGorevleri();
  assert.ok(g.find((x) => x.id === 'a').sonGun);
  assert.ok(!g.find((x) => x.id === 'b').sonGun);
});
