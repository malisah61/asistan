// Bulut çalıştırıcısı: GitHub Actions'ta (gorev.yml) çalışır.
//   OTURUM=<id>  → o oturumdaki son kullanıcı mesajını işler (uygulama/web başlatır)
//   OTURUM boş   → saati gelen gece görevlerini çalıştırır (saatlik cron)
// Uygulama kapalıyken de iş sürer; ilerleme hafıza reposundaki oturum dosyasına yazılır, uygulama oradan okur.
//
// Repo herkese açık olduğu için Actions logları da açıktır: buraya sohbet ya da kod içeriği YAZILMAZ.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHub } from '../www/js/github.js';
import { Hafiza, gorevCalistir, ozDegerlendir } from '../www/js/agent.js';
import { sartOnayiAyarla, modelleriGetir, OTOMATIK, olcum } from '../www/js/llm.js';
import { Depo, HAFIZA_REPO_ADI, trSimdi, yeniId, yeniOturum } from '../www/js/depo.js';

const KAYDET_ARALIGI = 4000;
const DUR_YOKLAMA = 10_000;
const CEVAP_YOKLAMA = 5000;
const SORU_SURESI = 30 * 60_000;
// Workflow 120 dk'da öldürülür; ondan önce kendimiz durup sonucu kaydedelim
const GOREV_SURESI = 105 * 60_000;
// Saati kaçırılan gece görevi en fazla bu kadar saat gecikmeyle başlatılır
const GECE_PENCERESI = 6;
const MODEL_LISTESI_OMRU = 24 * 3600_000;

const KOK = join(fileURLToPath(import.meta.url), '..', '..');
const log = (...a) => console.log('[asistan]', ...a);
const uyu = (ms) => new Promise((r) => setTimeout(r, ms));

class AyarHatasi extends Error {}

const VARSAYILAN_AYAR = {
  model: {},
  roller: {
    planlayici: { saglayici: 'evren', model: OTOMATIK },
    gozden: { saglayici: 'evren', model: OTOMATIK },
  },
  planla: true,
  gozdenGecir: true,
  onayIste: true,
  ozDeg: true,
  maksAdim: 40,
};
// Bunlar her çalışmada yeniden kurulur, ayarlar.json'a yazılmaz
const GECICI_ALANLAR = ['anahtar', 'sira', 'degisti'];

async function dosyalar(klasor) {
  const sonuc = [];
  for (const g of await readdir(klasor, { withFileTypes: true }).catch(() => [])) {
    const yol = join(klasor, g.name);
    if (g.isDirectory()) sonuc.push(...(await dosyalar(yol)));
    else sonuc.push(yol);
  }
  return sonuc;
}

/** Gizli hafıza reposu yoksa oluşturur; ilk kez kullanılıyorsa AGENTS.md ve dersleri buradan taşır. */
async function hafizaHazirla(gh, repo) {
  if (!(await gh.repoBilgi(repo))) {
    try {
      await gh.ozelRepoOlustur(repo.split('/')[1], 'Asistan: sohbetler, dersler, gece görevleri (gizli)');
      log('gizli hafıza reposu oluşturuldu');
      await uyu(3000);
    } catch {
      throw new AyarHatasi(`Gizli hafıza reposu (${repo}) yok ve oluşturulamadı. GitHub'da bu adla private bir repo aç.`);
    }
  }
  if (await gh.sha(repo, 'AGENTS.md')) return;
  const tasinacak = [join(KOK, 'AGENTS.md'), ...(await dosyalar(join(KOK, 'hafiza')))];
  for (const yol of tasinacak) {
    const icerik = await readFile(yol, 'utf8').catch(() => null);
    if (icerik !== null) await gh.dosyaYaz(repo, relative(KOK, yol), icerik, 'hafıza: ilk taşıma');
  }
  log('AGENTS.md ve dersler gizli hafıza reposuna taşındı');
}

async function ayarHazirla(depo) {
  if (!process.env.EVREN_ANAHTAR) throw new AyarHatasi('EVREN_ANAHTAR secret tanımlı değil.');
  const kayitli = await depo.ayarlar();
  return {
    ...VARSAYILAN_AYAR,
    ...kayitli,
    roller: { ...VARSAYILAN_AYAR.roller, ...(kayitli.roller || {}) },
    anahtar: { evren: process.env.EVREN_ANAHTAR },
    sira: ['evren'],
  };
}

