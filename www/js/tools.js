// Asistanın kullanabildiği araçlar: tanımlar (modele gider) + çalıştırıcılar

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});
const S = (description) => ({ type: 'string', description });

export const ARACLAR = [
  fn('repolari_listele', 'Kullanıcının GitHub repolarını listeler.'),
  fn('dosya_agaci', 'Repodaki tüm dosya yollarını listeler. Kodu anlamaya buradan başla.',
    { repo: S('sahip/repo'), dal: S('dal adı (boşsa varsayılan dal)') }, ['repo']),
  fn('dosya_oku', 'Bir dosyanın içeriğini okur. Değiştirmeden önce mutlaka oku.',
    { repo: S('sahip/repo'), yol: S('dosya yolu'), dal: S('dal (isteğe bağlı)') }, ['repo', 'yol']),
  fn('kod_ara', 'Repoda metin/kod arar (GitHub kod arama, varsayılan dalda çalışır).',
    { repo: S('sahip/repo'), sorgu: S('aranacak metin') }, ['repo', 'sorgu']),
  fn('dal_olustur', 'Değişiklikler için yeni bir dal açar. Ana dala doğrudan yazmak yerine bunu kullan.',
    { repo: S('sahip/repo'), dal: S('yeni dal adı, örn. asistan/ozellik-adi'), kaynak: S('kaynak dal (boşsa varsayılan)') },
    ['repo', 'dal']),
  fn('dosya_yaz', 'Bir dosyayı oluşturur ya da TAMAMEN yeni içerikle değiştirir ve commit atar. İçeriğin tamamını ver, kısaltma yapma.',
    { repo: S('sahip/repo'), yol: S('dosya yolu'), icerik: S('dosyanın tam yeni içeriği'), mesaj: S('commit mesajı'), dal: S('hedef dal') },
    ['repo', 'yol', 'icerik', 'mesaj', 'dal']),
  fn('dosya_duzenle', 'Dosyada tam eşleşen bir metni yenisiyle değiştirip commit atar. Küçük değişikliklerde dosya_yaz yerine bunu kullan.',
    { repo: S('sahip/repo'), yol: S('dosya yolu'), eski: S('dosyada TAM olarak bir kez geçen metin'), yeni: S('yerine gelecek metin'), mesaj: S('commit mesajı'), dal: S('hedef dal') },
    ['repo', 'yol', 'eski', 'yeni', 'mesaj', 'dal']),
  fn('dosya_sil', 'Dosyayı siler.',
    { repo: S('sahip/repo'), yol: S('dosya yolu'), mesaj: S('commit mesajı'), dal: S('hedef dal') },
    ['repo', 'yol', 'mesaj', 'dal']),
  fn('pr_ac', 'Daldaki değişiklikler için Pull Request açar.',
    { repo: S('sahip/repo'), baslik: S('PR başlığı'), aciklama: S('ne değişti, nasıl test edildi'), dal: S('değişiklik dalı'), hedef: S('hedef dal (boşsa varsayılan)') },
    ['repo', 'baslik', 'aciklama', 'dal']),
  fn('actions_durum', 'Son GitHub Actions çalışmalarını (build/test) ve sonuçlarını gösterir.',
    { repo: S('sahip/repo'), dal: S('dal (isteğe bağlı)') }, ['repo']),
  fn('actions_hata', 'Başarısız bir Actions çalışmasının hata loglarını getirir. Build kırıldıysa nedenini buradan bul.',
    { repo: S('sahip/repo'), calisma_id: S('çalışma id') }, ['repo', 'calisma_id']),
  fn('actions_baslat', 'workflow_dispatch destekleyen bir workflow\'u başlatır.',
    { repo: S('sahip/repo'), workflow: S('workflow dosya adı, örn. apk.yml'), dal: S('dal') }, ['repo', 'workflow']),
  fn('ders_ekle', 'Gelecekte daha iyi çalışmak için kalıcı bir ders kaydeder (hata, çözüm, kullanıcının tercihi). Kısa ve genel yaz.',
    { ders: S('tek cümlelik ders') }, ['ders']),
];

