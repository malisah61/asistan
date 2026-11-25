// Oturumlar, gece görevleri ve bulut ayarları gizli hafıza reposunda (varsayılan <kullanıcı>/asistan-hafiza) durur.
// Hem uygulama/web hem de bulut çalıştırıcısı (bulut/calistir.mjs) bu modülü kullanır.
//
// oturumlar/index.json        [{ id, baslik, repo, durum, guncelleme }]
// oturumlar/<id>.json         { id, baslik, repo, durum, durumMetni, mesajlar, plan, soru, kosu, ... }
// oturumlar/<id>.cevap.json   { soruId, cevap }  — uygulamanın soruya cevabı
// oturumlar/<id>.dur          varsa bulut görevi durur
// gece/gorevler.json          [{ id, ad, repo, istek, saat, aktif, sonGun }]
// ayarlar.json                model, roller ve davranış ayarları (anahtar yok)

export const HAFIZA_REPO_ADI = 'asistan-hafiza';
export const GOREV_WORKFLOW = 'gorev.yml';
export const KUYRUK_DOSYASI = 'kuyruk/istek.json';
export const CALISAN_DURUMLAR = new Set(['kuyrukta', 'calisiyor']);
const MAKS_MESAJ = 300;
// GitHub aynı dosyaya eşzamanlı yazımda 409 verir; tazeleyip tekrar denenir
const YAZMA_DENEME = 4;

export const yeniId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Türkiye yaz saati uygulamıyor: her zaman UTC+3
export function trSimdi(t = Date.now()) {
  const d = new Date(t + 3 * 3600_000);
  return { gun: d.toISOString().slice(0, 10), saat: d.getUTCHours(), dakika: d.getUTCMinutes() };
}

export class Depo {
  constructor(gh, repo) {
    this.gh = gh;
    this.repo = repo;
  }

  async jsonOku(yol, varsayilan = null) {
    try {
      return JSON.parse((await this.gh.dosyaOku(this.repo, yol)).icerik);
    } catch (e) {
      if (e.status === 404 || e instanceof SyntaxError) return varsayilan;
      throw e;
    }
  }

