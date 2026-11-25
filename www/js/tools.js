// Asistanın kullanabildiği araçlar: tanımlar (modele gider) + çalıştırıcılar

import { sohbet, jsonOnar } from './llm.js';
import { sozdizimKontrol, diffUret, repoHaritasi, KONTROL_YML } from './kontrol.js';
import { APK_WORKFLOW_YOLU, apkWorkflow, apkEtiketi } from './apk.js';

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});
const S = (description) => ({ type: 'string', description });
const N = (description) => ({ type: 'integer', description });
const B = (description) => ({ type: 'boolean', description });
const O = (description) => ({ type: 'object', description, additionalProperties: { type: 'string' } });

export const ARACLAR = [
  fn('repolari_listele', 'Kullanıcının GitHub repolarını listeler.'),
  fn('repo_haritasi', 'Repodaki dosyaları VE her kod dosyasındaki fonksiyon/sınıf tanımlarını satır numaralarıyla verir. Bir repoda işe başlarken İLK bunu çağır.',
    { repo: S('sahip/repo'), dal: S('dal (boşsa varsayılan)') }, ['repo']),
  fn('dosya_agaci', 'Repodaki dosya yollarını listeler. Büyük repolarda klasor ile daralt (ör. "siparis/kutuoyunu/"). Klasör ya da dosya adını TAHMİN ETME; önce listele.',
    { repo: S('sahip/repo'), dal: S('dal adı (boşsa varsayılan dal)'), klasor: S('yalnızca bu klasörün altı (isteğe bağlı)') }, ['repo']),
  fn('web_ara', 'İnternette arar (güncel bilgi, hata mesajı, örnek, oyun/teknik araştırması). Sonuçtan önemli olanları web_oku ile oku. Raporda kaynak linklerini ver.',
    { sorgu: S('arama sorgusu (İngilizce teknik terimler daha iyi sonuç verir)') }, ['sorgu']),
  fn('web_oku', 'Bir web sayfasını okunabilir metin olarak getirir (belge, makale, GitHub sayfası). Uzun sayfalar sayfa sayfa okunur.',
    { url: S('https://… adresi'), sayfa: N('kaçıncı parça (1\'den başlar)') }, ['url']),
  fn('godot_sinif', 'Godot motorunun resmi sınıf referansı: bir sınıfın metotları (imzalarıyla), özellikleri, sinyalleri. Godot kodu yazarken bir API\'den emin değilsen UYDURMA, buna bak.',
    { sinif: S('sınıf adı, büyük/küçük harf önemli: CharacterBody2D, Node, AnimatedSprite2D'), surum: S('Godot sürümü (varsayılan 4.3)') }, ['sinif']),
  fn('alt_ajan', 'Bir araştırma ya da inceleme işini ayrı bir yardımcı ajana verir; o işi kendi bağlamında yapar (yalnızca okuma araçları + web + bağlayıcılar) ve kısa bir özet döndürür. Ana bağlamın dolmasını önler. Birbirinden bağımsız işleri aynı yanıtta birden çok alt_ajan çağrısıyla PARALEL yaptırabilirsin.',
    { gorev: S('alt ajanın yapacağı iş: ne bulunacak, ne dönülecek (net yaz)'), repo: S('ilgili repo (isteğe bağlı)') }, ['gorev']),
  fn('dosya_oku', 'Dosyayı satır numaralarıyla okur. Büyük dosyalarda haritadaki satır numaralarına göre baslangic/bitis ver; tamamını okuma. Birden çok dosya gerekiyorsa hepsini AYNI yanıtta ayrı çağrılarla iste (paralel okunur, her ayrı tur çok zaman alır).',
    { repo: S('sahip/repo'), yol: S('dosya yolu'), dal: S('dal (isteğe bağlı)'), baslangic: N('ilk satır (isteğe bağlı)'), bitis: N('son satır (isteğe bağlı)') },
    ['repo', 'yol']),
  fn('kod_ara', 'Repoda metin/kod arar (GitHub kod arama, varsayılan dalda çalışır).',
    { repo: S('sahip/repo'), sorgu: S('aranacak metin') }, ['repo', 'sorgu']),
  fn('plan_guncelle', 'Görevin yapılacaklar listesini yazar/günceller. İşe başlarken maddele, her madde bitince durumunu "bitti" yap. Aynı anda yalnızca bir madde "suruyor" olsun.',
    {
      maddeler: {
        type: 'array',
        items: { type: 'object', properties: { metin: S('madde'), durum: { type: 'string', enum: ['bekliyor', 'suruyor', 'bitti'] } }, required: ['metin', 'durum'] },
      },
    }, ['maddeler']),
  fn('dal_olustur', 'Değişiklikler için yeni bir dal açar. Ana dala doğrudan yazmak yerine bunu kullan.',
    { repo: S('sahip/repo'), dal: S('yeni dal adı, örn. asistan/ozellik-adi'), kaynak: S('kaynak dal (boşsa varsayılan)') },
    ['repo', 'dal']),
  fn('dosya_duzenle', 'Dosyada TAM eşleşen bir metni yenisiyle değiştirip commit atar. Küçük değişikliklerde bunu kullan. Commit öncesi sözdizimi kontrolü ve gözden geçirme yapılır.',
    { repo: S('sahip/repo'), yol: S('dosya yolu'), eski: S('dosyada TAM olarak bir kez geçen metin (satır numarası olmadan)'), yeni: S('yerine gelecek metin'), mesaj: S('commit mesajı'), dal: S('hedef dal'), zorla: B('gözden geçirmenin itirazı yanlışsa true') },
    ['repo', 'yol', 'eski', 'yeni', 'mesaj', 'dal']),
  fn('dosya_yaz', 'Dosyayı oluşturur ya da TAMAMEN yeni içerikle değiştirir ve commit atar. İçeriğin tamamını ver, "…" ile kısaltma yapma.',
    { repo: S('sahip/repo'), yol: S('dosya yolu'), icerik: S('dosyanın tam yeni içeriği'), mesaj: S('commit mesajı'), dal: S('hedef dal'), zorla: B('gözden geçirmenin itirazı yanlışsa true') },
    ['repo', 'yol', 'icerik', 'mesaj', 'dal']),
  fn('dosya_sil', 'Dosyayı siler.',
    { repo: S('sahip/repo'), yol: S('dosya yolu'), mesaj: S('commit mesajı'), dal: S('hedef dal') },
    ['repo', 'yol', 'mesaj', 'dal']),
  fn('kontrol_bekle', 'Son commit için GitHub Actions (build/test/kontrol) bitene kadar bekler ve sonucu, başarısızsa hata loglarını verir. Her commit grubundan sonra çağır.',
    { repo: S('sahip/repo'), dal: S('dal') }, ['repo', 'dal']),
  fn('kontrol_kur', 'Repoda .github/workflows/kontrol.yml yoksa ekler (JS/JSON/Python/GDScript sözdizimi, C# derleme, npm test). Geri bildirim döngüsü için gerekli.',
    { repo: S('sahip/repo'), dal: S('hedef dal') }, ['repo', 'dal']),
  fn('apk_kur', 'HTML/JS oyun ya da uygulamadan Android APK üreten workflow\'u repoya ekler (Capacitor). Her push\'ta APK derlenir ve Releases sayfasına konur. Godot projelerinde kullanma (repodaki kendi derleme workflow\'unu kullan).',
    { repo: S('sahip/repo'), dal: S('hedef dal'), web_klasoru: S('index.html\'in olduğu klasör ("." = kök, örn. "www")'), uygulama_adi: S('telefonda görünecek ad') },
    ['repo', 'dal']),
  fn('apk_linki', 'Bir dalın en son APK\'sının indirme linkini verir. Derleme sürüyorsa önce kontrol_bekle çağır. İş bitince bu linki kullanıcıya MUTLAKA ver.',
    { repo: S('sahip/repo'), dal: S('dal') }, ['repo', 'dal']),
  fn('dali_birlestir', 'İşin bittiği dalı ana dala alır (PR açıp hemen birleştirir, dalı siler). Yalnızca dalın SON commit\'i kontrol_bekle ile doğrulandıysa çalışır. Kullanıcıya sormadan kullan.',
    { repo: S('sahip/repo'), dal: S('birleştirilecek dal'), baslik: S('ana dalda görünecek kısa başlık'), aciklama: S('ne değişti (kısa)') },
    ['repo', 'dal', 'baslik']),
  fn('pr_birlestir', 'PR\'ı ana dala birleştirir (squash). Yalnızca kontroller geçtiyse ve kullanıcı istediyse kullan; kullanıcıdan onay istenir. Birleşince ana dalın APK\'sı da derlenir.',
    { repo: S('sahip/repo'), numara: N('PR numarası'), baslik: S('birleştirme commit başlığı (isteğe bağlı)') }, ['repo', 'numara']),
  fn('pr_ac', 'Daldaki değişiklikler için Pull Request açar.',
    { repo: S('sahip/repo'), baslik: S('PR başlığı'), aciklama: S('ne değişti, nasıl test edildi'), dal: S('değişiklik dalı'), hedef: S('hedef dal (boşsa varsayılan)') },
    ['repo', 'baslik', 'aciklama', 'dal']),
  fn('actions_bekle', 'Bir Actions çalışmasının bitmesini bekler (40 dk\'ya kadar) ve sonucu verir. Başlattığın bir iş akışını beklemek için bunu kullan; actions_durum\'u tekrar tekrar çağırma (her çağrı bir model turu harcar).',
    { repo: S('sahip/repo'), calisma_id: S('çalışma id (actions_baslat verir)') }, ['repo', 'calisma_id']),
  fn('actions_durum', 'Son GitHub Actions çalışmalarını ve sonuçlarını gösterir. Bir çalışmanın bitmesini beklemek için actions_bekle kullan.',
    { repo: S('sahip/repo'), dal: S('dal (isteğe bağlı)') }, ['repo']),
  fn('actions_hata', 'Başarısız bir Actions çalışmasının hata loglarını getirir.',
    { repo: S('sahip/repo'), calisma_id: S('çalışma id') }, ['repo', 'calisma_id']),
  fn('actions_baslat', 'workflow_dispatch destekleyen bir workflow\'u başlatır. Workflow girdi (inputs) alıyorsa hepsini girdiler ile ver: varsayılanlar başka bir repoyu hedefliyor olabilir.',
    {
      repo: S('sahip/repo'), workflow: S('workflow dosya adı, örn. apk.yml'), dal: S('dal'),
      girdiler: O('workflow girdileri, örn. {"hedef": "malisah61/acikdunya"}'),
      varsayilan_tamam: B('girdileri bilerek varsayılan bıraktıysan true'),
    }, ['repo', 'workflow']),
  fn('danis', 'Takıldığında daha güçlü planlayıcı modele danışır. Ne denediğini, hatayı ve ilgili kodu soruya yaz.',
    { soru: S('ayrıntılı soru') }, ['soru']),
  fn('claudea_devret', 'Üç denemede de çözemediğin ya da senin için fazla zor bir işi Claude\'a devreder: repoda "claude" etiketli issue açar. Gece çalışan görev bunu çözer.',
    { repo: S('sahip/repo'), baslik: S('kısa başlık'), aciklama: S('istenen iş, denediklerin, son hata, ilgili dosyalar, varsa dal adı') },
    ['repo', 'baslik', 'aciklama']),
  fn('gorsel_goster', 'Bir repodaki görseli (png/jpg/webp/gif) sohbette kullanıcıya gösterir. Ürettiğin ya da değiştirdiğin görselleri, önce/sonra karşılaştırmalarını mutlaka göster. Birden çok görsel için ayrı ayrı çağır.',
    { repo: S('sahip/repo'), yol: S('görselin yolu'), dal: S('dal (isteğe bağlı, örn. deneme-sonuclari)'), aciklama: S('görselin altına yazılacak kısa açıklama, örn. "Yeni Bakkal Hasan"') },
    ['repo', 'yol']),
  fn('ders_ekle', 'Gelecekte daha iyi çalışmak için kalıcı bir ders kaydeder (hata, çözüm, kullanıcı tercihi). Kısa ve genel yaz.',
    { ders: S('tek cümlelik ders'), kapsam: { type: 'string', enum: ['genel', 'repo'], description: 'genel: her işte geçerli; repo: yalnızca bu repoya özgü' }, etiketler: { type: 'array', items: { type: 'string' }, description: 'örn. ["godot","csharp"]' }, repo: S('kapsam repo ise sahip/repo') },
    ['ders']),
];