async function ayarKaydet(depo, ayar) {
  if (!ayar.degisti) return;
  const temiz = Object.fromEntries(Object.entries(ayar).filter(([k]) => !GECICI_ALANLAR.includes(k)));
  await depo.ayarlarYaz(temiz).catch(() => log('ayarlar kaydedilemedi'));
}

/** Uygulama ayarlarda model listesini buradan okur (web sürümü EVREN'e doğrudan bağlanamayabilir). */
async function modelListesiYaz(depo, ayar) {
  try {
    const eski = await depo.jsonOku('evren_modeller.json');
    if (eski && Date.now() - eski.zaman < MODEL_LISTESI_OMRU) return;
    const modeller = await modelleriGetir('evren', ayar.anahtar.evren);
    await depo.jsonYaz('evren_modeller.json', { zaman: Date.now(), modeller }, 'EVREN model listesi');
  } catch { /* liste şart değil */ }
}

/** Her görevin süre ve sonuç ölçümleri: neyin yavaş/hatalı olduğunu zamanla görmek için (aylık dosya). */
async function metrikYaz(depo, m) {
  const { gun } = trSimdi();
  const yol = `metrikler/${gun.slice(0, 7)}.jsonl`;
  const satir = JSON.stringify({ zaman: new Date().toISOString(), ...m });
  try {
    let eski = '';
    try { eski = (await depo.gh.dosyaOku(depo.repo, yol)).icerik; } catch { /* ayın ilk kaydı */ }
    await depo.gh.dosyaYaz(depo.repo, yol, eski + satir + '\n', 'metrik');
  } catch { /* ölçüm kaydı görevi bozmasın */ }
}

