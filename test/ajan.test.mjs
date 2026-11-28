// Ajan döngüsü: paralel okuma ve sıra, tekrar okuma engeli, doğrulamadan bitirmeme,
// pahalı/serbest iş akışı onayı, dali_birlestir şartı, API'ye iç alan gitmemesi.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const R = 'malisah61/oyun';
const cagri = (ad, arg) => ({ id: ad + Math.random(), type: 'function', function: { name: ad, arguments: JSON.stringify(arg) } });
const WF = 'on:\n  workflow_dispatch:\n    inputs:\n      hedef:\n        default: malisah61/komando\n';

function ortam(senaryo) {
  const giden = [];
  let i = 0;
  globalThis.fetch = async (url, o) => {
    giden.push(JSON.parse(o.body).messages);
    const s = senaryo[i++] ?? 'bitti';
    const message = typeof s === 'string' ? { content: s } : { content: null, tool_calls: s };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const olay = [];
  const dosyalar = { 'a.gd': 'eski satır\nbaşka', 'b.gd': 'b içerik', 'cok.gd': Array.from({ length: 20 }, (_, k) => `satır ${k + 1}`).join('\n') };
  let surum = 0;
  const gh = {
    dosyaOku: async (repo, yol, dal, baslangic, bitis) => {
      if (yol === 'AGENTS.md') throw Object.assign(new Error('yok'), { status: 404 });
      if (yol.endsWith('.yml')) return { sha: 'w', icerik: WF };
      olay.push(`oku-bas ${yol}`);
      await new Promise((r) => setTimeout(r, 150));
      olay.push(`oku-bit ${yol}`);
      const tam = dosyalar[yol] ?? '';
      const satirlar = tam.split('\n');
      const icerik = baslangic || bitis
        ? satirlar.slice((baslangic || 1) - 1, bitis || satirlar.length).join('\n')
        : tam;
      return { sha: `${yol}@${surum}`, icerik };
    },
    sha: async () => 'x',
    dosyaYaz: async (repo, yol, icerik) => { olay.push(`yaz ${yol}`); dosyalar[yol] = icerik; surum++; gh.sonCommit = 'c' + surum; return 'https://commit'; },
    sonCommit: 'c0',
    dalSonCommit: async () => gh.sonCommit,
    kodAra: async (repo, sorgu) => { olay.push(`ara ${sorgu}`); return [{ yol: 'a.gd', satir: 1 }]; },
    agac: async () => { olay.push('agac'); return ['a.gd', 'b.gd']; },
    calismalar: async () => [{ ad: 'kontrol', durum: 'completed', sonuc: 'success' }],
    calismaBaslat: async () => 'Başlatıldı',
    yeniCalisma: async () => ({ id: 1, url: 'https://run/1' }),
    prBirlestir: async () => { olay.push('birlestir'); return 'abc1234'; },
    istek: async (yol, op = {}) => {
      if (/\/pulls\?head=/.test(yol)) return [];
      if (yol.endsWith('/pulls') && op.method === 'POST') return { number: 7, html_url: 'https://pr/7' };
      if (/\/git\/refs\/heads\//.test(yol)) return {};
      return { default_branch: 'main' };
    },
  };
  return { gh, giden, olay, dosyalar };
}

async function calistir(senaryo, ayarEk = {}) {
  const o = ortam(senaryo);
  const { gorevCalistir } = await import('../www/js/agent.js');
  const onaylar = [];
  const araclar = [];
  const sonuc = await gorevCalistir({
    ayar: { anahtar: { evren: 'k' }, model: { evren: 'deepseek-v4.1-flash' }, sira: ['evren'], roller: {}, planla: false, gozdenGecir: false, onayIste: true, ...ayarEk },
    gh: o.gh, hafiza: { repo: 'h', stil: async () => '', secilmisDersler: async () => ({ genel: '', repo: '', toplam: 0 }) },
    aktifRepo: R, gecmis: [], istek: 'a.gd düzelt',
    ui: {
      durum: () => {}, plan: () => {}, durdurulduMu: () => false,
      arac: (ad, a, s) => araclar.push([ad, String(s)]),
      onayla: async (ad, ozet, op) => { onaylar.push(`${ad}${op?.zorunlu ? ' (zorunlu)' : ''}`); return true; },
    },
  });
  return { ...o, onaylar, araclar, sonuc };
}

test('ardışık okumalar paralel, yazmadan sonraki okuma yazmayı bekler', async () => {
  const { olay } = await calistir([
    [cagri('dosya_oku', { repo: R, yol: 'a.gd' }), cagri('dosya_oku', { repo: R, yol: 'b.gd' }),
      cagri('dosya_duzenle', { repo: R, yol: 'a.gd', dal: 'asistan/x', eski: 'eski', yeni: 'yeni', mesaj: 'm' }),
      cagri('dosya_oku', { repo: R, yol: 'a.gd', dal: 'asistan/x' })],
    'Bitti.', [cagri('kontrol_bekle', { repo: R, dal: 'asistan/x' })], 'Rapor',
  ]);
  const i = (x) => olay.indexOf(x);
  assert.ok(i('oku-bas b.gd') < i('oku-bit a.gd'), 'a ve b aynı anda okunmalı');
  const yaz = i('yaz a.gd');
  assert.ok(yaz > i('oku-bit b.gd'), 'yazma okumalardan sonra');
  assert.ok(olay.lastIndexOf('oku-bas a.gd') > yaz, 'yazmadan sonraki okuma yazmayı beklemeli');
});

test('değişmemiş dosya ikinci kez gönderilmez, doğrulamadan bitirmeye izin verilmez', async () => {
  const { araclar, giden, sonuc } = await calistir([
    [cagri('dosya_oku', { repo: R, yol: 'b.gd' })],
    [cagri('dosya_oku', { repo: R, yol: 'b.gd' })],
    [cagri('dosya_duzenle', { repo: R, yol: 'a.gd', dal: 'asistan/x', eski: 'eski', yeni: 'yeni', mesaj: 'm' })],
    'Bitti.',
    [cagri('kontrol_bekle', { repo: R, dal: 'asistan/x' })],
    'Rapor',
  ]);
  assert.match(araclar[1][1], /^\(Bu dosyayı\/bölümü/);
  assert.ok(giden.some((m) => m.some((x) => String(x.content).includes('kontrol_bekle ile doğrulamadın'))));
  assert.equal(sonuc.gorev.dogrulandi, true);
  assert.ok(!giden.some((m) => m.some((x) => 'okumaAnahtari' in x || 'sikisti' in x)), 'iç alanlar API\'ye gitmemeli');
});

test('Sprite Atölye onaysız, başka repo zorunlu onay, girdisiz başlatma reddedilir', async () => {
  const { onaylar, araclar } = await calistir([
    [cagri('actions_baslat', { repo: 'malisah61/sprite-atolye', workflow: 'siparis.yml' })],
    [cagri('actions_baslat', { repo: 'malisah61/sprite-atolye', workflow: 'siparis.yml', girdiler: { hedef: R } })],
    [cagri('actions_baslat', { repo: 'malisah61/komando', workflow: 'derle.yml', girdiler: { hedef: R } })],
    'Rapor',
  ]);
  assert.match(araclar[0][1], /^BAŞLATILMADI/);
  assert.match(araclar[1][1], /^Başlatıldı/);
  assert.deepEqual(onaylar, ['actions_baslat (zorunlu)']);
});

test('dali_birlestir yalnızca doğrulanmış son commit\'te ve sormadan çalışır', async () => {
  const { araclar, onaylar, olay } = await calistir([
    [cagri('dosya_duzenle', { repo: R, yol: 'a.gd', dal: 'asistan/x', eski: 'eski', yeni: 'yeni', mesaj: 'm' })],
    [cagri('dali_birlestir', { repo: R, dal: 'asistan/x', baslik: 'düzeltme' })],
    [cagri('kontrol_bekle', { repo: R, dal: 'asistan/x' })],
    [cagri('dali_birlestir', { repo: R, dal: 'asistan/x', baslik: 'düzeltme' })],
    'Rapor',
  ], { onayIste: false });
  assert.match(araclar[1][1], /^BİRLEŞTİRİLMEDİ/);
  assert.match(araclar[3][1], /^✅/);
  assert.ok(olay.includes('birlestir'));
  assert.deepEqual(onaylar, []);
});

test('daha geniş aralık sonra dar aralık istenirse önbellekten yanıtlanır (API\'ye gitmez)', async () => {
  const { olay } = await calistir([
    [cagri('dosya_oku', { repo: R, yol: 'cok.gd', baslangic: 1, bitis: 20 })],
    [cagri('dosya_oku', { repo: R, yol: 'cok.gd', baslangic: 10, bitis: 20 })],
    'Rapor',
  ]);
  assert.equal(olay.filter((x) => x === 'oku-bas cok.gd').length, 1, 'ikinci okuma API\'ye gitmemeli');
});

test('yazma sonrası aynı dosya önbellekten değil taze okunur', async () => {
  const { olay } = await calistir([
    [cagri('dosya_oku', { repo: R, yol: 'a.gd', dal: 'asistan/x' })],
    [cagri('dosya_duzenle', { repo: R, yol: 'a.gd', dal: 'asistan/x', eski: 'eski', yeni: 'yeni', mesaj: 'm' })],
    [cagri('dosya_oku', { repo: R, yol: 'a.gd', dal: 'asistan/x' })],
    'Rapor',
  ]);
  // ilk okuma + dosya_duzenle'nin içeriği okuması + yazma sonrası taze okuma = 3
  assert.equal(olay.filter((x) => x === 'oku-bas a.gd').length, 3, 'yazma sonrası okuma taze olmalı');
});

test('dersDegerMi: kısa ve hatasız işte öz değerlendirme atlanır, hatalı/uzun işte yapılır', async () => {
  const { dersDegerMi } = await import('../www/js/agent.js');
  const g = (ek = {}) => ({ aracSayisi: 1, kontrolHata: 0, gunluk: [], ...ek });
  assert.equal(dersDegerMi(g(), 'Bitti.'), false, 'tek adımlık hatasız iş değerlendirilmemeli');
  assert.equal(dersDegerMi(g({ aracSayisi: 4 }), 'Bitti.'), true, 'uzun iş değerlendirilmeli');
  assert.equal(dersDegerMi(g({ kontrolHata: 1 }), 'Bitti.'), true, 'kontrol hatası varsa değerlendirilmeli');
  assert.equal(dersDegerMi(g({ gunluk: ['dosya_oku → HATA: yok'] }), 'Bitti.'), true, 'araç hatası varsa değerlendirilmeli');
  assert.equal(dersDegerMi(g(), 'Bunu yapamadım.'), true, 'cevapta başarısızlık varsa değerlendirilmeli');
});

test('aynı yanıttaki okumalar eşzamanlılık sınırına kadar paralel çalışır', async () => {
  // 10 dosya tek yanıtta istenir: sınır 10 olduğu için hepsi aynı anda başlamalı (tek tek değil)
  const yollar = Array.from({ length: 10 }, (_, k) => `d${k}.gd`);
  const { olay } = await calistir([
    yollar.map((y) => cagri('dosya_oku', { repo: R, yol: y })),
    'Rapor',
  ]);
  const baslar = olay.filter((x) => x.startsWith('oku-bas '));
  assert.equal(baslar.length, 10);
  // İlk dosyanın okuması bitmeden son dosyanın okuması başlamışsa gerçekten paraleldir
  assert.ok(olay.indexOf('oku-bas d9.gd') < olay.indexOf('oku-bit d0.gd'), 'okumalar paralel olmalı');
});

test('retry beklemesi üstel artar: 2 sn → 4 sn → 8 sn', async () => {
  const { retryBekleme } = await import('../www/js/agent.js');
  assert.equal(retryBekleme(1), 2000);
  assert.equal(retryBekleme(2), 4000);
  assert.equal(retryBekleme(3), 8000);
  // Eski sabit bekleme 3×8=24 sn idi; üstel toplam ~14 sn
  assert.ok(retryBekleme(1) + retryBekleme(2) + retryBekleme(3) < 3 * 8000);
});

test('aynı yanıtta aynı dosya iki kez istenirse API\'ye tek kez gidilir', async () => {
  const { olay } = await calistir([
    [cagri('dosya_oku', { repo: R, yol: 'b.gd' }), cagri('dosya_oku', { repo: R, yol: 'b.gd' })],
    'Rapor',
  ]);
  assert.equal(olay.filter((x) => x === 'oku-bas b.gd').length, 1, 'tekrar eden okuma tek istek olmalı');
});