export const ARAC_ADLARI = new Set(ARACLAR.map((a) => a.function.name));

const GORSEL_UZANTI = /\.(png|jpe?g|webp|gif)$/i;

// Yan etkisi olmayan araçlar: aynı yanıttaki birden çok çağrı paralel çalıştırılabilir
export const OKUMA = new Set(['repolari_listele', 'repo_haritasi', 'dosya_agaci', 'dosya_oku', 'kod_ara', 'actions_durum', 'actions_hata',
  'web_ara', 'web_oku', 'godot_sinif', 'alt_ajan']);
// Para harcayabilen ya da yayın yapan iş akışları: otomatik izin açıkken bile sorulur, gece hiç başlatılmaz
const PAHALI_WORKFLOW = /siparis|sipari[sş]|uret|üret|modal|gpu|deploy|yayin|yayın|release|publish|anim|video|uc_boyut/i;
// Bütçesi kendi sınırlı olan repolar: iş akışları onaysız başlatılabilir (gece de).
// Sprite Atölye'nin Modal harcama sınırı var ($30, kart limiti $0); aşamaz. Girdi kontrolü yine yapılır.
const SERBEST_REPO = /\/sprite-atolye$/i;
const YAZMA = new Set(['dosya_yaz', 'dosya_duzenle', 'dosya_sil', 'pr_ac', 'actions_baslat', 'dal_olustur', 'kontrol_kur', 'apk_kur', 'pr_birlestir', 'claudea_devret']);
// dali_birlestir bilerek YAZMA'da değil: kullanıcı PR/onay süreciyle uğraşmak istemiyor; güvence "son commit doğrulandı" şartı.
// Tek araç sonucu üst sınırı; büyük dosyalar baslangic/bitis ile parça parça okunur (bağlam küçük kalsın)
const MAKS = 10000;
const uyu = (ms) => new Promise((r) => setTimeout(r, ms));

