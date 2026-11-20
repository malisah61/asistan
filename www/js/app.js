import { PROVIDERS, OTOMATIK, modelleriGetir } from './llm.js';
import { GitHub } from './github.js';
import { Hafiza, gorevCalistir, ozDegerlendir } from './agent.js';

const $ = (id) => document.getElementById(id);

// ---------- Depolama ----------
const oku = (k, v) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? v; } catch { return v; }
};
const yaz = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* dolu olabilir */ }
};

const VARSAYILAN = {
  ghToken: '',
  hafizaRepo: '',
  anahtar: {},
  model: {},
  sira: ['gemini', 'openrouter', 'groq'],
  onayIste: true,
  ozDeg: true,
  planla: true,
  gozdenGecir: true,
  maksAdim: 40,
  aktifRepo: '',
  roller: {
    planlayici: { saglayici: 'gemini', model: OTOMATIK },
    gozden: { saglayici: 'groq', model: OTOMATIK },
  },
};
let ayar = { ...VARSAYILAN, ...oku('ayar', {}) };
ayar.roller = { ...VARSAYILAN.roller, ...(ayar.roller || {}) };
let kayit = oku('sohbet', []); // [{rol, metin, ...}]
let calisiyor = false;
let durdur = false;

// ---------- Basit markdown ----------
function kacis(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function md(s) {
  const parcalar = String(s).split(/```/);
  return parcalar.map((p, i) => {
    if (i % 2) return `<pre>${kacis(p.replace(/^\w*\n/, ''))}</pre>`;
    return kacis(p)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/(https?:\/\/[^\s)<]+)/g, '<a href="$1">$1</a>');
  }).join('');
}

// ---------- Sohbet görünümü ----------
function ekle(m, kaydet = true) {
  const kutu = $('sohbet');
  if (m.rol === 'arac') {
    const d = document.createElement('details');
    d.className = 'arac';
    d.innerHTML = `<summary>🔧 ${kacis(m.ad)}</summary><pre>${kacis(m.arg)}\n\n→ ${kacis(m.sonuc)}</pre>`;
    kutu.appendChild(d);
  } else if (m.rol === 'ders') {
    const d = document.createElement('div');
    d.className = 'ders-notu';
    d.textContent = '📚 Yeni ders: ' + m.metin;
    kutu.appendChild(d);
  } else {
    const d = document.createElement('div');
    d.className = 'mesaj ' + m.rol;
    d.innerHTML = md(m.metin) + (m.alt ? `<div class="alt">${kacis(m.alt)}</div>` : '');
    kutu.appendChild(d);
  }
  kutu.scrollTop = kutu.scrollHeight;
  if (kaydet) {
    kayit.push(m);
    if (kayit.length > 300) kayit = kayit.slice(-300);
    yaz('sohbet', kayit);
  }
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

function durum(t) {
  const d = $('durum');
  d.hidden = !t;
  d.textContent = t || '';
}

// Modele giden geçmiş: yalnızca kullanıcı ve asistan metinleri
function gecmis() {
  return kayit
    .filter((m) => m.rol === 'kullanici' || m.rol === 'asistan')
    .map((m) => ({ role: m.rol === 'kullanici' ? 'user' : 'assistant', content: m.metin }));
}

// ---------- Onay penceresi ----------
function onayla(ad, ozet) {
  return new Promise((coz) => {
    $('onayBaslik').textContent = `İzin: ${ad}`;
    $('onayMetin').textContent = ozet;
    $('onay').hidden = false;
    const bitir = (v) => {
      $('onay').hidden = true;
      $('onayEvet').onclick = $('onayHayir').onclick = null;
      coz(v);
    };
    $('onayEvet').onclick = () => bitir(true);
    $('onayHayir').onclick = () => bitir(false);
  });
}

// ---------- Görev ----------
async function gonder() {
  if (calisiyor) {
    durdur = true;
    durum('Durduruluyor…');
    return;
  }
  const istek = $('giris').value.trim();
  if (!istek) return;
  if (!ayar.ghToken || !Object.values(ayar.anahtar).some(Boolean)) {
    ayarlariAc();
    return;
  }
  const onceki = gecmis();
  $('giris').value = '';
  boyutla();
  ekle({ rol: 'kullanici', metin: istek });

  calisiyor = true;
  durdur = false;
  $('gonder').textContent = '■';
  planGoster([]);
  delete $('planKutu').dataset.elle;
  const gh = new GitHub(ayar.ghToken);
  try {
    const hafiza = new Hafiza(gh, await hafizaReposu(gh));
    const sonuc = await gorevCalistir({
      ayar, gh, hafiza,
      aktifRepo: ayar.aktifRepo,
      gecmis: onceki,
      istek,
      ui: {
        durum,
        onayla,
        plan: planGoster,
        durdurulduMu: () => durdur,
        arac: (ad, arg, s) => ekle({ rol: 'arac', ad, arg: JSON.stringify(arg, null, 1).slice(0, 3000), sonuc: String(s).slice(0, 3000) }),
      },
    });
    ekle({ rol: 'asistan', metin: sonuc.cevap, alt: sonuc.saglayici ? `${sonuc.saglayici} · ${sonuc.model}` : '' });

    if (ayar.ozDeg && !durdur) {
      durum('Bu işten ders çıkarıyor…');
      const ders = await ozDegerlendir({ ayar, hafiza, aktifRepo: ayar.aktifRepo, istek, cevap: sonuc.cevap, gorev: sonuc.gorev });
      if (ders) ekle({ rol: 'ders', metin: ders });
    }
  } catch (e) {
    ekle({ rol: 'hata', metin: '⚠ ' + e.message });
  } finally {
    // Kalkmış bir modelin yerine yenisi seçildiyse kalıcı olsun
    if (ayar.degisti) {
      delete ayar.degisti;
      yaz('ayar', ayar);
    }
    calisiyor = false;
    durum('');
    $('gonder').textContent = '➤';
  }
}

async function hafizaReposu(gh) {
  if (ayar.hafizaRepo) return ayar.hafizaRepo;
  const k = await gh.kullanici();
  ayar.hafizaRepo = `${k.login}/asistan`;
  yaz('ayar', ayar);
  return ayar.hafizaRepo;
}

// ---------- Repo seçici ----------
async function repolariYukle() {
  const sec = $('repoSec');
  if (!ayar.ghToken) return;
  try {
    const liste = await new GitHub(ayar.ghToken).repolar();
    sec.innerHTML = '<option value="">Repo seçilmedi</option>' +
      liste.map((r) => `<option value="${kacis(r.ad)}">${kacis(r.ad.split('/')[1])}${r.ozel ? ' 🔒' : ''}</option>`).join('');
    sec.value = ayar.aktifRepo || '';
  } catch (e) {
    ekle({ rol: 'hata', metin: '⚠ Repolar alınamadı: ' + e.message }, false);
  }
}
$('repoSec').onchange = (e) => {
  ayar.aktifRepo = e.target.value;
  yaz('ayar', ayar);
};

// ---------- Ayarlar ----------
function saglayicilariCiz() {
  const kutu = $('saglayicilar');
  kutu.innerHTML = '';
  ayar.sira.forEach((id, i) => {
    const p = PROVIDERS[id];
    const d = document.createElement('div');
    d.className = 'saglayici';
    d.innerHTML = `
      <div class="ust"><b>${i + 1}. ${p.ad}</b>
        <button data-yukari="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button data-asagi="${i}" ${i === ayar.sira.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <label>API anahtarı <a href="${p.anahtarSayfasi}">(anahtar al)</a>
        <input type="password" data-anahtar="${id}" value="${kacis(ayar.anahtar[id] || '')}" autocomplete="off" />
      </label>
      <label>Model
        <input data-model="${id}" list="liste-${id}" value="${kacis(ayar.model[id] || OTOMATIK)}" />
        <datalist id="liste-${id}"></datalist>
      </label>
      <button data-getir="${id}">Modelleri getir</button>`;
    kutu.appendChild(d);
  });
}

function formdanOku() {
  ayar.ghToken = $('ghToken').value.trim();
  ayar.hafizaRepo = $('hafizaRepo').value.trim();
  ayar.onayIste = $('onayIste').checked;
  ayar.ozDeg = $('ozDeg').checked;
  ayar.planla = $('planla').checked;
  ayar.gozdenGecir = $('gozdenGecir').checked;
  ayar.maksAdim = Number($('maksAdim').value) || 40;
  ayar.roller = {
    planlayici: { saglayici: $('planSag').value, model: $('planModel').value.trim() },
    gozden: { saglayici: $('gozSag').value, model: $('gozModel').value.trim() },
  };
  document.querySelectorAll('[data-anahtar]').forEach((el) => { ayar.anahtar[el.dataset.anahtar] = el.value.trim(); });
  document.querySelectorAll('[data-model]').forEach((el) => { ayar.model[el.dataset.model] = el.value.trim(); });
}

$('saglayicilar').onclick = async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  formdanOku();
  if (b.dataset.yukari) {
    const i = +b.dataset.yukari;
    [ayar.sira[i - 1], ayar.sira[i]] = [ayar.sira[i], ayar.sira[i - 1]];
    saglayicilariCiz();
  } else if (b.dataset.asagi) {
    const i = +b.dataset.asagi;
    [ayar.sira[i + 1], ayar.sira[i]] = [ayar.sira[i], ayar.sira[i + 1]];
    saglayicilariCiz();
  } else if (b.dataset.getir) {
    const id = b.dataset.getir;
    b.textContent = 'Getiriliyor…';
    try {
      const ids = await modelleriGetir(id, ayar.anahtar[id]);
      $('liste-' + id).innerHTML = [OTOMATIK, ...ids].map((m) => `<option value="${kacis(m)}">`).join('');
      b.textContent = `${ids.length} model bulundu — model kutusuna dokun`;
    } catch (err) {
      b.textContent = 'Hata: ' + err.message;
    }
  }
};

function ayarlariAc() {
  $('ghToken').value = ayar.ghToken;
  $('hafizaRepo').value = ayar.hafizaRepo;
  $('onayIste').checked = ayar.onayIste;
  $('ozDeg').checked = ayar.ozDeg;
  $('planla').checked = ayar.planla;
  $('gozdenGecir').checked = ayar.gozdenGecir;
  $('maksAdim').value = ayar.maksAdim;
  const secenekler = Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}">${p.ad}</option>`).join('');
  for (const [rol, sec, inp] of [['planlayici', 'planSag', 'planModel'], ['gozden', 'gozSag', 'gozModel']]) {
    $(sec).innerHTML = secenekler;
    $(sec).value = ayar.roller[rol]?.saglayici || 'gemini';
    $(inp).value = ayar.roller[rol]?.model || OTOMATIK;
  }
  saglayicilariCiz();
  $('ayarlar').hidden = false;
}
$('ayarBtn').onclick = ayarlariAc;
$('ayarKapat').onclick = () => { $('ayarlar').hidden = true; };
$('ayarKaydet').onclick = () => {
  formdanOku();
  yaz('ayar', ayar);
  $('ayarlar').hidden = true;
  repolariYukle();
};

// ---------- Dersler paneli ----------
$('dersBtn').onclick = async () => {
  if (!ayar.ghToken) return ayarlariAc();
  const gh = new GitHub(ayar.ghToken);
  $('dersMetin').value = 'Yükleniyor…';
  $('dersler').hidden = false;
  try {
    const h = new Hafiza(gh, await hafizaReposu(gh));
    $('dersMetin').value = (await h.dersler()) || '# Asistanın dersleri\n';
  } catch (e) {
    $('dersMetin').value = 'Hata: ' + e.message;
  }
};
$('dersKapat').onclick = () => { $('dersler').hidden = true; };
$('dersKaydet').onclick = async () => {
  const gh = new GitHub(ayar.ghToken);
  try {
    const h = new Hafiza(gh, await hafizaReposu(gh));
    await h.yenidenYaz($('dersMetin').value.trimEnd() + '\n');
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
$('yeniSohbet').onclick = () => {
  if (calisiyor) return;
  kayit = [];
  yaz('sohbet', kayit);
  $('sohbet').innerHTML = '';
  hosgeldin();
};

function hosgeldin() {
  if (kayit.length) return;
  ekle({
    rol: 'asistan',
    metin: ayar.ghToken
      ? 'Merhaba! Üstten bir repo seç ve ne yapmak istediğini yaz.'
      : 'Merhaba! Başlamak için ⚙ Ayarlar\'dan GitHub token ve en az bir model anahtarı gir.',
  }, false);
}

// ---------- Başlat ----------
kayit.forEach((m) => ekle(m, false));
hosgeldin();
repolariYukle();
