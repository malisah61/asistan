// Arayüz. Görevler bulutta (GitHub Actions, bulut/calistir.mjs) çalışır; burası oturum dosyalarını
// gizli hafıza reposuna yazar, görevi başlatır ve ilerlemeyi yoklayarak gösterir.
// Böylece uygulama kapansa da görev sürer, telefon ve web aynı sohbetleri görür.

import { OTOMATIK } from './llm.js';
import { GitHub } from './github.js';
import { VARSAYILAN_BAGLAYICILAR } from './mcp.js';
import { Hafiza } from './agent.js';
import {
  Depo, HAFIZA_REPO_ADI, CALISAN_DURUMLAR, gorevBaslat, yeniOturum, yeniId, trSimdi,
} from './depo.js';

const $ = (id) => document.getElementById(id);

const YOKLAMA_ARALIGI = 4000;
// Bu kadar süre bulutta başlamayan ya da ses vermeyen görev için uyarı göster
const BASLAMA_UYARI = 3 * 60_000;
const SESSIZ_UYARI = 20 * 60_000;

// ---------- Yerel depolama ----------
const oku = (k, v) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? v; } catch { return v; }
};
const yaz = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* dolu olabilir */ }
};

// Bulutla paylaşılan ayarlar (ayarlar.json); token gibi cihaz ayarları yalnızca burada kalır
const BULUT_ALANLARI = ['model', 'roller', 'planla', 'gozdenGecir', 'onayIste', 'ozDeg', 'maksAdim', 'baglayicilar'];
const VARSAYILAN = {
  ghToken: '',
  hafizaRepo: '',
  asistanRepo: '',
  aktifRepo: '',
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
  baglayicilar: VARSAYILAN_BAGLAYICILAR,
};
const ayar = { ...VARSAYILAN, ...oku('ayar', {}) };
// Eski sürümden kalan alanlar (sağlayıcı anahtarları, sıra) artık kullanılmıyor
delete ayar.anahtar;
delete ayar.sira;
ayar.roller = { ...(ayar.roller || {}) };
for (const r of Object.keys(VARSAYILAN.roller)) {
  ayar.roller[r] = { ...VARSAYILAN.roller[r], ...(ayar.roller[r] || {}), saglayici: 'evren' };
}

let gh = null;
let depo = null;
let liste = oku('oturumListe', []);
let oturum = null; // açık oturum
let yoklama = null;
let cevaplanan = ''; // son cevaplanan soru id'si
let gonderiliyor = false;
// Bu sohbette yazma işlemleri sorulmadan onaylansın mı? (oturum açılınca buluttan okunur)
let otomatikIzin = false;

