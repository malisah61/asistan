// Ajan döngüsü: planlayıcı → uygulayıcı (araçlarla) → öz değerlendirme
// + bağlam sıkıştırma, tekrar algılama, metin içi araç çağrısı yedeği, akıllı ders seçimi

import { sohbet, jsonOnar, metindenAracCagrilari, olcum } from './llm.js';
import { ARACLAR, ARAC_ADLARI, OKUMA, calistir, okumaAnahtari } from './tools.js';
import { repoHaritasi } from './kontrol.js';

const YEDEK_STIL = `Önce oku ve anla, sonra planla, sonra küçük adımlarla değiştir.
Değiştirmeden önce dosyayı mutlaka oku. Varsayım yapma; emin değilsen kullanıcıya sor.
Ana dala doğrudan yazma: dal aç, commit at, kontrol_bekle ile doğrula, PR aç.`;

// ---------- Hafıza ----------

const kelimeler = (s) => new Set(
  String(s).toLocaleLowerCase('tr').split(/[^\p{L}\p{N}_#.+-]+/u).filter((w) => w.length >= 3),
);

function dersleriAyristir(metin) {
  return String(metin || '').split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => {
      const m = l.match(/^- (?:(\d{4}-\d{2}-\d{2})\s*)?(?:\[([^\]]*)\])?\s*:?\s*(.*)$/);
      return { satir: l, tarih: m?.[1] || '', etiketler: (m?.[2] || '').split(',').map((x) => x.trim()).filter(Boolean), metin: m?.[3] || l.slice(2) };
    });
}

export class Hafiza {
  constructor(gh, repo) {
    this.gh = gh;
    this.repo = repo;
    this.yol = 'hafiza/dersler.md';
  }

  async oku(yol) {
    try {
      return (await this.gh.dosyaOku(this.repo, yol)).icerik;
    } catch {
      return '';
    }
  }

  repoYolu(repo) {
    return `hafiza/repolar/${repo.replace('/', '__')}.md`;
  }

  stil() {
    return this.oku('AGENTS.md');
  }

  dersler() {
    return this.oku(this.yol);
  }

  repoDersleri(repo) {
    return repo ? this.oku(this.repoYolu(repo)) : Promise.resolve('');
  }

  /** İstekle ilgili dersleri seçer: küçük modellere 100 ders yığmak yerine en alakalı ~25'i. */
  async secilmisDersler(istek, repo) {
    const [genel, ozel] = await Promise.all([this.dersler(), this.repoDersleri(repo)]);
    const liste = dersleriAyristir(genel);
    const baglam = kelimeler(`${istek} ${repo || ''}`);
    const puanli = liste.map((d, i) => {
      let p = d.etiketler.length ? 0 : 1; // etiketsiz dersler genel kural sayılır
      for (const w of kelimeler(d.metin + ' ' + d.etiketler.join(' '))) if (baglam.has(w)) p += 2;
      for (const e of d.etiketler) if (baglam.has(e.toLocaleLowerCase('tr'))) p += 3;
      return { d, p, i };
    });
    const secilen = liste.length <= 25
      ? puanli
      : puanli.sort((a, b) => b.p - a.p || b.i - a.i).slice(0, 25).sort((a, b) => a.i - b.i);
    const repoListe = dersleriAyristir(ozel).slice(-20);
    return {
      genel: secilen.map((x) => x.d.satir).join('\n'),
      repo: repoListe.map((d) => d.satir).join('\n'),
      toplam: liste.length,
    };
  }

  async dersEkle(ders, { kapsam = 'genel', etiketler = [], repo } = {}) {
    ders = String(ders).replace(/\s+/g, ' ').trim();
    if (!ders) return;
    const repoKapsami = kapsam === 'repo' && repo && repo !== this.repo;
    const yol = repoKapsami ? this.repoYolu(repo) : this.yol;
    const mevcut = await this.oku(yol);
    if (mevcut.toLocaleLowerCase('tr').includes(ders.toLocaleLowerCase('tr'))) return;
    const tarih = new Date().toISOString().slice(0, 10);
    const etiket = Array.isArray(etiketler) && etiketler.length ? ` [${etiketler.join(',')}]` : '';
    const baslik = repoKapsami ? `# ${repo} dersleri\n` : '# Asistanın dersleri\n';
    const yeni = (mevcut || baslik).trimEnd() + `\n- ${tarih}${etiket}: ${ders}\n`;
    await this.gh.dosyaYaz(this.repo, yol, yeni, 'hafıza: yeni ders');
  }