const YAZMA = new Set(['dosya_yaz', 'dosya_duzenle', 'dosya_sil', 'pr_ac', 'actions_baslat', 'dal_olustur']);
const MAKS = 15000;

const kisalt = (s) => (s.length > MAKS ? s.slice(0, MAKS) + `\n…(${s.length - MAKS} karakter kesildi)` : s);

export async function calistir(ad, arg, { gh, onayla, hafiza, ayar }) {
  if (YAZMA.has(ad) && ayar.onayIste) {
    const ozet = ad === 'dosya_duzenle'
      ? `${arg.repo}/${arg.yol} (${arg.dal})\n— ESKİ —\n${arg.eski}\n— YENİ —\n${arg.yeni}`
      : ad === 'dosya_yaz'
        ? `${arg.repo}/${arg.yol} (${arg.dal}) — ${arg.icerik?.length || 0} karakter\n${(arg.icerik || '').slice(0, 1500)}`
        : JSON.stringify(arg, null, 2);
    const ok = await onayla(ad, ozet);
    if (!ok) return 'Kullanıcı bu işlemi reddetti. Neden reddedilmiş olabileceğini düşün, gerekirse kullanıcıya sor.';
  }

  switch (ad) {
    case 'repolari_listele':
      return JSON.stringify(await gh.repolar());
    case 'dosya_agaci': {
      const yollar = await gh.agac(arg.repo, arg.dal);
      return kisalt(yollar.join('\n'));
    }
    case 'dosya_oku': {
      const r = await gh.dosyaOku(arg.repo, arg.yol, arg.dal);
      if (r.klasor) return 'Bu bir klasör:\n' + r.icerik.join('\n');
      const satirli = r.icerik.split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n');
      return kisalt(satirli);
    }
    case 'kod_ara':
      return JSON.stringify(await gh.kodAra(arg.repo, arg.sorgu));
    case 'dal_olustur':
      return 'Dal açıldı: ' + (await gh.dalOlustur(arg.repo, arg.dal, arg.kaynak));
    case 'dosya_yaz':
      return 'Commit: ' + (await gh.dosyaYaz(arg.repo, arg.yol, arg.icerik, arg.mesaj, arg.dal));
    case 'dosya_duzenle': {
      const { icerik } = await gh.dosyaOku(arg.repo, arg.yol, arg.dal);
      const adet = icerik.split(arg.eski).length - 1;
      if (adet === 0) return 'HATA: "eski" metin dosyada bulunamadı. Dosyayı yeniden oku, boşluk ve girintiye dikkat et.';
      if (adet > 1) return `HATA: "eski" metin ${adet} kez geçiyor. Daha fazla çevre satır ekleyerek benzersiz yap.`;
      const yeni = icerik.replace(arg.eski, () => arg.yeni);
      return 'Commit: ' + (await gh.dosyaYaz(arg.repo, arg.yol, yeni, arg.mesaj, arg.dal));
    }
    case 'dosya_sil':
      await gh.dosyaSil(arg.repo, arg.yol, arg.mesaj, arg.dal);
      return 'Silindi';
    case 'pr_ac':
      return 'PR: ' + (await gh.prAc(arg.repo, arg.baslik, arg.aciklama, arg.dal, arg.hedef));
    case 'actions_durum':
      return JSON.stringify(await gh.calismalar(arg.repo, arg.dal));
    case 'actions_hata':
      return kisalt(JSON.stringify(await gh.calismaHatalari(arg.repo, arg.calisma_id), null, 1));
    case 'actions_baslat':
      return await gh.calismaBaslat(arg.repo, arg.workflow, arg.dal);
    case 'ders_ekle':
      await hafiza.dersEkle(arg.ders);
      return 'Ders kaydedildi.';
    default:
      return `Bilinmeyen araç: ${ad}`;
  }
}