// ---------- Biçimlendirme ----------
function kacis(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function md(s) {
  const parcalar = String(s).split(/```/);
  return parcalar.map((p, i) => {
    if (i % 2) return `<pre>${kacis(p.replace(/^\w*\n/, ''))}</pre>`;
    return kacis(p)
      // ![açıklama](https://...) → görsel (yalnızca herkese açık adresler; gizli repo görselleri gorsel mesajıyla gelir)
      .replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, '<img class="md-gorsel" src="$2" alt="$1" loading="lazy" />')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^"])(https?:\/\/[^\s)<"]+)/g, '$1<a href="$2" target="_blank">$2</a>');
  }).join('');
}
function once(t) {
  const dk = Math.round((Date.now() - t) / 60_000);
  if (dk < 1) return 'az önce';
  if (dk < 60) return `${dk} dk önce`;
  if (dk < 1440) return `${Math.round(dk / 60)} sa önce`;
  return new Date(t).toLocaleDateString('tr-TR');
}
const DURUM_IKON = { kuyrukta: '⏳', calisiyor: '⚙️', bitti: '✓', hata: '⚠', durduruldu: '■', bos: '' };

// ---------- Sohbet görünümü ----------
// Görseller her yoklamada yeniden çizilmesin diye bir kez indirilip saklanır
const gorselOnbellek = new Map();

function gorselCiz(m) {
  const kutu = document.createElement('figure');
  kutu.className = 'gorsel';
  const img = document.createElement('img');
  img.alt = m.aciklama || m.yol;
  const alt = document.createElement('figcaption');
  const link = `https://github.com/${m.repo}/blob/${m.dal || 'HEAD'}/${m.yol}`;
  alt.innerHTML = `${kacis(m.aciklama || m.yol.split('/').pop())} · <a href="${kacis(link)}" target="_blank">GitHub'da aç</a>`;
  kutu.append(img, alt);
  const anahtar = `${m.repo}#${m.dal}#${m.yol}`;
  let iste = gorselOnbellek.get(anahtar);
  if (!iste && gh) {
    iste = gh.gorselUrl(m.repo, m.yol, m.dal);
    gorselOnbellek.set(anahtar, iste);
    iste.catch(() => gorselOnbellek.delete(anahtar));
  }
  if (!iste) {
    alt.insertAdjacentText('afterbegin', '(yükleniyor) ');
  } else {
    iste.then((url) => {
      img.src = url;
      // Dokununca tam boyutta aç
      img.onclick = () => window.open(url, '_blank');
    }, (e) => { alt.insertAdjacentText('afterbegin', `⚠ yüklenemedi (${e.message}) · `); });
  }
  return kutu;
}

function mesajCiz(m) {
  if (m.rol === 'gorsel') return gorselCiz(m);
  if (m.rol === 'arac') {
    const d = document.createElement('details');
    d.className = 'arac';
    // Model düşünme süresi ve aracın kendi süresi: hangisinin yavaş olduğu görünsün
    const s = m.sure ? [m.sure.model != null ? `🧠 ${m.sure.model} sn` : '', m.sure.arac >= 1 ? `⚙ ${m.sure.arac} sn` : ''].filter(Boolean).join(' · ') : '';
    d.innerHTML = `<summary>🔧 ${kacis(m.ad)}${s ? ` <span class="sure">${kacis(s)}</span>` : ''}</summary><pre>${kacis(m.arg)}\n\n→ ${kacis(m.sonuc)}</pre>`;
    return d;
  }
  if (m.rol === 'ders' || m.rol === 'not') {
    const d = document.createElement('div');
    d.className = m.rol === 'ders' ? 'ders-notu' : 'bilgi-notu';
    d.textContent = (m.rol === 'ders' ? '📚 Yeni ders: ' : 'ℹ ') + m.metin;
    return d;
  }
  const d = document.createElement('div');
  d.className = 'mesaj ' + m.rol;
  // Tanınmayan mesaj türü (ör. yeni sürümden gelen) "undefined" yazmasın
  d.innerHTML = md(m.metin ?? '') + (m.alt ? `<div class="alt">${kacis(m.alt)}</div>` : '');
  return d;
}

function sohbetiCiz() {
  const kutu = $('sohbet');
  const altta = kutu.scrollHeight - kutu.scrollTop - kutu.clientHeight < 80;
  // Yeniden çizimde kullanıcının açtığı araç detayları açık kalsın
  const acik = new Set([...kutu.querySelectorAll('details.arac')].map((d, i) => (d.open ? i : -1)).filter((i) => i >= 0));
  kutu.innerHTML = '';
  if (!oturum || !oturum.mesajlar?.length) {
    kutu.appendChild(mesajCiz({ rol: 'asistan', metin: hosgeldinMetni() }));
  } else {
    let i = 0;
    for (const m of oturum.mesajlar) {
      const el = mesajCiz(m);
      if (m.rol === 'arac' && acik.has(i++)) el.open = true;
      kutu.appendChild(el);
    }
  }
  if (altta || !oturum) kutu.scrollTop = kutu.scrollHeight;

  $('oturumBaslik').textContent = oturum ? oturum.baslik : 'Yeni sohbet';
  izinCiz();
  const calisiyor = Boolean(oturum && CALISAN_DURUMLAR.has(oturum.durum));
  planGoster(calisiyor || oturum?.plan?.some((m) => m.durum !== 'bitti') ? oturum.plan : []);
  durumGoster();
  $('gonder').textContent = calisiyor ? '■' : '➤';
  soruGoster();
}

function hosgeldinMetni() {
  if (!ayar.ghToken) return 'Merhaba! Başlamak için ⚙ Ayarlar\'dan GitHub token gir ve "Bulut kurulumu"nu kontrol et.';
  return 'Merhaba! Üstten bir repo seç ve ne yapmak istediğini yaz.\nGörev bulutta çalışır: uygulamayı kapatsan da sürer, sonra ☰ Sohbetler\'den bakabilirsin.';
}

function planGoster(maddeler) {
  const kutu = $('planKutu');
  if (!maddeler?.length) {
    kutu.hidden = true;
    return;
  }
  const biten = maddeler.filter((m) => m.durum === 'bitti').length;
  $('planOzet').textContent = `Plan · ${biten}/${maddeler.length}`;
  $('planListe').innerHTML = maddeler
    .map((m) => `<li class="${kacis(m.durum || '')}">${kacis(m.metin)}</li>`).join('');
  kutu.hidden = false;
  if (!kutu.dataset.elle) kutu.open = true;
}
$('planKutu').addEventListener('toggle', (e) => { e.target.dataset.elle = '1'; });

function durumGoster(metin) {
  const d = $('durum');
  let t = metin || '';
  if (!t && oturum && CALISAN_DURUMLAR.has(oturum.durum)) {
    const sessiz = Date.now() - (oturum.guncelleme || Date.now());
    t = oturum.durumMetni || (oturum.durum === 'kuyrukta' ? 'Bulutta sıraya alındı…' : 'Çalışıyor…');
    if (oturum.durum === 'kuyrukta' && sessiz > BASLAMA_UYARI) {
      t = `Bulut görevi başlamadı. ■ ile durdurup mesajını tekrar gönder. Actions: https://github.com/${ayar.asistanRepo}/actions`;
    } else if (oturum.durum === 'calisiyor' && sessiz > SESSIZ_UYARI) {
      t = `${once(oturum.guncelleme)} beri ses yok, takılmış olabilir.${oturum.kosu?.url ? ' ' + oturum.kosu.url : ''}`;
    }
  }
  d.hidden = !t;
  d.innerHTML = md(t);
}

// ---------- Soru / onay ----------
function soruGoster() {
  const s = oturum?.soru;
  const panel = $('onay');
  if (!s || s.id === cevaplanan || !CALISAN_DURUMLAR.has(oturum.durum)) {
    if (panel.dataset.soru) {
      panel.hidden = true;
      delete panel.dataset.soru;
    }
    return;
  }
  if (panel.dataset.soru === s.id) return;
  panel.dataset.soru = s.id;
  $('onayBaslik').textContent = s.baslik;
  $('onayMetin').innerHTML = md(s.metin);
  $('onayEvet').textContent = s.evet || 'İzin ver';
  // Kullanım şartları gibi sorular toptan onaylanmaz
  $('onayHep').hidden = s.tur === 'sart' || s.tur === 'pahali';
  panel.hidden = false;
  const id = oturum.id;
  const bitir = async (v) => {
    panel.hidden = true;
    delete panel.dataset.soru;
    cevaplanan = s.id;
    durumGoster(v ? 'Onay gönderiliyor…' : 'Ret gönderiliyor…');
    try {
      await depo.cevapla(id, s.id, v);
    } catch (e) {
      cevaplanan = '';
      durumGoster('⚠ Cevap gönderilemedi: ' + e.message);
    }
  };
  $('onayEvet').onclick = () => bitir(true);
  $('onayHayir').onclick = () => bitir(false);
  $('onayHep').onclick = async () => {
    await izinAyarla(true);
    bitir(true);
  };
}

// ---------- Otomatik izin ----------
function izinCiz() {
  const b = $('izinBtn');
  // Ayarlarda onay kapalıysa zaten hiçbir şey sorulmuyor
  b.hidden = !ayar.onayIste;
  b.textContent = otomatikIzin ? '🔓 Otomatik izin' : '🔒 İzin sorulur';
  b.classList.toggle('acik', otomatikIzin);
}

async function izinAyarla(deger) {
  otomatikIzin = deger;
  izinCiz();
  if (!oturum || !depo) return; // yeni sohbet: ilk mesajla birlikte kaydedilir
  oturum.otomatikIzin = deger;
  yaz('oturum:' + oturum.id, oturum);
  try {
    await depo.izinYaz(oturum.id, deger);
  } catch (e) {
    durumGoster('⚠ İzin ayarı kaydedilemedi: ' + e.message);
  }
}

$('izinBtn').onclick = () => izinAyarla(!otomatikIzin);

async function izinOku() {
  otomatikIzin = Boolean(oturum?.otomatikIzin);
  izinCiz();
  if (!oturum || !depo) return;
  try {
    otomatikIzin = await depo.otomatikIzin(oturum.id);
    izinCiz();
  } catch { /* yoksa kapalı */ }
}

// ---------- Bağlantı ----------
async function baglan() {
  gh = null;
  depo = null;
  if (!ayar.ghToken) return false;
  gh = new GitHub(ayar.ghToken);
  const k = await gh.kullanici();
  // Eski sürümde hafıza asistan reposundaydı; artık ayrı ve gizli
  if (!ayar.hafizaRepo || ayar.hafizaRepo === `${k.login}/asistan`) ayar.hafizaRepo = `${k.login}/${HAFIZA_REPO_ADI}`;
  if (!ayar.asistanRepo) ayar.asistanRepo = `${k.login}/asistan`;
  yaz('ayar', ayar);
  if (!(await gh.repoBilgi(ayar.hafizaRepo))) {
    try {
      await gh.ozelRepoOlustur(ayar.hafizaRepo.split('/')[1], 'Asistan: sohbetler, dersler, gece görevleri (gizli)');
    } catch {
      throw new Error(`Gizli hafıza reposu (${ayar.hafizaRepo}) yok ve oluşturulamadı. GitHub'da bu adla **private** bir repo aç ("Add a README" işaretli), sonra uygulamayı yeniden aç: https://github.com/new`);
    }
  }
  depo = new Depo(gh, ayar.hafizaRepo);
  return true;
}

async function listeyiYenile() {
  if (!depo) return;
  liste = await depo.liste();
  yaz('oturumListe', liste);
  if (!$('oturumlar').hidden) oturumListesiCiz();
}

async function oturumAc(id) {
  durdurYoklama();
  const ozet = liste.find((x) => x.id === id);
  oturum = oku('oturum:' + id, null) || (ozet ? { ...ozet, mesajlar: [], plan: [] } : null);
  yaz('sonOturum', id);
  delete $('planKutu').dataset.elle;
  repoSeciciAyarla();
  sohbetiCiz();
  izinOku();
  await oturumuTazele();
}

async function oturumuTazele() {
  if (!depo || !oturum) return;
  try {
    const yeni = await depo.oturum(oturum.id);
    if (!yeni) return;
    const degisti = yeni.guncelleme !== oturum.guncelleme || yeni.mesajlar?.length !== oturum.mesajlar?.length;
    oturum = yeni;
    yaz('oturum:' + oturum.id, oturum);
    if (degisti) sohbetiCiz();
    else durumGoster();
  } catch (e) {
    durumGoster('⚠ ' + e.message);
  }
  if (CALISAN_DURUMLAR.has(oturum.durum)) {
    baslatYoklama();
  } else {
    durdurYoklama();
    const l = liste.find((x) => x.id === oturum.id);
    if (l && l.durum !== oturum.durum) listeyiYenile().catch(() => {});
  }
}

function baslatYoklama() {
  if (yoklama) return;
  yoklama = setInterval(() => {
    if (!document.hidden) oturumuTazele();
  }, YOKLAMA_ARALIGI);
}
function durdurYoklama() {
  clearInterval(yoklama);
  yoklama = null;
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    oturumuTazele();
    listeyiYenile().catch(() => {});
  }
});