  async yenidenYaz(icerik) {
    await this.gh.dosyaYaz(this.repo, this.yol, icerik, 'hafıza: dersler düzenlendi');
  }
}

// ---------- İstemler ----------

async function sistemMesaji(hafiza, aktifRepo, gh, istek) {
  const [stil, dersler] = await Promise.all([hafiza.stil(), hafiza.secilmisDersler(istek, aktifRepo)]);
  let repoKurallari = '';
  if (aktifRepo && aktifRepo !== hafiza.repo) {
    try {
      repoKurallari = (await gh.dosyaOku(aktifRepo, 'AGENTS.md')).icerik;
    } catch { /* yoksa sorun değil */ }
  }
  return [
    'Sen "Asistan"sın: kullanıcının GitHub repoları üzerinde çalışan bir kodlama ajanısın.',
    'Kullanıcıyla her zaman Türkçe konuş. Kısa ve net ol; telefondan okunuyor.',
    'Telefonda terminal yok: doğrulama GitHub Actions ile yapılır (kontrol_bekle).',
    '',
    '## Çalışma döngün',
    '1. repo_haritasi ile yapıyı gör, ilgili dosyaları (gerekirse satır aralığıyla) oku.',
    '2. plan_guncelle ile işi maddele. Her seferinde tek maddeye odaklan, bitince işaretle.',
    '3. asistan/<konu> dalı aç, küçük değişikliklerle commit at (dosya_duzenle tercih et).',
    '4. Değişiklik grubu bitince kontrol_bekle çağır. Repoda kontrol workflow\'u yoksa önce kontrol_kur.',
    '5. Kontrol kırıldıysa logdaki ASIL hatayı bul ve düzelt. En fazla 3 deneme; sonra danis kullan, yine olmazsa claudea_devret.',
    '6. Kontroller geçince pr_ac ve kullanıcıya kısa özet ver.',
    'Araçları her zaman tool_calls ile çağır. Bilmediğin bir şeyi uydurma; repoda ara ya da oku.',
    '',
    '## Hız',
    'Her model turu çok zaman alır. Birden çok dosya okuyacaksan hepsini AYNI yanıtta, birden çok tool_call ile iste.',
    'Okuduğun ve değişmeyen dosyayı yeniden okuma. Büyük dosyada yalnızca ilgili satır aralığını oku.',
    '',
    '## Sormadan yapmayacakların',
    'İstek belirsizse ya da birden fazla anlama gelebiliyorsa, pahalı bir işe girişmeden önce kullanıcıya TEK kısa soru sor ve dur.',
    'Başka bir sistemi (workflow, API) çağırmadan önce tanımını oku; girdilerini açıkça ver, varsayılana güvenme.',
    'Para harcayabilen (GPU üretimi, yayın) ya da aktif repo dışındaki işlemler için kullanıcı onayı gerekir; bunu atlatmaya çalışma.',
    'İSTİSNA: Sprite Atölye (sprite-atolye) siparişleri onaysızdır, bütçesi kendi sınırlı. Oyuna görsel gerekiyorsa siparis.json\'u yaz ve siparis.yml\'i hedef/dal girdileriyle KENDİN başlat; kullanıcıya bırakma.',
    'Başlattığın iş akışını actions_bekle ile bekle (bitince Sprite Atölye çıktılarının yollarını da verir); actions_durum\'u döngüde çağırma, aynı siparişi ikinci kez başlatma.',
    'Klasör ya da dosya adını asla tahmin etme (ör. zaman damgalı klasörler): dosya_agaci ile klasor vererek listele.',
    '',
    '## İşi bitirmek',
    'Oyun ya da uygulama işinde iş, kullanıcının deneyebileceği bir şey verince biter:',
    '- HTML/JS ise ve repoda APK workflow\'u yoksa apk_kur ile ekle; kontrol_bekle ile derlemeyi bekle; apk_linki ile linki al ve raporda "APK: <link>" olarak ver.',
    '- Godot ise repodaki derleme workflow\'unu bekle ve apk_linki ile bak.',
    '- Kullanıcı "birleştir", "main\'e al", "bitir" derse ve kontroller geçtiyse pr_birlestir kullan (onay istenir), sonra ana dalın APK linkini ver.',
    '',
    '## Görsel ve link paylaşımı',
    'Görselle ilgili bir iş yaptıysan (üretim, sprite, ikon, ekran görüntüsü) sonucu gorsel_goster ile sohbete ekle; mümkünse eskisini de göster ki karşılaştırılsın.',
    'PR, commit, Actions çalışması ve dosyalar için tam linki (https://github.com/...) yaz; kullanıcı tek dokunuşla açabilsin.',
    '',
    '## Son rapor biçimi (2–6 kısa satır)',
    '**Ne değişti:** … · **Nerede:** PR/commit linki · **Nasıl test edildi:** … (test edemediğini açıkça yaz) · **Senden gereken:** … (yoksa yazma)',
    'İstenip YAPILMAYAN ya da atlanan bir şey varsa (ör. 12 dosyadan 4\'ü) mutlaka söyle. Yapmadığını yapılmış gibi anlatma.',
    '',
    '## Çalışma stilin (AGENTS.md)',
    stil || YEDEK_STIL,
    '',
    `## Geçmiş işlerden öğrendiğin dersler (${dersler.toplam} dersten seçilenler)`,
    dersler.genel || '(henüz ders yok)',
    dersler.repo ? `\n## ${aktifRepo} reposuna özel dersler\n${dersler.repo}` : '',
    repoKurallari ? `\n## ${aktifRepo} reposunun kendi kuralları\n${repoKurallari.slice(0, 6000)}` : '',
    '',
    aktifRepo ? `Aktif repo: ${aktifRepo}` : 'Aktif repo seçilmedi; gerekirse repolari_listele ile bak.',
    `Bugün: ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');
}

/** Güçlü model önce düşünür: hangi dosyalar, hangi adımlar, hangi riskler. */
async function planCikar({ ayar, gh, aktifRepo, istek, gecmis, ui, gorev }) {
  let harita = '';
  if (aktifRepo) {
    try {
      harita = await repoHaritasi(gh, aktifRepo, null, { durum: ui.durum });
      // Ajan aynı haritayı repo_haritasi ile tekrar isterse GitHub'a gitmesin
      if (gorev) {
        gorev.haritaOnbellek = gorev.haritaOnbellek || {};
        gorev.haritaOnbellek[`${aktifRepo}#`] = harita; // varsayılan dal: tools.js anahtarı `${repo}#${dal||''}`
      }
    } catch { /* harita olmadan da plan çıkarılabilir */ }
  }
  const sonKonusma = gecmis.slice(-4).map((m) => `${m.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${String(m.content).slice(0, 600)}`).join('\n');
  const { message, model } = await sohbet(ayar, [
    {
      role: 'system',
      content: 'Kıdemli bir yazılım mimarısın. Bir kodlama ajanına iş planı hazırlıyorsun. ' +
        'Yalnızca JSON döndür: {"basit": bool, "plan": ["kısa somut adım", …], "dosyalar": ["ilgili dosya yolu", …], "riskler": "dikkat edilecekler"}. ' +
        'Soru-cevap ya da tek adımlık işse basit:true ve plan boş olsun. Plan en fazla 7 adım olsun; kod değişikliği varsa son adım "kontrol_bekle ile doğrula ve PR aç" olsun.\n' +
        'ÖNEMLİ: Ajan telefonda çalışır; terminal, klonlama, ortam değişkeni, yerel dosya YOK. Yalnızca şu araçları kullanabilir: ' +
        [...ARAC_ADLARI].join(', ') + '. Plan adımlarında başka araç ya da komut uydurma.',
    },
    {
      role: 'user',
      content: `${sonKonusma ? `Önceki konuşma:\n${sonKonusma}\n\n` : ''}İstek: ${istek}\n\n${harita ? harita.slice(0, 10000) : '(aktif repo yok)'}`,
    },
  ], null, ui.durum, 'planlayici');
  const v = jsonOnar(message.content);
  if (!v || v.basit || !Array.isArray(v.plan) || !v.plan.length) return null;
  return { plan: v.plan.map(String).slice(0, 7), dosyalar: (v.dosyalar || []).slice(0, 12), riskler: v.riskler || '', model, harita };
}