const kisalt = (s) => (s.length > MAKS ? s.slice(0, MAKS) + `\n…(${s.length - MAKS} karakter kesildi; baslangic/bitis ile parça parça oku)` : s);

async function eskiIcerik(gh, repo, yol, dal) {
  try {
    return (await gh.dosyaOku(repo, yol, dal)).icerik;
  } catch (e) {
    if (e.status === 404) return '';
    throw e;
  }
}

/** Commit öncesi: sözdizimi + bağımsız gözden geçirme. Engel varsa açıklama döner. */
const KUCUK_DEGISIKLIK = 12; // satır
const GOZDEN_DIFF_SINIRI = 30_000; // karakter; kesik diff gözden geçireni yanıltıyordu

async function yazmadanOnce(ctx, { repo, yol, eski, yeni, zorla }) {
  const hata = sozdizimKontrol(yol, yeni);
  if (hata) return `COMMIT YAPILMADI — sözdizimi hatası: ${hata}\nDüzeltip tekrar dene.`;

  if (!ctx.ayar.gozdenGecir || zorla) return null;
  const diff = diffUret(eski, yeni, 3, GOZDEN_DIFF_SINIRI);
  // Küçük değişiklik için ayrı bir model isteği beklemeye değmez; sözdizimi kontrolü yukarıda yapıldı
  const degisen = diff.split('\n').filter((l) => /^[+-](?![+-]{2})/.test(l)).length;
  if (degisen < KUCUK_DEGISIKLIK) return null;
  try {
    const { message } = await sohbet(ctx.ayar, [
      {
        role: 'system',
        content: 'Kıdemli bir yazılımcı olarak bir kod değişikliğini gözden geçiriyorsun. Yalnızca GERÇEK hatalara itiraz et: ' +
          'çalışmayacak kod, yanlış değişken/fonksiyon adı, sözdizimi, mantık hatası, silinmiş ama hâlâ kullanılan kod, isteği karşılamama, ' +
          'yarım bırakılmış ("…", "TODO", "kalanı aynı") kod. Stil tercihlerine itiraz etme. ' +
          'Bu commit işin YALNIZCA bir parçası olabilir: isteğin tamamını karşılamıyor diye itiraz etme. ' +
          'Diff "(diff kesildi)" ile bitiyorsa kesilen kısım hakkında (dosya yarım, sonu eksik vb.) itiraz etme; yalnızca görünen kısımda kesin hata varsa itiraz et. ' +
          'Emin olmadığın şeye itiraz etme: her itiraz dosyanın baştan yazılması demek. Yalnızca JSON döndür: ' +
          '{"onay": true} ya da {"onay": false, "sorunlar": ["…"]}',
      },
      { role: 'user', content: `Görev: ${ctx.gorev.istek}\nDosya: ${yol}\n\nDiff:\n${diff}` },
    ], null, ctx.durum, 'gozden');
    const v = jsonOnar(message.content);
    if (v && v.onay === false && v.sorunlar?.length) {
      return `COMMIT YAPILMADI — gözden geçiren model itiraz etti:\n- ${v.sorunlar.join('\n- ')}\n` +
        'Haklıysa düzeltip tekrar dene. İtiraz yanlışsa aynı çağrıyı zorla:true ile yap.';
    }
  } catch {
    // Gözden geçiren model ulaşılamıyorsa işi durdurma
  }
  return null;
}

async function kontrolBekle(ctx, { repo, dal }) {
  const { gh } = ctx;
  const sha = ctx.gorev.sonSha[`${repo}#${dal}`] || (await gh.dalSonCommit(repo, dal));
  const bitis = Date.now() + 10 * 60_000;
  let bulundu = false;
  while (Date.now() < bitis) {
    if (ctx.durdurulduMu()) return 'Kullanıcı durdurdu.';
    const runs = await gh.calismalar(repo, null, sha);
    if (runs.length) bulundu = true;
    const suren = runs.filter((r) => r.durum !== 'completed');
    if (bulundu && !suren.length) {
      const basarisiz = runs.filter((r) => !['success', 'skipped', 'neutral'].includes(r.sonuc));
      if (!basarisiz.length) {
        ctx.gorev.kontrolHata = 0;
        ctx.gorev.dogrulandi = true;
        ctx.gorev.dogrulananlar = [...(ctx.gorev.dogrulananlar || []), `${repo}#${sha}`];
        return `✅ Tüm kontroller geçti (${runs.map((r) => r.ad).join(', ')}).`;
      }
      ctx.gorev.kontrolHata = (ctx.gorev.kontrolHata || 0) + 1;
      const detay = [];
      for (const r of basarisiz.slice(0, 2)) {
        detay.push(`## ${r.ad} (${r.sonuc}) ${r.url}\n` + JSON.stringify(await gh.calismaHatalari(repo, r.id), null, 1));
      }
      let not = `❌ ${basarisiz.length} kontrol başarısız (deneme ${ctx.gorev.kontrolHata}/3).\n`;
      if (ctx.gorev.kontrolHata >= 3) not += 'Üç kez başarısız oldu: yaklaşımını değiştir, danis aracını kullan ya da claudea_devret ile devret.\n';
      return kisalt(not + detay.join('\n\n'));
    }
    if (!bulundu && Date.now() > bitis - 9 * 60_000) {
      return 'Bu commit için hiçbir Actions çalışması başlamadı. Repoda kontrol workflow\'u yoksa kontrol_kur ile ekle.';
    }
    ctx.durum(bulundu ? `Actions sürüyor: ${suren.map((r) => r.ad).join(', ')}…` : 'Actions\'ın başlaması bekleniyor…');
    await uyu(15_000);
  }
  return 'Zaman aşımı: kontroller 10 dakikada bitmedi. Daha sonra actions_durum ile bak.';
}