// ---------- Görev ----------
async function gonder() {
  if (gonderiliyor) return;
  if (oturum && CALISAN_DURUMLAR.has(oturum.durum)) {
    // Hiç başlamamış (sırada takılmış) görevi durdurmak için bulutta onu okuyacak bir çalışma yok: burada kapat
    const takili = oturum.durum === 'kuyrukta' && Date.now() - (oturum.guncelleme || 0) > BASLAMA_UYARI;
    durumGoster('Durduruluyor…');
    try {
      if (takili) {
        oturum.durum = 'durduruldu';
        oturum.durumMetni = '';
        oturum.mesajlar.push({ rol: 'not', metin: 'Bulut görevi başlamadığı için durduruldu. Mesajını tekrar gönderebilirsin.', zaman: Date.now() });
        await depo.oturumYaz(oturum);
        sohbetiCiz();
      } else {
        await depo.durIste(oturum.id);
      }
    } catch (e) {
      durumGoster('⚠ ' + e.message);
    }
    return;
  }
  const istek = $('giris').value.trim();
  if (!istek) return;
  if (!depo) return ayarlariAc();

  gonderiliyor = true;
  $('gonder').disabled = true;
  try {
    if (!oturum) {
      oturum = yeniOturum({ baslik: istek, repo: $('repoSec').value });
      oturum.otomatikIzin = otomatikIzin;
      if (otomatikIzin) await depo.izinYaz(oturum.id, true);
    }
    yaz('sonOturum', oturum.id);
    oturum.repo = $('repoSec').value || oturum.repo;
    $('giris').value = '';
    boyutla();
    await gorevBaslat({ gh, depo, asistanRepo: ayar.asistanRepo, oturum, istek });
    yaz('oturum:' + oturum.id, oturum);
    sohbetiCiz();
    baslatYoklama();
    listeyiYenile().catch(() => {});
  } catch (e) {
    // Mesaj kaydedildi ama görev başlatılamadıysa kullanıcı görsün
    if (oturum) {
      oturum.durum = 'hata';
      oturum.mesajlar.push({ rol: 'hata', metin: `⚠ Görev başlatılamadı: ${e.message}` });
      depo.oturumYaz(oturum).catch(() => {});
      sohbetiCiz();
    }
  } finally {
    gonderiliyor = false;
    $('gonder').disabled = false;
  }
}