// ---------- Bağlam yönetimi ----------

const boyut = (m) => (m.content?.length || 0) + JSON.stringify(m.tool_calls || '').length;

/** Uzun görevlerde eski araç sonuçlarını ve büyük dosya içeriklerini kısaltır. */
// Her adımda bütün bağlam yeniden gönderiliyor; küçük tutmak EVREN'in her adımını hızlandırır
// 35k'da dört dosya bile sığmıyordu: kısaltılan dosyalar tekrar tekrar okunup turlar artıyordu (25 Kasım, 123 okuma)
const BAGLAM_SINIRI = 60_000;
// Kısa istekler (ör. "devam et", tek satırlık düzeltme) için ayrı plan isteği yapılmaz
const PLAN_ESIGI = 60;

const dosyaYolu = (a) => (a && a.repo && a.yol ? `${a.repo}#${a.dal || ''}#${a.yol}` : null);

/** Her dosyanın bağlamdaki güncel hali: yazmadan sonraki son okumalar ya da (sonra okunmadıysa) son tam yazım. */
function guncelMesajlar(mesajlar) {
  const sonYazma = new Map(); // dosya yolu → mesaj indeksi (dosya_yaz tam içerik taşır)
  const sonOkuma = new Map(); // okuma anahtarı (yol + satır aralığı) → mesaj indeksi
  mesajlar.forEach((m, i) => {
    if (m.role === 'tool' && m.okumaAnahtari) sonOkuma.set(m.okumaAnahtari, i);
    if (m.role === 'assistant' && m.tool_calls) {
      for (const c of m.tool_calls) {
        if (c.function?.name === 'dosya_yaz') {
          const y = dosyaYolu(jsonOnar(c.function.arguments));
          if (y) sonYazma.set(y, i);
        }
      }
    }
  });
  const guncel = new Set();
  const okunanYollar = new Map(); // yol → en son okuma indeksi
  for (const [anahtar, i] of sonOkuma) {
    const yol = anahtar.replace(/#[^#]*$/, '');
    if (i > (sonYazma.get(yol) ?? -1)) guncel.add(i);
    okunanYollar.set(yol, Math.max(i, okunanYollar.get(yol) ?? -1));
  }
  for (const [yol, i] of sonYazma) if (i > (okunanYollar.get(yol) ?? -1)) guncel.add(i);
  return guncel;
}

function sikistir(mesajlar, gorev, limit = BAGLAM_SINIRI) {
  let toplam = mesajlar.reduce((t, m) => t + boyut(m), 0);
  if (toplam <= limit) return;
  const korunan = mesajlar.length - 6; // son 6 mesaj olduğu gibi kalsın
  // Önce eskimiş içerikler (dosyanın sonradan okunmuş/yazılmış eski halleri) kısaltılır; her dosyanın güncel hali
  // bağlamda kalır ki model aynı dosyayı tekrar okumak zorunda kalmasın. Yine sığmazsa hepsi.
  const guncel = guncelMesajlar(mesajlar);
  // Eskiler bolca kısaltılır (her turda yeniden kısaltmaya gerek kalmasın); güncel içeriğe yalnızca sınır aşılırsa dokunulur
  for (const [tur, hedef] of [['eski', limit * 0.7], ['hepsi', limit]]) {
    if (toplam <= hedef) continue;
    for (let i = 2; i < korunan && toplam > hedef; i++) {
      if (tur === 'eski' && guncel.has(i)) continue;
      toplam -= kisaltBir(mesajlar[i], gorev);
    }
  }
}

/** Mesajı kısaltır, kazanılan karakter sayısını döner. */
function kisaltBir(m, gorev) {
  {
    const once = boyut(m);
    if (m.role === 'tool' && m.content.length > 500 && !m.sikisti) {
      m.content = m.content.slice(0, 400) + `\n…(eski sonuç kısaltıldı; gerekirse yeniden oku)`;
      m.sikisti = true;
      // İçerik artık bağlamda yok: bu dosya tekrar okunursa "zaten okudun" denmesin
      if (m.okumaAnahtari && gorev?.okunan?.[m.okumaAnahtari]) gorev.okunan[m.okumaAnahtari].sikisti = true;
    } else if (m.role === 'assistant' && m.tool_calls) {
      for (const c of m.tool_calls) {
        const a = jsonOnar(c.function.arguments);
        if (a && typeof a === 'object') {
          for (const k of ['icerik', 'yeni', 'eski', 'soru', 'aciklama']) {
            if (typeof a[k] === 'string' && a[k].length > 300) a[k] = `(${a[k].length} karakter, kısaltıldı)`;
          }
          c.function.arguments = JSON.stringify(a);
        }
      }
    }
    return once - boyut(m);
  }
}

function planNotu(plan) {
  if (!plan?.length) return null;
  const satir = plan.map((m, i) => `${i + 1}. [${m.durum === 'bitti' ? 'x' : m.durum === 'suruyor' ? '>' : ' '}] ${m.metin}`).join('\n');
  const sira = plan.find((m) => m.durum !== 'bitti');
  return `(otomatik not) Plan durumu:\n${satir}\n${sira ? `Şimdiki odak: ${sira.metin}` : 'Tüm maddeler bitti: doğrula ve kullanıcıya özet ver.'}`;
}

// ---------- Ana döngü ----------

const ONCEKI_ADIM = 40;

function oncekiOzeti(onceki) {
  if (!onceki?.adimlar?.length && !onceki?.plan?.length) return '';
  const satirlar = (onceki.adimlar || []).slice(-ONCEKI_ADIM).map((a) => {
    const arg = String(a.arg || '').replace(/\s+/g, ' ').slice(0, 220);
    const sonuc = String(a.sonuc || '').replace(/\s+/g, ' ').slice(0, 160);
    return `- ${a.ad} ${arg} → ${sonuc}`;
  });
  return [
    '(otomatik not) Bu sohbette daha önce bu işe başladın, kaldığın yerden devam et. BAŞTAN BAŞLAMA.',
    'Açtığın dalı yeniden açma, yaptığın değişiklikleri tekrarlama. Bir dosyayı yalnızca değiştireceksen ya da içeriğini gerçekten bilmen gerekiyorsa yeniden oku.',
    onceki.plan?.length ? `\nPlan durumu:\n${onceki.plan.map((m, i) => `${i + 1}. [${m.durum === 'bitti' ? 'x' : m.durum === 'suruyor' ? '>' : ' '}] ${m.metin}`).join('\n')}` : '',
    satirlar.length ? `\nŞimdiye kadar yaptığın adımlar (son ${satirlar.length}):\n${satirlar.join('\n')}` : '',
    onceki.hata ? `\nGeçen sefer şu hatayla yarıda kaldı: ${String(onceki.hata).slice(0, 300)}` : '',
  ].filter(Boolean).join('\n');
}

const GECICI_HATA = /yanıt vermedi|fetch failed|network|ECONNRESET|HTTP 5\d\d|HTTP 429/i;
const AG_HATA_DENEME = 3;
const AG_BEKLEME = 30_000;

/**
 * ui: { durum(t), arac(ad, arg, sonuc), onayla(ad, ozet), durdurulduMu(), plan(maddeler) }
 */
/**
 * onceki: { plan, adimlar: [{ ad, arg, sonuc }], hata } — aynı sohbetteki önceki çalışmalar.
 * "devam et" dendiğinde ajan baştan başlamasın diye ne yapıldığı özetlenip bağlama eklenir.
 */
export async function gorevCalistir({ ayar, gh, hafiza, aktifRepo, gecmis, istek, ui, onceki }) {
  const gorev = { istek, plan: [], sonSha: {}, kontrolHata: 0, gunluk: [], basla: Date.now(), aracSure: 0 };
  olcum.sifirla();
  const ctx = { gh, hafiza, ayar, aktifRepo, gorev, onayla: ui.onayla, durum: ui.durum, durdurulduMu: ui.durdurulduMu, plan: ui.plan, gorsel: ui.gorsel };

  const sistem = await sistemMesaji(hafiza, aktifRepo, gh, istek);
  const mesajlar = [{ role: 'system', content: sistem }, ...gecmis.slice(-12)];
  const devam = oncekiOzeti(onceki);
  if (devam) mesajlar.push({ role: 'user', content: devam });
  mesajlar.push({ role: 'user', content: istek });
  // Yarım kalan plan varsa ondan devam et; yeni plan çıkarma
  const yarimPlan = onceki?.plan?.length && onceki.plan.some((m) => m.durum !== 'bitti');
  if (yarimPlan) {
    gorev.plan = onceki.plan.map((m) => ({ ...m }));
    ui.plan(gorev.plan);
  }

  // 1) Planlayıcı
  if (ayar.planla !== false && istek.length >= PLAN_ESIGI && !yarimPlan) {
    try {
      const p = await planCikar({ ayar, gh, aktifRepo, istek, gecmis, ui });
      if (p) {
        gorev.plan = p.plan.map((metin, i) => ({ metin, durum: i === 0 ? 'suruyor' : 'bekliyor' }));
        ui.plan(gorev.plan);
        ui.arac('planlayıcı', { model: p.model }, `${p.plan.join('\n')}\n\nDosyalar: ${p.dosyalar.join(', ')}\nRiskler: ${p.riskler}`);
        mesajlar.push({
          role: 'user',
          content: `(otomatik not) Planlayıcı model şu planı önerdi. Uygun değilse plan_guncelle ile düzelt.\n` +
            p.plan.map((x, i) => `${i + 1}. ${x}`).join('\n') +
            (p.dosyalar.length ? `\nMuhtemel ilgili dosyalar: ${p.dosyalar.join(', ')}` : '') +
            (p.riskler ? `\nDikkat: ${p.riskler}` : '') +
            (p.harita ? `\n\n${p.harita.slice(0, 5000)}` : ''),
        });
      }
    } catch { /* plan çıkmazsa ajan kendisi planlar */ }
  }

  const maksAdim = Number(ayar.maksAdim) || 40;
  const tekrar = new Map(); // aynı başarısız çağrıyı yakala
  let bosYanit = 0;
  let aracHataSayisi = 0;
  let agHataSayisi = 0;

  for (let adim = 0; adim < maksAdim; adim++) {
    if (ui.durdurulduMu()) return { cevap: '(Durduruldu)', gorev };
    sikistir(mesajlar, gorev);
    gorev.adim = adim + 1;

    // İç işaretler (sikisti, okumaAnahtari) API'ye gitmesin; katı sunucular tanımadığı alanı reddedebilir
    const cagriMesajlari = mesajlar.map(({ sikisti, okumaAnahtari: _, ...m }) => m);
    const not = planNotu(gorev.plan);
    if (not && adim > 0) cagriMesajlari.push({ role: 'user', content: not });

    let yanit;
    try {
      yanit = await sohbet(ayar, cagriMesajlari, ARACLAR, ui.durum);
    } catch (e) {
      // Model geçersiz araç çağrısı ürettiyse (ör. olmayan araç adı) bunu söyleyip tekrar dene
      if (e.aracHatasi && aracHataSayisi < 2) {
        aracHataSayisi++;
        mesajlar.push({
          role: 'user',
          content: `(otomatik not) Son araç çağrın geçersizdi: ${e.aracHatasi}\n` +
            `Yalnızca şu araçları, tanımlarındaki argümanlarla kullan: ${[...ARAC_ADLARI].join(', ')}`,
        });
        continue;
      }
      // Sunucu geçici olarak yanıt vermediyse tüm görevi bırakma: biraz bekleyip aynı adımı tekrar dene
      if (GECICI_HATA.test(e.message) && agHataSayisi < AG_HATA_DENEME && !ui.durdurulduMu()) {
        agHataSayisi++;
        ui.durum(`Model yanıt vermedi, ${AG_BEKLEME / 1000} sn sonra tekrar deneniyor (${agHataSayisi}/${AG_HATA_DENEME})…`);
        await new Promise((r) => setTimeout(r, AG_BEKLEME));
        continue;
      }
      throw e;
    }
    agHataSayisi = 0;
    const modelSn = Math.round(olcum.sonSure / 1000);
    const { message, saglayici, model } = yanit;
    let cagrilar = (message.tool_calls || []).map((c, i) => ({ ...c, id: c.id || `cagri_${adim}_${i}`, type: 'function' }));
    if (!cagrilar.length) cagrilar = metindenAracCagrilari(message.content, ARAC_ADLARI);

    mesajlar.push({
      role: 'assistant',
      content: message.content || (cagrilar.length ? null : ''),
      ...(cagrilar.length ? { tool_calls: cagrilar } : {}),
    });

    if (!cagrilar.length) {
      const metin = (message.content || '').trim();
      // Plan yarımken "şimdi şunu yapacağım" deyip duran zayıf modelleri dürt
      const yarim = gorev.plan.some((m) => m.durum !== 'bitti');
      if ((!metin || (yarim && /yapaca[ğg][ıi]m|şimdi|ardından|let me|i will/i.test(metin) && metin.length < 400)) && bosYanit < 2) {
        bosYanit++;
        mesajlar.push({ role: 'user', content: '(otomatik not) Söylediğini şimdi araç çağırarak yap. Plan bittiyse kullanıcıya son özeti yaz.' });
        continue;
      }
      // Kod yazıp hiç doğrulamadan "bitti" demesin (bir kez hatırlat; kontrol yoksa raporda söylesin)
      if (gorev.yazdi && !gorev.dogrulandi && !gorev.dogrulamaHatirlatildi) {
        gorev.dogrulamaHatirlatildi = true;
        mesajlar.push({
          role: 'user',
          content: '(otomatik not) Dosya değiştirdin ama kontrol_bekle ile doğrulamadın. Önce kontrol_bekle çağır (repoda kontrol yoksa kontrol_kur). ' +
            'Doğrulama mümkün değilse son raporda bunu açıkça yaz.',
        });
        continue;
      }
      return { cevap: metin || '(boş yanıt)', gorev, saglayici, model, sureOzeti: sureOzeti(gorev) };
    }
    bosYanit = 0;

    // Okuma çağrıları aynı anda başlatılır; yazma/silme içeren çağrılar sırayla işlenir (çakışma olmasın)
    const calistirBir = async (c) => {
      const arg = jsonOnar(c.function?.arguments);
      if (arg === null) return { arg, sonuc: 'HATA: argümanlar geçerli JSON değil. Daha kısa parçalarla ve geçerli JSON ile tekrar dene.', sure: 0 };
      const bas = Date.now();
      try {
        return { arg, sonuc: String(await calistir(c.function?.name, arg, ctx)), sure: Date.now() - bas };
      } catch (e) {
        return { arg, sonuc: `HATA: ${e.message}`, sure: Date.now() - bas };
      }
    };
    let hazir = null;
    if (paralel) {
      ui.durum(`${cagrilar.length} okuma aynı anda yapılıyor…`);
      const bas = Date.now();
      hazir = await Promise.all(cagrilar.map(calistirBir));
      gorev.aracSure += Date.now() - bas;
    }

    for (const [ci, c] of cagrilar.entries()) {
      const ad = c.function?.name;
      let arg;
      let sonuc;
      let sure;
      if (hazir.has(ci)) {
        ({ arg, sonuc, sure } = hazir.get(ci));
      } else {
        ui.durum(`${ad} çalışıyor…`);
        ({ arg, sonuc, sure } = await calistirBir(c));
        gorev.aracSure += sure;
      }
      gorev.aracSayisi = (gorev.aracSayisi || 0) + 1;
      if (arg !== null) {
        const anahtar = ad + JSON.stringify(arg);
        if (/^(HATA|COMMIT YAPILMADI)/.test(sonuc)) {
          const n = (tekrar.get(anahtar) || 0) + 1;
          tekrar.set(anahtar, n);
          if (n >= 2) sonuc += '\n(otomatik not) Bu çağrıyı aynen tekrarlıyorsun ve aynı hatayı alıyorsun. Farklı bir yol dene ya da danis kullan.';
        }
      }
      // Model süresi adımın ilk aracına yazılır (aynı yanıtta birden fazla araç olabilir)
      ui.arac(ad, arg, sonuc, { model: ci === 0 ? modelSn : null, arac: Math.round(sure / 1000) });
      if (/^\(Bu dosyayı\/bölümü/.test(sonuc)) gorev.tekrarOkuma = (gorev.tekrarOkuma || 0) + 1;
      gorev.gunluk.push(`${ad}(${JSON.stringify(arg).slice(0, 160)}) → ${sonuc.slice(0, 200).replace(/\n/g, ' ')}`);
      mesajlar.push({
        role: 'tool', tool_call_id: c.id, name: ad, content: sonuc,
        ...(ad === 'dosya_oku' && arg ? { okumaAnahtari: okumaAnahtari(arg) } : {}),
      });
    }

    if (gorev.devredildi) {
      return { cevap: `Bu işi Claude'a devrettim: ${gorev.devredildi}\nGece çalışan görev çözüp PR açacak.`, gorev, saglayici, model, sureOzeti: sureOzeti(gorev) };
    }
  }
  return { cevap: `Adım sınırına (${maksAdim}) ulaştım. "devam et" yazarsan kaldığım yerden sürdürürüm.`, gorev, sureOzeti: sureOzeti(gorev) };
}

const dk = (ms) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} dk` : `${Math.round(ms / 1000)} sn`);

/** Nerede vakit geçtiğini gösteren kısa özet: model mi, araçlar (ör. build bekleme) mi. */
function sureOzeti(gorev) {
  const toplam = Date.now() - gorev.basla;
  const ort = olcum.istek ? olcum.sure / olcum.istek : 0;
  return `⏱ Toplam ${dk(toplam)} · model ${dk(olcum.sure)} (${olcum.istek} istek, ortalama ${dk(ort)}) · araçlar ${dk(gorev.aracSure)}`;
}

// ---------- Öz değerlendirme ----------

export async function ozDegerlendir({ ayar, hafiza, aktifRepo, istek, cevap, gorev }) {
  if (!gorev?.gunluk?.length) return null;
  const istem = [
    { role: 'system', content: 'Bir kodlama ajanının az önceki işini değerlendiriyorsun. Yalnızca JSON döndür.' },
    {
      role: 'user',
      content: `Repo: ${aktifRepo || '-'}\nİstek: ${istek}\n\nAraç günlüğü:\n${gorev.gunluk.join('\n').slice(0, 7000)}\n\nSonuç: ${String(cevap).slice(0, 1500)}\n\n` +
        'Bu işte bir hata, boşa giden adım, tekrar eden zorluk ya da kullanıcı tercihi ortaya çıktıysa gelecekte işe yarayacak TEK kısa ve genel ders yaz. ' +
        'Yalnızca bu repoya özgüyse kapsam "repo", her işte geçerliyse "genel". Etiketler dil/araç/konu olsun (örn. godot, csharp, js, actions). ' +
        'Önemli bir şey yoksa ders null. Biçim: {"ders": "...", "kapsam": "genel|repo", "etiketler": ["..."]} ya da {"ders": null}',
    },
  ];
  try {
    const { message } = await sohbet(ayar, istem, null, () => {}, 'gozden');
    const v = jsonOnar(message.content);
    if (v?.ders) await hafiza.dersEkle(v.ders, { kapsam: v.kapsam, etiketler: v.etiketler, repo: aktifRepo });

    const tum = await hafiza.dersler();
    if (dersleriAyristir(tum).length > 60) await dersleriBirlestir({ ayar, hafiza, tum });
    return v?.ders || null;
  } catch {
    return null;
  }
}

async function dersleriBirlestir({ ayar, hafiza, tum }) {
  const { message } = await sohbet(ayar, [
    { role: 'system', content: 'Ders listesini düzenliyorsun. Yalnızca markdown döndür.' },
    {
      role: 'user',
      content: 'Aşağıdaki dersleri birleştir: tekrarları ve eskimişleri at, benzerleri tek maddede topla, en fazla 35 madde kalsın. ' +
        'Başlık "# Asistanın dersleri" olsun. Her madde "- YYYY-AA-GG [etiket1,etiket2]: ders" biçiminde kalsın (etiketsizse köşeli parantez yazma).\n\n' + tum,
    },
  ], null, () => {}, 'planlayici');
  const yeni = (message.content || '').replace(/^```\w*\n?|```$/g, '').trim();
  if (yeni.startsWith('# ') && dersleriAyristir(yeni).length >= 10) await hafiza.yenidenYaz(yeni + '\n');
}
