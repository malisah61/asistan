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
  fn('dosya_agaci', 'Repodaki tüm dosya yollarını listeler (tanımsız, yalnızca yollar).',
    { repo: S('sahip/repo'), dal: S('dal adı (boşsa varsayılan dal)') }, ['repo']),
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
  fn('pr_birlestir', 'PR\'ı ana dala birleştirir (squash). Yalnızca kontroller geçtiyse ve kullanıcı istediyse kullan; kullanıcıdan onay istenir. Birleşince ana dalın APK\'sı da derlenir.',
    { repo: S('sahip/repo'), numara: N('PR numarası'), baslik: S('birleştirme commit başlığı (isteğe bağlı)') }, ['repo', 'numara']),
  fn('pr_ac', 'Daldaki değişiklikler için Pull Request açar.',
    { repo: S('sahip/repo'), baslik: S('PR başlığı'), aciklama: S('ne değişti, nasıl test edildi'), dal: S('değişiklik dalı'), hedef: S('hedef dal (boşsa varsayılan)') },
    ['repo', 'baslik', 'aciklama', 'dal']),
  fn('actions_durum', 'Son GitHub Actions çalışmalarını ve sonuçlarını gösterir.',
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
export const OKUMA = new Set(['repolari_listele', 'repo_haritasi', 'dosya_agaci', 'dosya_oku', 'kod_ara', 'actions_durum', 'actions_hata']);
// Para harcayabilen ya da yayın yapan iş akışları: otomatik izin açıkken bile sorulur, gece hiç başlatılmaz
const PAHALI_WORKFLOW = /siparis|sipari[sş]|uret|üret|modal|gpu|deploy|yayin|yayın|release|publish|anim|video|uc_boyut/i;
const YAZMA = new Set(['dosya_yaz', 'dosya_duzenle', 'dosya_sil', 'pr_ac', 'actions_baslat', 'dal_olustur', 'kontrol_kur', 'apk_kur', 'pr_birlestir', 'claudea_devret']);
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

async function yazmadanOnce(ctx, { repo, yol, eski, yeni, zorla }) {
  const hata = sozdizimKontrol(yol, yeni);
  if (hata) return `COMMIT YAPILMADI — sözdizimi hatası: ${hata}\nDüzeltip tekrar dene.`;

  if (!ctx.ayar.gozdenGecir || zorla) return null;
  const diff = diffUret(eski, yeni);
  // Küçük değişiklik için ayrı bir model isteği beklemeye değmez; sözdizimi kontrolü yukarıda yapıldı
  const degisen = diff.split('\n').filter((l) => /^[+-](?![+-]{2})/.test(l)).length;
  if (degisen < KUCUK_DEGISIKLIK) return null;
  try {
    const { message } = await sohbet(ctx.ayar, [
      {
        role: 'system',
        content: 'Kıdemli bir yazılımcı olarak bir kod değişikliğini gözden geçiriyorsun. Yalnızca GERÇEK hatalara itiraz et: ' +
          'çalışmayacak kod, yanlış değişken/fonksiyon adı, sözdizimi, mantık hatası, silinmiş ama hâlâ kullanılan kod, isteği karşılamama, ' +
          'yarım bırakılmış ("…", "TODO", "kalanı aynı") kod. Stil tercihlerine itiraz etme. Yalnızca JSON döndür: ' +
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
  const pahali = (ad === 'actions_baslat' && ((ctx.aktifRepo && arg.repo !== ctx.aktifRepo) || PAHALI_WORKFLOW.test(arg.workflow || ''))) ||
    ad === 'pr_birlestir'; // ana dala yazar, geri almak zahmetli
  if ((YAZMA.has(ad) && ayar.onayIste) || pahali) {
    const ozet = yeniIcerik !== undefined
      ? `${arg.repo}/${arg.yol} (${arg.dal})\n${arg.mesaj}\n\n${diffUret(eski, yeniIcerik)}`
      : (pahali ? '⚠ Bu iş akışı para harcayabilir ya da başka bir repoyu etkiler.\n\n' : '') + JSON.stringify(arg, null, 2);
    const ok = await onayla(ad, ozet, { zorunlu: pahali });
    if (!ok) return 'Kullanıcı bu işlemi reddetti. Neden reddedilmiş olabileceğini düşün, gerekirse kullanıcıya sor.';
  }

  switch (ad) {
    case 'repolari_listele':
      return JSON.stringify(await gh.repolar());
    case 'repo_haritasi':
      return await repoHaritasi(gh, arg.repo, arg.dal, { durum: ctx.durum });
    case 'dosya_agaci':
      return kisalt((await gh.agac(arg.repo, arg.dal)).join('\n'));
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
    case 'pr_birlestir': {
      const sha = await gh.prBirlestir(arg.repo, arg.numara, arg.baslik);
      return `PR #${arg.numara} birleştirildi (${String(sha).slice(0, 7)}). Ana dalın APK'sı derleniyorsa kontrol_bekle (dal: ana dal) sonra apk_linki.`;
    }
    case 'pr_ac':
      return 'PR: ' + (await gh.prAc(arg.repo, arg.baslik, arg.aciklama, arg.dal, arg.hedef));
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
      return await gh.calismaBaslat(arg.repo, arg.workflow, arg.dal, Object.keys(temiz).length ? temiz : undefined);
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
      return `Bilinmeyen araç: ${ad}. Kullanılabilenler: ${[...ARAC_ADLARI].join(', ')}`;
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