// ---------- Repo seçici ----------
async function repolariYukle() {
  if (!gh) return;
  try {
    const l = await gh.repolar();
    $('repoSec').innerHTML = '<option value="">Repo seçilmedi</option>' +
      l.filter((r) => r.ad !== ayar.hafizaRepo)
        .map((r) => `<option value="${kacis(r.ad)}">${kacis(r.ad.split('/')[1])}${r.ozel ? ' 🔒' : ''}</option>`).join('');
    repoSeciciAyarla();
  } catch (e) {
    durumGoster('⚠ Repolar alınamadı: ' + e.message);
  }
}
function repoSeciciAyarla() {
  const r = (oturum ? oturum.repo : ayar.aktifRepo) || '';
  if (r && ![...$('repoSec').options].some((o) => o.value === r)) {
    $('repoSec').insertAdjacentHTML('beforeend', `<option value="${kacis(r)}">${kacis(r.split('/')[1])}</option>`);
  }
  $('repoSec').value = r;
}
$('repoSec').onchange = (e) => {
  ayar.aktifRepo = e.target.value;
  yaz('ayar', ayar);
  if (oturum) oturum.repo = e.target.value; // bir sonraki mesajla kaydedilir
};

// ---------- Sohbetler paneli ----------
function oturumListesiCiz() {
  const kutu = $('oturumListe');
  if (!liste.length) {
    kutu.innerHTML = '<p class="not">Henüz sohbet yok.</p>';
    return;
  }
  kutu.innerHTML = liste.map((o) => `
    <div class="oturum-satir ${oturum?.id === o.id ? 'secili' : ''}" data-ac="${kacis(o.id)}">
      <div class="oturum-bilgi">
        <b>${kacis(DURUM_IKON[o.durum] || '')} ${kacis(o.baslik)}</b>
        <small>${kacis(o.repo ? o.repo.split('/')[1] : 'repo yok')} · ${once(o.guncelleme)}</small>
      </div>
      <button data-sil="${kacis(o.id)}" title="Sil">🗑</button>
    </div>`).join('');
}
$('oturumListe').onclick = async (e) => {
  const sil = e.target.closest('[data-sil]');
  if (sil) {
    const id = sil.dataset.sil;
    if (!confirm('Bu sohbet silinsin mi?')) return;
    try {
      await depo.oturumSil(id);
      localStorage.removeItem('oturum:' + id);
      if (oturum?.id === id) yeniSohbet();
      await listeyiYenile();
    } catch (err) {
      alert('Silinemedi: ' + err.message);
    }
    return;
  }
  const ac = e.target.closest('[data-ac]');
  if (ac) {
    $('oturumlar').hidden = true;
    await oturumAc(ac.dataset.ac);
  }
};
$('oturumBtn').onclick = () => {
  oturumListesiCiz();
  $('oturumlar').hidden = false;
  listeyiYenile().catch(() => {});
};
$('oturumKapat').onclick = () => { $('oturumlar').hidden = true; };
$('oturumYeni').onclick = () => {
  $('oturumlar').hidden = true;
  yeniSohbet();
};