async function oturumCalistir({ gh, depo, hafiza, ayar, id, gece = false }) {
  const o = await depo.oturum(id);
  if (!o) {
    log('oturum bulunamadı');
    return;
  }
  const i = o.mesajlar.map((m) => m.rol).lastIndexOf('kullanici');
  if (i < 0) {
    log('işlenecek mesaj yok');
    return;
  }
  const istek = o.mesajlar[i].metin;
  const gecmis = o.mesajlar.slice(0, i)
    .filter((m) => m.rol === 'kullanici' || m.rol === 'asistan')
    .map((m) => ({ role: m.rol === 'kullanici' ? 'user' : 'assistant', content: m.metin }));
  // Son tamamlanmış cevaptan sonraki araç adımları = yarım kalan iş; "devam et" bunları bilsin
  // Durdurulan ya da adım sınırına takılan iş bitmiş sayılmaz
  const bitmisCevap = (m) => m.rol === 'asistan' && !/^\(Durduruldu\)|^Adım sınırına/.test(m.metin || '');
  let sonCevap = -1;
  o.mesajlar.slice(0, i).forEach((m, k) => { if (bitmisCevap(m)) sonCevap = k; });
  const yarim = o.mesajlar.slice(sonCevap + 1, i);
  // Yeni ve uzun bir istekse eski işi devam ettirme; "devam et", "tekrar dene" gibi kısa isteklerde ettir
  const devamMi = istek.length < 60 || /devam|kald[ıi][ğg]|sürdür|tekrar dene/i.test(istek);
  const onceki = devamMi ? {
    plan: o.plan || [],
    adimlar: yarim.filter((m) => m.rol === 'arac'),
    hata: [...yarim].reverse().find((m) => m.rol === 'hata')?.metin || '',
  } : null;

  // ---- kayıt: sık değişiklikleri birleştirip sırayla yaz ----
  let zamanlayici = null;
  let zincir = Promise.resolve();
  const yaz = () => {
    zincir = zincir.then(() => depo.oturumYaz(o)).catch((e) => log('kayıt hatası', e.status || ''));
    return zincir;
  };
  const sonraKaydet = () => {
    if (!zamanlayici) zamanlayici = setTimeout(() => { zamanlayici = null; yaz(); }, KAYDET_ARALIGI);
  };
  const hemenKaydet = () => {
    clearTimeout(zamanlayici);
    zamanlayici = null;
    return yaz();
  };
  const not = (metin) => o.mesajlar.push({ rol: 'not', metin, zaman: Date.now() });

  // ---- durdurma ----
  const bitis = Date.now() + GOREV_SURESI;
  let durduruldu = false;
  const durYokla = setInterval(async () => {
    try {
      if (await depo.durVarMi(id)) durduruldu = true;
    } catch { /* bir sonraki yoklamada */ }
  }, DUR_YOKLAMA);
  const durdurulduMu = () => durduruldu || Date.now() > bitis;

  // ---- kullanıcıya soru (onay / kullanım şartları) ----
  async function sor(baslik, metin, evet, tur = 'izin') {
    if (gece) return false; // gece kimse cevaplayamaz
    const soruId = yeniId();
    o.soru = { id: soruId, tur, baslik, metin: String(metin).slice(0, 20000), evet, zaman: Date.now() };
    o.durumMetni = 'Cevabını bekliyor…';
    await hemenKaydet();
    const son = Date.now() + SORU_SURESI;
    let cevap = null;
    while (Date.now() < son && !durdurulduMu()) {
      await uyu(CEVAP_YOKLAMA);
      const c = await depo.cevap(id).catch(() => null);
      if (c?.soruId === soruId) {
        cevap = Boolean(c.cevap);
        break;
      }
    }
    if (cevap === null) not(`"${baslik}" sorusuna ${SORU_SURESI / 60_000} dk içinde cevap gelmedi, reddedildi sayıldı.`);
    o.soru = null;
    await depo.sil(`oturumlar/${id}.cevap.json`, 'cevap okundu');
    await hemenKaydet();
    return Boolean(cevap);
  }

  sartOnayiAyarla((b) => sor(`${b.saglayici} kullanım şartları`,
    `${b.saglayici} kullanmaya başlamadan önce kullanım şartlarını onaylamanı istiyor (sürüm ${b.surum}).\n\n` +
    (b.mesaj ? b.mesaj + '\n\n' : '') + (b.adres ? `Şartları oku: ${b.adres}\n\n` : '') +
    'Kabul edersen bu bir kez sunucuya bildirilir ve bir daha sorulmaz.', 'Kabul ediyorum', 'sart'));

  const gorevAyari = gece ? { ...ayar, onayIste: false } : ayar;
  o.durum = 'calisiyor';
  o.durumMetni = 'Başlıyor…';
  o.kosu = { url: process.env.KOSU_URL || '', baslangic: Date.now() };
  await hemenKaydet();

  try {
    const sonuc = await gorevCalistir({
      ayar: gorevAyari, gh, hafiza, aktifRepo: o.repo, gecmis, istek, onceki,
      ui: {
        durum: (t) => { if (t) { o.durumMetni = t; sonraKaydet(); } },
        onayla: async (ad, ozet, { zorunlu = false } = {}) => {
          // Kullanıcı bu sohbette "otomatik izin" açtıysa sormadan devam et (görev sırasında da açılabilir).
          // Pahalı işlemler (zorunlu) her zaman sorulur; gece görevinde sor() zaten reddeder.
          if (!zorunlu && (await depo.otomatikIzin(id).catch(() => false))) return true;
          return sor(`İzin: ${ad}`, ozet, 'İzin ver', zorunlu ? 'pahali' : 'izin');
        },
        plan: (m) => { o.plan = m.map((x) => ({ ...x })); sonraKaydet(); },
        durdurulduMu,
        arac: (ad, arg, s, sure) => {
          o.mesajlar.push({ rol: 'arac', ad, arg: JSON.stringify(arg, null, 1).slice(0, 3000), sonuc: String(s).slice(0, 3000), sure, zaman: Date.now() });
          sonraKaydet();
        },
      },
    });
    o.mesajlar.push({ rol: 'asistan', metin: sonuc.cevap, alt: sonuc.saglayici ? `${sonuc.saglayici} · ${sonuc.model}` : '', zaman: Date.now() });
    if (sonuc.sureOzeti) not(sonuc.sureOzeti);
    await metrikYaz(depo, {
      oturum: id, repo: o.repo || '', gece, toplamSn: Math.round((Date.now() - (sonuc.gorev?.basla || Date.now())) / 1000),
      modelIstek: olcum.istek, modelSn: Math.round(olcum.sure / 1000), adim: sonuc.gorev?.adim || 0,
      arac: sonuc.gorev?.aracSayisi || 0, tekrarOkuma: sonuc.gorev?.tekrarOkuma || 0,
      kontrolHata: sonuc.gorev?.kontrolHata || 0, yazdi: Boolean(sonuc.gorev?.yazdi), dogrulandi: Boolean(sonuc.gorev?.dogrulandi),
      sonuc: durdurulduMu() ? 'durduruldu' : 'bitti',
    });
    if (Date.now() > bitis) not('Bulut görev süresi doldu. "devam et" yazarsan kaldığı yerden sürdürür.');
    if (ayar.ozDeg && !durdurulduMu()) {
      o.durumMetni = 'Bu işten ders çıkarıyor…';
      sonraKaydet();
      const ders = await ozDegerlendir({ ayar, hafiza, aktifRepo: o.repo, istek, cevap: sonuc.cevap, gorev: sonuc.gorev });
      if (ders) o.mesajlar.push({ rol: 'ders', metin: ders, zaman: Date.now() });
    }
    o.durum = durduruldu ? 'durduruldu' : 'bitti';
    log('oturum bitti');
  } catch (e) {
    o.mesajlar.push({ rol: 'hata', metin: '⚠ ' + e.message, zaman: Date.now() });
    o.durum = 'hata';
    log('oturum hatayla bitti');
    await metrikYaz(depo, { oturum: id, repo: o.repo || '', gece, modelIstek: olcum.istek, modelSn: Math.round(olcum.sure / 1000), sonuc: 'hata', hata: e.message.slice(0, 200) });
  } finally {
    clearInterval(durYokla);
    o.durumMetni = '';
    o.soru = null;
    await hemenKaydet();
    await depo.sil(`oturumlar/${id}.dur`, 'durdurma işareti temizlendi');
    await ayarKaydet(depo, ayar);
    await modelListesiYaz(depo, ayar);
  }
}