  async jsonYaz(yol, veri, mesaj) {
    for (let i = 0; ; i++) {
      try {
        return await this.gh.dosyaYaz(this.repo, yol, JSON.stringify(veri, null, 1) + '\n', mesaj);
      } catch (e) {
        if (!(e.status === 409 || e.status === 422) || i >= YAZMA_DENEME) throw e;
        await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));
      }
    }
  }

  /** Oku → değiştir → yaz; çakışmada (başka biri araya yazdıysa) baştan dener. */
  async jsonGuncelle(yol, fn, mesaj, varsayilan = null) {
    for (let i = 0; ; i++) {
      const once = await this.jsonOku(yol, varsayilan);
      const sonra = fn(once);
      try {
        await this.gh.dosyaYaz(this.repo, yol, JSON.stringify(sonra, null, 1) + '\n', mesaj);
        return sonra;
      } catch (e) {
        if (!(e.status === 409 || e.status === 422) || i >= YAZMA_DENEME) throw e;
        await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));
      }
    }
  }

  async varMi(yol) {
    return Boolean(await this.gh.sha(this.repo, yol));
  }

  async sil(yol, mesaj) {
    try {
      await this.gh.dosyaSil(this.repo, yol, mesaj);
    } catch { /* zaten yoksa sorun değil */ }
  }

  // ---------- Oturumlar ----------

  liste() {
    return this.jsonOku('oturumlar/index.json', []);
  }

  oturum(id) {
    return this.jsonOku(`oturumlar/${id}.json`);
  }

  async oturumYaz(o) {
    o.guncelleme = Date.now();
    if (o.mesajlar.length > MAKS_MESAJ) o.mesajlar = o.mesajlar.slice(-MAKS_MESAJ);
    await this.jsonYaz(`oturumlar/${o.id}.json`, o, `oturum: ${o.baslik.slice(0, 50)}`);
    await this.listeyeYaz(o);
  }

  async listeyeYaz(o) {
    const ozet = { id: o.id, baslik: o.baslik, repo: o.repo || '', durum: o.durum, guncelleme: o.guncelleme };
    const once = (await this.liste()).find((x) => x.id === o.id);
    // Liste her yazımda değişmesin: yalnızca görünen bilgi değiştiyse
    if (once && once.baslik === ozet.baslik && once.durum === ozet.durum && once.repo === ozet.repo) return;
    await this.jsonGuncelle('oturumlar/index.json',
      (l) => [ozet, ...(l || []).filter((x) => x.id !== o.id)].sort((a, b) => b.guncelleme - a.guncelleme),
      'oturum listesi', []);
  }

  async oturumSil(id) {
    await this.jsonGuncelle('oturumlar/index.json', (l) => (l || []).filter((x) => x.id !== id), 'oturum silindi', []);
    for (const ek of ['.json', '.cevap.json', '.dur']) await this.sil(`oturumlar/${id}${ek}`, 'oturum silindi');
  }

  durIste(id) {
    return this.gh.dosyaYaz(this.repo, `oturumlar/${id}.dur`, String(Date.now()), 'durdur');
  }

  durVarMi(id) {
    return this.varMi(`oturumlar/${id}.dur`);
  }

  cevapla(id, soruId, cevap) {
    return this.jsonYaz(`oturumlar/${id}.cevap.json`, { soruId, cevap }, 'soruya cevap');
  }

  cevap(id) {
    return this.jsonOku(`oturumlar/${id}.cevap.json`);
  }

  // ---------- Gece görevleri ve ayarlar ----------

  geceGorevleri() {
    return this.jsonOku('gece/gorevler.json', []);
  }

  geceGorevleriYaz(liste) {
    return this.jsonYaz('gece/gorevler.json', liste, 'gece görevleri');
  }

  ayarlar() {
    return this.jsonOku('ayarlar.json', {});
  }

  ayarlarYaz(a) {
    return this.jsonYaz('ayarlar.json', a, 'ayarlar');
  }
}

/** Oturuma yeni kullanıcı mesajı ekler, kaydeder ve bulut görevini başlatır. */
export async function gorevBaslat({ gh, depo, asistanRepo, oturum, istek }) {
  oturum.mesajlar.push({ rol: 'kullanici', metin: istek, zaman: Date.now() });
  oturum.durum = 'kuyrukta';
  oturum.durumMetni = 'Bulutta sıraya alındı…';
  oturum.soru = null;
  await depo.sil(`oturumlar/${oturum.id}.dur`, 'eski durdurma işareti');
  await depo.oturumYaz(oturum);
  try {
    await gh.calismaBaslat(asistanRepo, GOREV_WORKFLOW, null, { oturum: oturum.id });
  } catch {
    // Tarayıcıdan workflow başlatma isteği CORS'a takılabiliyor (web sürümü).
    // Dosya yazmak her yerde çalışıyor: asistan reposuna kuyruk dosyası yazılınca gorev.yml push ile başlar.
    // Dosyada yalnızca oturum kimliği var; repo açık olsa da içerik görünmez.
    await new Depo(gh, asistanRepo).jsonYaz(KUYRUK_DOSYASI, { oturum: oturum.id, zaman: Date.now() }, 'kuyruk: yeni görev');
  }
}

export function yeniOturum({ baslik, repo }) {
  return {
    id: yeniId(),
    baslik: String(baslik || 'Yeni sohbet').replace(/\s+/g, ' ').trim().slice(0, 60),
    repo: repo || '',
    olusturma: Date.now(),
    guncelleme: Date.now(),
    durum: 'bos',
    durumMetni: '',
    mesajlar: [],
    plan: [],
    soru: null,
  };
}