function yeniSohbet() {
  durdurYoklama();
  oturum = null;
  otomatikIzin = false;
  localStorage.removeItem('sonOturum');
  delete $('planKutu').dataset.elle;
  repoSeciciAyarla();
  sohbetiCiz();
  $('giris').focus();
}
$('yeniSohbet').onclick = yeniSohbet;

// ---------- Gece görevleri ----------
let geceListesi = [];
function geceCiz() {
  const saatler = Array.from({ length: 24 }, (_, i) => i);
  const repolar = [...$('repoSec').options].map((o) => o.value).filter(Boolean);
  $('geceListe').innerHTML = geceListesi.map((g, i) => {
    const repoSecenek = [...new Set([g.repo, ...repolar].filter(Boolean))]
      .map((r) => `<option value="${kacis(r)}" ${r === g.repo ? 'selected' : ''}>${kacis(r.split('/')[1])}</option>`).join('');
    return `
    <div class="gece-gorev" data-i="${i}">
      <div class="iki">
        <input data-alan="ad" value="${kacis(g.ad)}" placeholder="Görev adı" />
        <select data-alan="saat">${saatler.map((s) => `<option value="${s}" ${s === Number(g.saat) ? 'selected' : ''}>${String(s).padStart(2, '0')}:00</option>`).join('')}</select>
      </div>
      <select data-alan="repo"><option value="">Repo seçilmedi</option>${repoSecenek}</select>
      <textarea data-alan="istek" rows="3" placeholder="Her gece ne yapsın? (örn. açık issue'lara bak, en küçüğünü çöz, PR aç)">${kacis(g.istek)}</textarea>
      <div class="iki">
        <label class="satir"><input type="checkbox" data-alan="aktif" ${g.aktif !== false ? 'checked' : ''} /> Açık</label>
        <button data-simdi="${i}">▶ Şimdi</button>
        <button data-gsil="${i}">🗑</button>
      </div>
      <small class="not">${g.sonGun ? `Son çalışma: ${kacis(g.sonGun)}` : 'Henüz çalışmadı'}</small>
    </div>`;
  }).join('') || '<p class="not">Henüz gece görevi yok.</p>';
}
function geceFormdanOku() {
  document.querySelectorAll('.gece-gorev').forEach((el) => {
    const g = geceListesi[+el.dataset.i];
    el.querySelectorAll('[data-alan]').forEach((f) => {
      const a = f.dataset.alan;
      g[a] = a === 'aktif' ? f.checked : a === 'saat' ? Number(f.value) : f.value.trim();
    });
  });
}
$('geceBtn').onclick = async () => {
  if (!depo) return ayarlariAc();
  $('geceListe').innerHTML = '<p class="not">Yükleniyor…</p>';
  $('gece').hidden = false;
  try {
    geceListesi = await depo.geceGorevleri();
    geceCiz();
  } catch (e) {
    $('geceListe').innerHTML = `<p class="not">Hata: ${kacis(e.message)}</p>`;
  }
};
$('geceEkle').onclick = () => {
  geceFormdanOku();
  geceListesi.push({ id: yeniId(), ad: '', repo: $('repoSec').value, istek: '', saat: 3, aktif: true });
  geceCiz();
};
$('geceListe').onclick = async (e) => {
  const sil = e.target.closest('[data-gsil]');
  const simdi = e.target.closest('[data-simdi]');
  if (!sil && !simdi) return;
  geceFormdanOku();
  if (sil) {
    geceListesi.splice(+sil.dataset.gsil, 1);
    geceCiz();
    return;
  }
  const g = geceListesi[+simdi.dataset.simdi];
  if (!g.istek) return alert('Önce ne yapacağını yaz.');
  $('gece').hidden = true;
  durdurYoklama();
  oturum = yeniOturum({ baslik: `🌙 ${g.ad || 'Gece görevi'} · elle`, repo: g.repo });
  oturum.gece = true;
  try {
    await gorevBaslat({ gh, depo, asistanRepo: ayar.asistanRepo, oturum, istek: g.istek });
    yaz('sonOturum', oturum.id);
    repoSeciciAyarla();
    sohbetiCiz();
    baslatYoklama();
    listeyiYenile().catch(() => {});
  } catch (err) {
    alert('Başlatılamadı: ' + err.message);
  }
};
$('geceKaydet').onclick = async () => {
  geceFormdanOku();
  const { gun, saat } = trSimdi();
  try {
    const eski = new Map((await depo.geceGorevleri()).map((g) => [g.id, g]));
    for (const g of geceListesi) {
      // Yeni ya da saati değişen görevin saati bugün zaten geçtiyse hemen değil yarın çalışsın
      if (eski.get(g.id)?.saat !== g.saat && g.saat <= saat) g.sonGun = gun;
    }
    await depo.geceGorevleriYaz(geceListesi);
    $('gece').hidden = true;
  } catch (e) {
    alert('Kaydedilemedi: ' + e.message);
  }
};
$('geceKapat').onclick = () => { $('gece').hidden = true; };