export async function calistir(ad, arg, ctx) {
  const { gh, onayla, hafiza, ayar } = ctx;
  // Bağlayıcı (MCP) araçları
  const ek = ctx.ekAraclar?.get(ad);
  if (ek) return await ek.calistir(arg);

  // Yazma işlemleri: önce hazırla ve kontrol et, sonra kullanıcıdan onay al
  let yeniIcerik, eski;
  if (ad === 'dosya_duzenle' || ad === 'dosya_yaz') {
    eski = await eskiIcerik(gh, arg.repo, arg.yol, arg.dal);
    if (ad === 'dosya_duzenle') {
      if (!eski) return 'HATA: dosya bulunamadı ya da boş. Yeni dosya için dosya_yaz kullan.';
      const temiz = (arg.eski || '').replace(/^\d+\t/gm, ''); // modeller bazen satır numaralarını da kopyalıyor
      const adet = eski.split(temiz).length - 1;
      if (adet === 0) return 'HATA: "eski" metin dosyada bulunamadı. Dosyanın o bölümünü yeniden oku; boşluk, girinti ve satır sonlarını aynen kopyala.';
      if (adet > 1) return `HATA: "eski" metin ${adet} kez geçiyor. Daha fazla çevre satır ekleyerek benzersiz yap.`;
      yeniIcerik = eski.replace(temiz, () => arg.yeni);
    } else {
      yeniIcerik = arg.icerik ?? '';
      if (/^\s*(\/\/|#)\s*(\.\.\.|…)|^\s*(\.\.\.|…)\s*$|(\/\/|#)\s*(kalan[ıi]? aynı|geri kalan|rest of)/im.test(yeniIcerik) && eski.length > yeniIcerik.length * 1.5) {
        return 'HATA: içerik kısaltılmış görünüyor ve eski dosyadan çok daha kısa. dosya_yaz tam içerik ister; küçük değişiklik için dosya_duzenle kullan.';
      }
    }
    const engel = await yazmadanOnce(ctx, { repo: arg.repo, yol: arg.yol, eski, yeni: yeniIcerik, zorla: arg.zorla });
    if (engel) return engel;
  }

  // Aktif repo dışında ya da adı para harcayan bir iş akışı: kullanıcının açık onayı şart
  const serbest = ad === 'actions_baslat' && SERBEST_REPO.test(arg.repo || '');
  const pahali = (ad === 'actions_baslat' && !serbest && ((ctx.aktifRepo && arg.repo !== ctx.aktifRepo) || PAHALI_WORKFLOW.test(arg.workflow || ''))) ||
    ad === 'pr_birlestir'; // ana dala yazar, geri almak zahmetli
  if ((YAZMA.has(ad) && ayar.onayIste && !serbest) || pahali) {
    const ozet = yeniIcerik !== undefined
      ? `${arg.repo}/${arg.yol} (${arg.dal})\n${arg.mesaj}\n\n${diffUret(eski, yeniIcerik)}`
      : (pahali ? '⚠ Bu iş akışı para harcayabilir ya da başka bir repoyu etkiler.\n\n' : '') + JSON.stringify(arg, null, 2);
    const ok = await onayla(ad, ozet, { zorunlu: pahali });
    if (!ok) return 'Kullanıcı bu işlemi reddetti. Neden reddedilmiş olabileceğini düşün, gerekirse kullanıcıya sor.';
  }

  switch (ad) {
    case 'web_ara':
      return await webAra(arg.sorgu, ortamDegiskenleri());
    case 'web_oku':
      return await webOku(arg.url, Number(arg.sayfa) || 1, ortamDegiskenleri());
    case 'godot_sinif':
      return await godotSinif(arg.sinif, arg.surum);
    case 'alt_ajan':
      if (!ctx.altAjan) return 'HATA: alt ajan burada kullanılamaz (alt ajan başka alt ajan açamaz).';
      return await ctx.altAjan({ gorev: arg.gorev, repo: arg.repo });
    case 'repolari_listele':
      return JSON.stringify(await gh.repolar());
    case 'repo_haritasi':
      return await repoHaritasi(gh, arg.repo, arg.dal, { durum: ctx.durum });
    case 'dosya_agaci': {
      const onek = (arg.klasor || '').replace(/^\/+/, '');
      const liste = (await gh.agac(arg.repo, arg.dal)).filter((d) => !onek || d.startsWith(onek));
      if (!liste.length) return onek ? `"${onek}" altında dosya yok. Üst klasörü listele.` : 'Repo boş.';
      const metin = liste.join('\n');
      return metin.length > MAKS
        ? kisalt(metin) + `\n(Toplam ${liste.length} dosya; liste kesildi. klasor ile daralt.)`
        : metin;
    }
    case 'dosya_oku': {
      const r = await gh.dosyaOku(arg.repo, arg.yol, arg.dal);
      if (r.klasor) return 'Bu bir klasör:\n' + r.icerik.join('\n');
      // Aynı dosyanın aynı bölümü değişmeden ve bağlamda hâlâ duruyorsa yeniden gönderme (bağlam şişmesin)
      const anahtar = okumaAnahtari(arg);
      const once = ctx.gorev.okunan?.[anahtar];
      if (once && once.sha === r.sha && !once.sikisti) {
        return `(Bu dosyayı/bölümü ${once.adim}. adımda okudun ve o zamandan beri değişmedi; içeriği yukarıda. Yeniden okuma, devam et.)`;
      }
      ctx.gorev.okunan = { ...(ctx.gorev.okunan || {}), [anahtar]: { sha: r.sha, adim: ctx.gorev.adim || 0 } };
      const satirlar = r.icerik.split('\n');
      const bas = Math.max(1, Number(arg.baslangic) || 1);
      const son = Math.min(satirlar.length, Number(arg.bitis) || satirlar.length);
      const parca = satirlar.slice(bas - 1, son).map((l, i) => `${bas + i}\t${l}`).join('\n');
      const baslik = bas > 1 || son < satirlar.length ? `(${satirlar.length} satırın ${bas}-${son} arası)\n` : '';
      return kisalt(baslik + parca);
    }
    case 'kod_ara':
      return JSON.stringify(await gh.kodAra(arg.repo, arg.sorgu));
    case 'plan_guncelle': {
      const maddeler = (Array.isArray(arg.maddeler) ? arg.maddeler : [])
        .map((m) => (typeof m === 'string' ? { metin: m, durum: 'bekliyor' } : m))
        .filter((m) => m?.metin);
      ctx.gorev.plan = maddeler;
      ctx.plan?.(maddeler);
      const kalan = maddeler.filter((m) => m.durum !== 'bitti').length;
      return `Plan güncellendi: ${maddeler.length - kalan}/${maddeler.length} bitti.`;
    }
    case 'dal_olustur':
      try {
        return 'Dal açıldı: ' + (await gh.dalOlustur(arg.repo, arg.dal, arg.kaynak));
      } catch (e) {
        if (e.status === 422) return `Dal zaten var: ${arg.dal}. Bu dala yazmaya devam edebilirsin.`;
        throw e;
      }
    case 'dosya_yaz':
    case 'dosya_duzenle': {
      ctx.gorev.yazdi = true;
      const url = await gh.dosyaYaz(arg.repo, arg.yol, yeniIcerik, arg.mesaj, arg.dal);
      ctx.gorev.sonSha[`${arg.repo}#${arg.dal}`] = gh.sonCommit;
      return `Commit: ${url}\nİlgili tüm değişiklikler bitince kontrol_bekle çağır.`;
    }
    case 'dosya_sil':
      await gh.dosyaSil(arg.repo, arg.yol, arg.mesaj, arg.dal);
      ctx.gorev.sonSha[`${arg.repo}#${arg.dal}`] = undefined;
      return 'Silindi';
    case 'kontrol_bekle':
      return await kontrolBekle(ctx, arg);
    case 'kontrol_kur': {
      const yol = '.github/workflows/kontrol.yml';
      if (await eskiIcerik(gh, arg.repo, yol, arg.dal)) return 'kontrol.yml zaten var.';
      await gh.dosyaYaz(arg.repo, yol, KONTROL_YML, 'kontrol workflow eklendi (asistan geri bildirim döngüsü)', arg.dal);
      ctx.gorev.sonSha[`${arg.repo}#${arg.dal}`] = gh.sonCommit;
      return 'kontrol.yml eklendi. Bu daldaki her push artık otomatik kontrol edilecek.';
    }
    case 'apk_kur': {
      const bilgi = await gh.istek(`/repos/${arg.repo}`);
      const dosyalar = await gh.agac(arg.repo, arg.dal);
      if (dosyalar.includes('project.godot') || dosyalar.some((d) => d.endsWith('/project.godot'))) {
        return 'Bu bir Godot projesi: apk_kur yalnızca HTML/JS içindir. .github/workflows altındaki mevcut derleme workflow\'una bak; yoksa kullanıcıya söyle.';
      }
      const mevcut = [];
      for (const d of dosyalar.filter((x) => /^\.github\/workflows\/.+\.ya?ml$/.test(x))) {
        const ic = await eskiIcerik(gh, arg.repo, d, arg.dal);
        if (/assembleDebug|assembleRelease|\.apk\b/.test(ic)) mevcut.push(d);
      }
      if (mevcut.length) return `Repoda zaten APK üreten workflow var: ${mevcut.join(', ')}. Onu kullan; derleme bitince apk_linki ile linki al.`;
      const klasor = (arg.web_klasoru || '').replace(/^\.\/|\/$/g, '') ||
        (dosyalar.includes('index.html') ? '.' : (dosyalar.filter((d) => d.endsWith('/index.html')).sort((a, b) => a.length - b.length)[0] || '').replace(/\/index\.html$/, ''));
      if (!klasor || !dosyalar.includes(klasor === '.' ? 'index.html' : `${klasor}/index.html`)) {
        return 'HATA: index.html bulunamadı. Önce oyunun index.html dosyasını yaz ya da web_klasoru ver.';
      }
      const icerik = apkWorkflow({ repo: arg.repo, webKlasoru: klasor, uygulamaAdi: arg.uygulama_adi || arg.repo.split('/')[1], varsayilanDal: bilgi.default_branch });
      await gh.dosyaYaz(arg.repo, APK_WORKFLOW_YOLU, icerik, 'APK derleme workflow\'u eklendi (Asistan)', arg.dal);
      ctx.gorev.sonSha[`${arg.repo}#${arg.dal}`] = gh.sonCommit;
      return `APK workflow\'u eklendi (${APK_WORKFLOW_YOLU}, web klasörü: ${klasor}). Derleme başladı: kontrol_bekle çağır, sonra apk_linki ile linki al.`;
    }
    case 'apk_linki': {
      const bilgi = await gh.istek(`/repos/${arg.repo}`);
      const etiket = apkEtiketi(arg.dal, bilgi.default_branch);
      const rel = await gh.releaseEtiket(arg.repo, etiket);
      const apk = rel?.assets?.find((a) => a.name.endsWith('.apk'));
      if (!apk) {
        // Release oluşturulamadıysa (GitHub 5xx) APK son başarılı derlemenin Artifacts bölümündedir
        const runs = await gh.istek(`/repos/${arg.repo}/actions/runs?branch=${encodeURIComponent(arg.dal)}&status=success&per_page=10`);
        for (const r of runs.workflow_runs || []) {
          const art = await gh.istek(`/repos/${arg.repo}/actions/runs/${r.id}/artifacts`);
          if (art.artifacts?.some((a) => /apk/i.test(a.name))) {
            return `APK release sayfasında yok ama derlendi: ${r.html_url}\n(Sayfanın altındaki "Artifacts" bölümünden zip olarak indirilir, içinden .apk çıkar; GitHub'a giriş gerekir.) ` +
              `Commit: ${r.head_sha.slice(0, 7)}. Bu linki son raporda kullanıcıya ver.`;
          }
        }
        return `"${etiket}" etiketiyle APK yok. Derleme hâlâ sürüyor olabilir (kontrol_bekle) ya da repoda APK workflow'u yoktur (apk_kur). Releases: https://github.com/${arg.repo}/releases`;
      }
      const son = await gh.dalSonCommit(arg.repo, arg.dal);
      const guncel = !rel.target_commitish || son.startsWith(rel.target_commitish) || rel.target_commitish === arg.dal || (rel.body || '').includes(son.slice(0, 7));
      return `APK: ${apk.browser_download_url}\nSürüm sayfası: ${rel.html_url}\n` +
        (guncel ? 'Bu APK dalın en son commit\'inden derlendi.' : `UYARI: Bu APK dalın son commit'inden (${son.slice(0, 7)}) önce derlenmiş; yeni derleme bitmemiş olabilir, kontrol_bekle çağırıp tekrar bak.`) +
        '\nBu linki son raporda kullanıcıya ver (telefondan indirip kurabilir).';
    }
    case 'dali_birlestir': {
      const bilgi = await gh.istek(`/repos/${arg.repo}`);
      const ana = bilgi.default_branch;
      if (arg.dal === ana) return 'Zaten ana daldasın; birleştirilecek bir şey yok.';
      const son = await gh.dalSonCommit(arg.repo, arg.dal);
      if (!(ctx.gorev.dogrulananlar || []).includes(`${arg.repo}#${son}`)) {
        return `BİRLEŞTİRİLMEDİ: ${arg.dal} dalının son commit'i (${son.slice(0, 7)}) doğrulanmadı. Önce kontrol_bekle çağır; geçerse tekrar dene.`;
      }
      const sahip = arg.repo.split('/')[0];
      const acik = await gh.istek(`/repos/${arg.repo}/pulls?head=${encodeURIComponent(`${sahip}:${arg.dal}`)}&state=open`);
      let pr = acik[0];
      if (!pr) {
        pr = await gh.istek(`/repos/${arg.repo}/pulls`, { method: 'POST', body: { title: arg.baslik, body: (arg.aciklama || '') + '\n\n_Asistan tarafından otomatik birleştirildi._', head: arg.dal, base: ana } });
      }
      try {
        await gh.prBirlestir(arg.repo, pr.number, arg.baslik);
      } catch (e) {
        if (e.status === 405 || e.status === 409) {
          return `BİRLEŞTİRİLEMEDİ: ${arg.dal} ana dalla çakışıyor (${pr.html_url}). Ana daldaki değişiklikleri dala al ya da kullanıcıya bildir.`;
        }
        throw e;
      }
      try { await gh.istek(`/repos/${arg.repo}/git/refs/heads/${encodeURIComponent(arg.dal)}`, { method: 'DELETE' }); } catch { /* dal silinemese de iş bitti */ }
      return `✅ ${arg.dal} ana dala (${ana}) alındı: ${pr.html_url}. APK workflow'u varsa ana dalın APK'sı derleniyor: kontrol_bekle (dal: ${ana}) sonra apk_linki.`;
    }
    case 'pr_birlestir': {
      const sha = await gh.prBirlestir(arg.repo, arg.numara, arg.baslik);
      return `PR #${arg.numara} birleştirildi (${String(sha).slice(0, 7)}). Ana dalın APK'sı derleniyorsa kontrol_bekle (dal: ana dal) sonra apk_linki.`;
    }
    case 'pr_ac':
      return 'PR: ' + (await gh.prAc(arg.repo, arg.baslik, arg.aciklama, arg.dal, arg.hedef));
    case 'actions_bekle': {
      const bitis = Date.now() + ACTIONS_BEKLE_SURE;
      let w;
      while (Date.now() < bitis) {
        if (ctx.durdurulduMu()) return 'Kullanıcı durdurdu.';
        w = await gh.calisma(arg.repo, arg.calisma_id);
        if (w.durum === 'completed') break;
        ctx.durum(`${arg.repo.split('/')[1]}: "${w.ad}" sürüyor (${Math.round((Date.now() - Date.parse(w.created_at)) / 60000)} dk)…`);
        await uyu(20_000);
      }
      if (w?.durum !== 'completed') return `Zaman aşımı: ${w?.url} hâlâ sürüyor. Tekrar actions_bekle çağırabilirsin.`;
      let ek = '';
      if (w.sonuc !== 'success') {
        ek = '\nBaşarısız işler için actions_hata kullan.';
      } else if (SERBEST_REPO.test(arg.repo)) {
        ek = await siparisCiktilari(gh, arg.repo, w.created_at);
      }
      return `${w.sonuc === 'success' ? '✅' : '❌'} "${w.ad}" bitti: ${w.sonuc}. ${w.url}${ek}`;
    }
    case 'actions_durum':
      return JSON.stringify(await gh.calismalar(arg.repo, arg.dal));
    case 'actions_hata':
      return kisalt(JSON.stringify(await gh.calismaHatalari(arg.repo, arg.calisma_id), null, 1));
    case 'actions_baslat': {
      const girdiler = arg.girdiler && typeof arg.girdiler === 'object' ? arg.girdiler : {};
      const tanimli = await workflowGirdileri(gh, arg.repo, arg.workflow, arg.dal);
      // Varsayılanı olmayan ya da başka bir repoyu gösteren girdiler mutlaka açıkça verilmeli
      const eksik = tanimli.filter((g) => !(g.ad in girdiler) && (g.varsayilan === undefined || g.varsayilan.includes('/')));
      // Yanlış varsayılanla başlatmak pahalı olabilir (ör. başka oyun için GPU'da üretim): önce sor
      if (eksik.length && !arg.varsayilan_tamam) {
        return 'BAŞLATILMADI: Bu workflow şu girdileri alıyor ve sen vermedin:\n' +
          eksik.map((g) => `- ${g.ad}${g.varsayilan !== undefined ? ` (varsayılan: "${g.varsayilan}")` : ''}${g.aciklama ? ` — ${g.aciklama}` : ''}`).join('\n') +
          '\nDoğru değerleri girdiler ile ver. Varsayılanlar bu iş için gerçekten doğruysa varsayilan_tamam: true ile tekrar çağır.';
      }
      const temiz = Object.fromEntries(Object.entries(girdiler).map(([k, v]) => [k, String(v)]));
      const bas = Date.now();
      await gh.calismaBaslat(arg.repo, arg.workflow, arg.dal, Object.keys(temiz).length ? temiz : undefined);
      const w = await gh.yeniCalisma(arg.repo, arg.workflow, bas).catch(() => null);
      return w
        ? `Başlatıldı: ${w.url} (calisma_id: ${w.id}). Bitmesini actions_bekle ile bekle; aynı iş akışını tekrar BAŞLATMA.`
        : 'Başlatıldı ama çalışma henüz listede görünmüyor. Tekrar başlatma; biraz sonra actions_durum ile bak.';
    }
    case 'danis': {
      const plan = ctx.gorev.plan?.length ? '\nPlan:\n' + ctx.gorev.plan.map((m) => `[${m.durum}] ${m.metin}`).join('\n') : '';
      const { message, model } = await sohbet(ayar, [
        { role: 'system', content: 'Deneyimli bir yazılım mimarısın. Takılan bir kodlama ajanına somut, uygulanabilir ve kısa cevap ver. Emin değilsen bunu söyle.' },
        { role: 'user', content: `Görev: ${ctx.gorev.istek}${plan}\n\nSon adımlar:\n${ctx.gorev.gunluk.slice(-12).join('\n')}\n\nSoru:\n${arg.soru}` },
      ], null, ctx.durum, 'planlayici');
      return `(${model} cevabı)\n${message.content || '(boş)'}`;
    }
    case 'claudea_devret': {
      const govde = `${arg.aciklama}\n\n---\n**İstek:** ${ctx.gorev.istek}\n\n<details><summary>Asistan günlüğü</summary>\n\n` +
        '```\n' + ctx.gorev.gunluk.slice(-25).join('\n') + '\n```\n</details>\n\n_Asistan uygulaması tarafından açıldı._';
      const url = await gh.issueAc(arg.repo, arg.baslik, govde, 'claude');
      ctx.gorev.devredildi = url;
      // Gece görevi devirleri tek yerden bulsun diye hafıza reposuna da yaz
      try {
        const yol = 'hafiza/devirler.md';
        let liste = '';
        try { liste = (await gh.dosyaOku(hafiza.repo, yol)).icerik; } catch { /* ilk devir */ }
        liste = (liste || '# Claude\'a devredilen işler\n').trimEnd() +
          `\n- [ ] ${new Date().toISOString().slice(0, 10)} ${arg.repo} — ${arg.baslik} — ${url}\n`;
        await gh.dosyaYaz(hafiza.repo, yol, liste, 'hafıza: yeni devir');
      } catch { /* issue açıldı; liste yazılamasa da gece görevi issue'yu bulabilir */ }
      return `Devredildi: ${url}. Kullanıcıya bunu bildir ve görevi bitir.`;
    }
    case 'gorsel_goster': {
      if (!GORSEL_UZANTI.test(arg.yol || '')) return 'HATA: yalnızca png, jpg, jpeg, webp ya da gif gösterilebilir.';
      if (!(await gh.sha(arg.repo, arg.yol, arg.dal))) return `HATA: ${arg.repo}/${arg.yol} bulunamadı${arg.dal ? ` (${arg.dal} dalında)` : ''}. dosya_agaci ile doğru yolu bul.`;
      ctx.gorsel?.({ repo: arg.repo, yol: arg.yol, dal: arg.dal || '', aciklama: arg.aciklama || '' });
      // Model eski bir dosyayı "yeni" sanmasın: dosyanın gerçekten ne zaman değiştiğini söyle
      let son = null;
      try { son = await gh.sonDegisiklik(arg.repo, arg.yol, arg.dal); } catch { /* bilgi şart değil */ }
      return 'Görsel sohbete eklendi; kullanıcı görüyor.' +
        (son ? `\nBu dosya en son ${son.tarih?.slice(0, 16).replace('T', ' ')} tarihinde "${son.mesaj}" (${son.sha}) commit'iyle değişti. ` +
          'Açıklaman bununla tutarlı mı kontrol et: bu commit senin ya da az önceki üretimin değilse görsel ESKİ olabilir; kullanıcıya "yeni" deme, doğrusunu söyle.' : '');
    }
    case 'ders_ekle':
      await hafiza.dersEkle(arg.ders, { kapsam: arg.kapsam, etiketler: arg.etiketler, repo: arg.repo || ctx.aktifRepo });
      return 'Ders kaydedildi.';
    default:
      return `Bilinmeyen araç: ${ad}. Kullanılabilenler: ${[...ARAC_ADLARI, ...(ctx.ekAraclar?.keys() || [])].join(', ')}`;
  }
}

/** Workflow dosyasındaki workflow_dispatch girdilerini (ad, varsayılan, açıklama) basitçe okur. */
async function workflowGirdileri(gh, repo, workflow, dal) {
  let metin;
  try {
    metin = (await gh.dosyaOku(repo, `.github/workflows/${workflow}`, dal)).icerik;
  } catch {
    return [];
  }
  const satirlar = metin.split('\n');
  const bas = satirlar.findIndex((l) => /^\s*workflow_dispatch:\s*$/.test(l));
  if (bas < 0) return [];
  const ic = satirlar.slice(bas + 1);
  const i = ic.findIndex((l) => /^\s*inputs:\s*$/.test(l));
  if (i < 0 || (ic.slice(0, i).some((l) => l.trim() && !l.trim().startsWith('#') && girinti(l) <= girinti(satirlar[bas])))) return [];
  const girdiGirinti = girinti(ic[i]);
  const sonuc = [];
  let son = null;
  for (const l of ic.slice(i + 1)) {
    if (!l.trim() || l.trim().startsWith('#')) continue;
    const g = girinti(l);
    if (g <= girdiGirinti) break;
    const m = l.trim().match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    if (son === null || g <= son.girinti) {
      son = { ad: m[1], girinti: g };
      sonuc.push(son);
    } else if (m[1] === 'default') {
      son.varsayilan = m[2].replace(/^['"]|['"]$/g, '');
    } else if (m[1] === 'description') {
      son.aciklama = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return sonuc;
}

const girinti = (l) => l.match(/^\s*/)[0].length;

export const okumaAnahtari = (arg) => `${arg.repo}#${arg.dal || ''}#${arg.yol}#${arg.baslangic || ''}-${arg.bitis || ''}`;

const ACTIONS_BEKLE_SURE = 40 * 60_000;

/** Sprite Atölye siparişinin çıktı klasörleri (deneme-sonuclari dalında, çalışma başladıktan sonra oluşanlar). */
async function siparisCiktilari(gh, repo, baslangic) {
  try {
    const sinir = new Date(Date.parse(baslangic) - 60_000).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const yollar = (await gh.agac(repo, 'deneme-sonuclari')).filter((d) => /^siparis\/[^/]+\/\d{8}-\d{6}\/[^/]+\/gorsel\.png$/.test(d));
    const yeni = yollar.filter((d) => d.split('/')[2] >= sinir);
    if (!yeni.length) return '\nÇıktı klasörü bulunamadı; dosya_agaci ile dal: deneme-sonuclari, klasor: "siparis/<oyun>/" listele.';
    return `\nÇıktılar (dal: deneme-sonuclari) — gorsel_goster ile göster:\n${yeni.map((d) => '- ' + d).join('\n')}`;
  } catch {
    return '';
  }
}

// ---------- İnternet ----------

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const WEB_SURE = 30_000;
const WEB_PARCA = 9000;
const ortamDegiskenleri = () => globalThis.process?.env || {};

const varlikCoz = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

/** Bing sonuç sayfasını ayrıştırır (anahtar gerekmez; GitHub sunucularından erişilebiliyor). */
export function bingAyristir(html) {
  const sonuc = [];
  for (const parca of html.split('class="b_algo"').slice(1)) {
    const a = parca.match(/<h2[^>]*>\s*<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, '&');
    // Bing yönlendirme linki: ...&u=a1<base64url(gerçek adres)>
    const u = url.includes('bing.com/ck/') && url.match(/[?&]u=a1([^&]+)/);
    if (u) {
      try { url = Buffer.from(u[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { continue; }
    }
    const ozet = varlikCoz((parca.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '');
    if (/^https?:\/\//.test(url) && !/^https?:\/\/[^/]*bing\.com\//.test(url)) sonuc.push({ baslik: varlikCoz(a[2]), url, ozet });
  }
  return sonuc;
}

async function webAra(sorgu, ortam) {
  if (!sorgu) return 'HATA: sorgu boş.';
  const kaynaklar = [
    // İsteğe bağlı: JINA_ANAHTAR secret'ı varsa en temiz sonuç
    ortam.JINA_ANAHTAR && (async () => {
      const r = await fetch('https://s.jina.ai/?q=' + encodeURIComponent(sorgu), {
        headers: { Authorization: `Bearer ${ortam.JINA_ANAHTAR}`, Accept: 'application/json', 'X-Respond-With': 'no-content' },
        signal: AbortSignal.timeout(WEB_SURE),
      });
      return r.ok ? ((await r.json()).data || []).map((x) => ({ baslik: x.title, url: x.url, ozet: x.description || '' })) : [];
    }),
    async () => {
      const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(sorgu)}&setlang=en`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en,tr;q=0.8' }, signal: AbortSignal.timeout(WEB_SURE),
      });
      return r.ok ? bingAyristir(await r.text()) : [];
    },
    // Yedek: Marginalia açık arama API'si (küçük ama anahtarsız)
    async () => {
      const r = await fetch(`https://api.marginalia.nu/public/search/${encodeURIComponent(sorgu)}?count=8`, { signal: AbortSignal.timeout(WEB_SURE) });
      return r.ok ? ((await r.json()).results || []).map((x) => ({ baslik: x.title, url: x.url, ozet: x.description || '' })) : [];
    },
  ].filter(Boolean);
  let liste = [];
  for (const k of kaynaklar) {
    try { liste = await k(); } catch { liste = []; }
    if (liste.length) break;
  }
  if (!liste.length) {
    return 'Arama sonuç vermedi (arama servisleri isteği engellemiş olabilir). Sorguyu değiştir ya da bildiğin bir belge adresini web_oku ile doğrudan oku.';
  }
  return liste.slice(0, 8).map((x, i) => `${i + 1}. ${x.baslik}\n   ${x.url}${x.ozet ? '\n   ' + x.ozet.slice(0, 240) : ''}`).join('\n') +
    '\n\nGerekli sonuçları web_oku ile oku; raporda kullandığın linkleri ver.';
}

function htmlMetin(html) {
  return html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

async function webOku(url, sayfa, ortam) {
  if (!/^https?:\/\//i.test(url || '')) return 'HATA: url https:// ile başlamalı.';
  let metin = '';
  try {
    // Jina Reader sayfayı temiz Markdown'a çevirir (anahtarsız da çalışır, dakikada ~20 istek)
    const r = await fetch('https://r.jina.ai/' + url, {
      headers: { Accept: 'text/plain', ...(ortam.JINA_ANAHTAR ? { Authorization: `Bearer ${ortam.JINA_ANAHTAR}` } : {}) },
      signal: AbortSignal.timeout(WEB_SURE),
    });
    if (r.ok) metin = await r.text();
  } catch { /* doğrudan oku */ }
  if (!metin.trim()) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(WEB_SURE) });
    if (!r.ok) return `HATA: sayfa açılamadı (HTTP ${r.status}).`;
    const tur = r.headers.get('content-type') || '';
    const govde = await r.text();
    metin = tur.includes('html') ? htmlMetin(govde) : govde;
  }
  const toplam = Math.max(1, Math.ceil(metin.length / WEB_PARCA));
  const n = Math.min(Math.max(1, sayfa), toplam);
  return `(${url} — parça ${n}/${toplam})\n` + metin.slice((n - 1) * WEB_PARCA, n * WEB_PARCA) +
    (n < toplam ? `\n…(devamı için sayfa: ${n + 1})` : '');
}

/** Godot'nun resmi XML sınıf referansını kısa bir özete çevirir. */
export function godotXmlOzet(xml, sinif, surum) {
  const at = (s, ad) => (s.match(new RegExp(`${ad}="([^"]*)"`)) || [])[1];
  const ilkCumle = (s) => varlikCoz(s || '')
    // Godot BBCode: [member velocity] → velocity, [code]x[/code] → x, [Vector2] → Vector2
    .replace(/\[(?:member|method|param|signal|constant|enum|annotation|theme_item) ([^\]]+)\]/g, '$1')
    .replace(/\[\/?(?:code|b|i|codeblock|codeblocks|gdscript|csharp|kbd|url[^\]]*)\]/g, '').replace(/\[(\w+)\]/g, '$1').split(/(?<=\.)\s/)[0].slice(0, 140);
  const kok = xml.match(/<class [^>]*>/)?.[0] || '';
  const kisa = ilkCumle((xml.match(/<brief_description>([\s\S]*?)<\/brief_description>/) || [])[1]);
  const metotlar = [...xml.matchAll(/<method ([^>]*)>([\s\S]*?)<\/method>/g)].map(([, a, ic]) => {
    const donus = at(ic.match(/<return [^>]*>/)?.[0] || '', 'type') || 'void';
    const paramlar = [...ic.matchAll(/<param ([^>]*)\/?>/g)].map(([, p]) => `${at(p, 'name')}: ${at(p, 'type')}${at(p, 'default') !== undefined ? ' = ' + at(p, 'default') : ''}`);
    const nitelik = at(a, 'qualifiers');
    return `- ${donus} ${at(a, 'name')}(${paramlar.join(', ')})${nitelik ? ' ' + nitelik : ''} — ${ilkCumle((ic.match(/<description>([\s\S]*?)<\/description>/) || [])[1])}`;
  });
  const ozellikler = [...xml.matchAll(/<member ([^>]*)>([\s\S]*?)<\/member>/g)].map(([, a, ic]) =>
    `- ${at(a, 'type')} ${at(a, 'name')}${at(a, 'default') !== undefined ? ' = ' + at(a, 'default') : ''} — ${ilkCumle(ic)}`);
  const sinyaller = [...xml.matchAll(/<signal ([^>]*)>([\s\S]*?)<\/signal>/g)].map(([, a, ic]) =>
    `- ${at(a, 'name')}(${[...ic.matchAll(/<param ([^>]*)\/?>/g)].map(([, p]) => `${at(p, 'name')}: ${at(p, 'type')}`).join(', ')})`);
  const sabitler = [...xml.matchAll(/<constant ([^>]*)>/g)].map(([, a]) => `${at(a, 'enum') ? at(a, 'enum') + '.' : ''}${at(a, 'name')}`);
  const bolum = (b, l) => (l.length ? `\n## ${b} (${l.length})\n${l.join('\n')}` : '');
  const metin = `# ${sinif} (Godot ${surum}) — miras: ${at(kok, 'inherits') || '-'}\n${kisa}` +
    bolum('Metotlar', metotlar) + bolum('Özellikler', ozellikler) + bolum('Sinyaller', sinyaller) +
    (sabitler.length ? `\n## Sabitler\n${sabitler.join(', ')}` : '') +
    `\nTam sayfa: https://docs.godotengine.org/en/${surum}/classes/class_${sinif.toLowerCase()}.html`;
  return metin.length > MAKS ? metin.slice(0, MAKS) + '\n…(kesildi; ayrıntı için tam sayfayı web_oku ile oku)' : metin;
}

async function godotSinif(sinif, surum = '4.3') {
  if (!/^[A-Za-z0-9_]+$/.test(sinif || '')) return 'HATA: geçerli bir sınıf adı ver (ör. CharacterBody2D).';
  const v = String(surum || '4.3').replace(/-stable$/, '');
  const r = await fetch(`https://raw.githubusercontent.com/godotengine/godot/${v}-stable/doc/classes/${sinif}.xml`, { signal: AbortSignal.timeout(WEB_SURE) });
  if (r.status === 404) {
    return `"${sinif}" sınıfı Godot ${v} çekirdek referansında yok. Adın büyük/küçük harfini kontrol et (ör. CharacterBody2D) ya da modül sınıfıysa context7 / web_ara ile bak.`;
  }
  if (!r.ok) return `HATA: referans alınamadı (HTTP ${r.status}).`;
  return godotXmlOzet(await r.text(), sinif, v);
}

// Testler için (test/*.test.mjs)
export { siparisCiktilari, workflowGirdileri };