async function geceTurlari({ gh, depo, hafiza }) {
  const liste = await depo.geceGorevleri();
  const { gun, saat } = trSimdi();
  const zamani = liste.filter((g) => g.aktif !== false && g.istek && g.sonGun !== gun &&
    saat >= Number(g.saat) && saat - Number(g.saat) < GECE_PENCERESI);
  if (!zamani.length) {
    log('zamanı gelen gece görevi yok');
    return;
  }
  // Önce işaretle: üst üste binen bir çalışma aynı görevi ikinci kez başlatmasın
  await depo.jsonGuncelle('gece/gorevler.json',
    (l) => (l || []).map((g) => (zamani.some((z) => z.id === g.id) ? { ...g, sonGun: gun } : g)),
    'gece görevleri başladı', []);
  const ayar = await ayarHazirla(depo);
  for (const g of zamani) {
    const o = yeniOturum({ baslik: `🌙 ${g.ad || 'Gece görevi'} · ${gun}`, repo: g.repo });
    o.gece = true;
    o.mesajlar.push({ rol: 'kullanici', metin: g.istek, zaman: Date.now() });
    o.durum = 'kuyrukta';
    await depo.oturumYaz(o);
    log('gece görevi başlıyor');
    await oturumCalistir({ gh, depo, hafiza, ayar, id: o.id, gece: true });
  }
}

async function main() {
  if (!process.env.GH_TOKEN) throw new AyarHatasi('ASISTAN_GH_TOKEN secret tanımlı değil.');
  const gh = new GitHub(process.env.GH_TOKEN);
  const login = (await gh.kullanici()).login;
  const hafizaRepo = process.env.HAFIZA_REPO || `${login}/${HAFIZA_REPO_ADI}`;
  await hafizaHazirla(gh, hafizaRepo);
  const depo = new Depo(gh, hafizaRepo);
  const hafiza = new Hafiza(gh, hafizaRepo);
  if (process.env.OTURUM) {
    let ayar;
    try {
      ayar = await ayarHazirla(depo);
    } catch (e) {
      // Ayar eksikse kullanıcı uygulamada görsün
      const o = await depo.oturum(process.env.OTURUM);
      if (o) {
        o.mesajlar.push({ rol: 'hata', metin: '⚠ ' + e.message, zaman: Date.now() });
        o.durum = 'hata';
        o.durumMetni = '';
        await depo.oturumYaz(o);
      }
      throw e;
    }
    await oturumCalistir({ gh, depo, hafiza, ayar, id: process.env.OTURUM });
  } else {
    await geceTurlari({ gh, depo, hafiza });
  }
}

main().then(() => process.exit(0), (e) => {
  // Açık loga yalnızca kendi ayar mesajlarımızı yaz; diğer hatalar içerik taşıyabilir
  console.error('[asistan] HATA:', e instanceof AyarHatasi ? e.message : `${e.name}${e.status ? ' ' + e.status : ''}`);
  process.exit(1);
});