// ---------- Ayarlar ----------
const modelGoster = (m) => (!m || m === OTOMATIK ? '' : m);
function ayarlariAc() {
  $('ghToken').value = ayar.ghToken;
  $('geminiKey').value = ayar.geminiKey;
  $('hafizaRepo').value = ayar.hafizaRepo;
  $('asistanRepo').value = ayar.asistanRepo;
  $('model').value = modelGoster(ayar.model?.evren);
  $('planModel').value = modelGoster(ayar.roller.planlayici?.model);
  $('gozModel').value = modelGoster(ayar.roller.gozden?.model);
  for (const k of ['planla', 'gozdenGecir', 'onayIste', 'ozDeg']) $(k).checked = ayar[k];
  $('maksAdim').value = ayar.maksAdim;
  baglayiciCiz();
  $('ayarlar').hidden = false;
}

function formdanOku() {
  ayar.ghToken = $('ghToken').value.trim();
  ayar.hafizaRepo = $('hafizaRepo').value.trim();
  ayar.asistanRepo = $('asistanRepo').value.trim();
  const m = (id) => $(id).value.trim() || OTOMATIK;
  ayar.model = { ...ayar.model, evren: m('model') };
  ayar.roller = {
    planlayici: { saglayici: 'evren', model: m('planModel') },
    gozden: { saglayici: 'evren', model: m('gozModel') },
  };
  for (const k of ['planla', 'gozdenGecir', 'onayIste', 'ozDeg']) ayar[k] = $(k).checked;
  ayar.maksAdim = Number($('maksAdim').value) || 40;
  ayar.baglayicilar = ayar.baglayicilar.map((b, i) => ({ ...b, acik: $(`bag${i}`)?.checked ?? b.acik }));
  yaz('ayar', ayar);
}

// ---------- Bağlayıcılar (MCP) ----------
function baglayiciCiz() {
  $('bagListe').innerHTML = ayar.baglayicilar.map((b, i) =>
    `<div class="bag"><label class="satir"><input id="bag${i}" type="checkbox"${b.acik !== false ? ' checked' : ''} /> <b>${kacis(b.ad)}</b></label>` +
    `<small>${kacis(b.aciklama || b.url)}</small>` +
    (VARSAYILAN_BAGLAYICILAR.some((v) => v.ad === b.ad) ? '' : ` <button data-sil="${i}" class="kucuk">sil</button>`) + '</div>').join('');
  for (const btn of $('bagListe').querySelectorAll('[data-sil]')) {
    btn.onclick = () => { ayar.baglayicilar = ayar.baglayicilar.filter((_, i) => i !== Number(btn.dataset.sil)); baglayiciCiz(); };
  }
}
$('bagEkle').onclick = () => {
  const ad = $('bagAd').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const url = $('bagUrl').value.trim();
  if (!ad || !/^https:\/\//.test(url)) return alert('Kısa bir ad ve https:// ile başlayan MCP adresi gir.');
  if (ayar.baglayicilar.some((b) => b.ad === ad)) return alert('Bu adda bağlayıcı zaten var.');
  ayar.baglayicilar = [...ayar.baglayicilar, { ad, url, acik: true, aciklama: url }];
  $('bagAd').value = '';
  $('bagUrl').value = '';
  baglayiciCiz();
};

$('ayarBtn').onclick = ayarlariAc;
$('ayarKapat').onclick = () => { $('ayarlar').hidden = true; };
$('ayarKaydet').onclick = async () => {
  formdanOku();
  izinCiz();
  $('ayarlar').hidden = true;
  try {
    if (!depo || tokenFarkli()) await basla();
    if (depo) {
      // Bulut görevi aynı ayarlarla çalışsın; çalıştırıcının yazdığı alanlar (dinlen) korunur
      const bulut = Object.fromEntries(BULUT_ALANLARI.map((k) => [k, ayar[k]]));
      await depo.jsonGuncelle('ayarlar.json', (a) => ({ ...(a || {}), ...bulut }), 'ayarlar', {});
    }
  } catch (e) {
    durumGoster('⚠ ' + e.message);
  }
};
const tokenFarkli = () => gh?.token !== ayar.ghToken;

$('modelGetir').onclick = async (e) => {
  const b = e.target;
  if (!depo) return;
  b.textContent = 'Getiriliyor…';
  const v = await depo.jsonOku('evren_modeller.json').catch(() => null);
  if (!v?.modeller?.length) {
    b.textContent = 'Liste henüz yok: ilk görev çalışınca bulut listeyi çeker';
    return;
  }
  $('modelListe').innerHTML = [OTOMATIK, ...v.modeller].map((x) => `<option value="${kacis(x)}">`).join('');
  b.textContent = `${v.modeller.length} model bulundu — model kutusuna dokun`;
};

$('bulutKontrol').onclick = async () => {
  const kutu = $('bulutDurum');
  formdanOku();
  kutu.innerHTML = '<span class="not">Kontrol ediliyor…</span>';
  const satir = (ok, metin) => `<div>${ok ? '✅' : '❌'} ${md(metin)}</div>`;
  const sonuc = [];
  try {
    if (!depo || tokenFarkli()) await basla(true);
    if (!depo) throw new Error('Önce GitHub token gir.');
    sonuc.push(satir(true, 'GitHub token çalışıyor'));
    sonuc.push(satir(true, `Gizli hafıza reposu: ${ayar.hafizaRepo}`));
    const r = await gh.repoBilgi(ayar.asistanRepo);
    if (!r) {
      sonuc.push(satir(false, `${ayar.asistanRepo} bulunamadı`));
    } else {
      const [sahip, ad] = ayar.asistanRepo.split('/');
      sonuc.push(satir(!r.private, r.private
        ? `${ayar.asistanRepo} gizli: web sürümü için herkese açık olmalı. Ayarlar → en altta Change visibility: https://github.com/${ayar.asistanRepo}/settings`
        : `Web sürümü: https://${sahip}.github.io/${ad}/`));
      let adlar = null;
      try { adlar = await gh.secretAdlari(ayar.asistanRepo); } catch { /* token'ın Secrets okuma izni olmayabilir */ }
      const ekle = `https://github.com/${ayar.asistanRepo}/settings/secrets/actions/new`;
      for (const [s, ne] of [['EVREN_ANAHTAR', 'EVREN API anahtarın'], ['ASISTAN_GH_TOKEN', 'bu GitHub token\'ın aynısı']]) {
        if (adlar === null) sonuc.push(`<div>❔ ${md(`Secret \`${s}\` okunamadı (değeri: ${ne}). Yoksa ekle: ${ekle}`)}</div>`);
        else sonuc.push(satir(adlar.includes(s), adlar.includes(s) ? `Secret ${s} tanımlı` : `Secret \`${s}\` eksik (değeri: ${ne}). Ekle: ${ekle}`));
      }
      // İsteğe bağlı anahtarlar: yoksa ücretsiz anahtarsız sınırlar kullanılır
      const istege = ['JINA_ANAHTAR', 'CONTEXT7_ANAHTAR', 'MCP_ANAHTARLARI'].filter((x) => adlar?.includes(x));
      sonuc.push(`<div>ℹ️ ${md(`İnternet araması ve bağlayıcılar anahtarsız çalışır${istege.length ? ` (tanımlı ek anahtarlar: ${istege.join(', ')})` : ''}.`)}</div>`);
    }
  } catch (e) {
    sonuc.push(satir(false, e.message));
  }
  kutu.innerHTML = sonuc.join('');
};

// ---------- Dersler paneli ----------
$('dersBtn').onclick = async () => {
  if (!depo) return ayarlariAc();
  $('dersMetin').value = 'Yükleniyor…';
  $('dersler').hidden = false;
  try {
    $('dersMetin').value = (await new Hafiza(gh, ayar.hafizaRepo).dersler()) || '# Asistanın dersleri\n';
  } catch (e) {
    $('dersMetin').value = 'Hata: ' + e.message;
  }
};
$('dersKapat').onclick = () => { $('dersler').hidden = true; };
$('dersKaydet').onclick = async () => {
  try {
    await new Hafiza(gh, ayar.hafizaRepo).yenidenYaz($('dersMetin').value.trimEnd() + '\n');
    $('dersler').hidden = true;
  } catch (e) {
    $('dersMetin').value += '\n\nKaydedilemedi: ' + e.message;
  }
};

// ---------- Giriş kutusu ----------
function boyutla() {
  const t = $('giris');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 140) + 'px';
}
$('giris').oninput = boyutla;
$('gonder').onclick = gonder;

// ---------- Eski sürümden taşıma ----------
/** Bulut öncesi sürümde tek sohbet telefonda duruyordu; onu bir oturum olarak buluta taşı. */
async function eskiSohbetiTasi() {
  const eski = oku('sohbet', []);
  if (!eski.length) return;
  const o = yeniOturum({ baslik: 'Eski sohbet (telefondan taşındı)', repo: ayar.aktifRepo });
  o.mesajlar = eski.map((m) => ({ ...m, zaman: Date.now() }));
  o.durum = 'bitti';
  await depo.oturumYaz(o);
  localStorage.removeItem('sohbet');
}

// ---------- Başlat ----------
async function basla(sessiz = false) {
  try {
    if (!(await baglan())) {
      sohbetiCiz();
      return;
    }
    await eskiSohbetiTasi().catch(() => {});
    await listeyiYenile();
    repolariYukle();
    const son = oku('sonOturum', '');
    if (son && liste.some((x) => x.id === son)) await oturumAc(son);
    else sohbetiCiz();
  } catch (e) {
    if (sessiz) throw e;
    sohbetiCiz();
    durumGoster('⚠ ' + e.message);
  }
}

// Önce önbellekten anında göster, sonra buluttan tazele
{
  const son = oku('sonOturum', '');
  oturum = son ? oku('oturum:' + son, null) : null;
  sohbetiCiz();
}
basla();
