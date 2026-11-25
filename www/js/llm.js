// Model sağlayıcıları — hepsi OpenAI uyumlu /chat/completions kullanır.
// Şu an yalnızca EVREN var; yeni sağlayıcı buraya eklenirse limit/hata durumunda sıradakine geçilir.

export const PROVIDERS = {
  evren: {
    ad: 'EVREN',
    url: 'https://evren-llmapi.ssyz.org.tr/v1',
    // Liste alınamazsa (ör. şartlar henüz onaylanmadı) bu modelle doğrudan denenir
    anaModel: 'deepseek-v4.1-flash',
    // Ana model hata verirse diğer sağlayıcılara geçmeden önce bu denenir
    yedekModel: 'glm-5.3',
    not: "SSB'nin yapay zeka platformu. Ücretsiz dönem 1 Aralık 2026'da bitiyor.",
    // deepseek/glm her adımda önce uzun akıl yürütüyor. Basit adımlarda kapatılır; sunucu tanımazsa kendiliğinden bırakılır.
    dusunmeKapali: { chat_template_kwargs: { enable_thinking: false, thinking: false } },
  },
};

// Model boş ya da "otomatik" ise sağlayıcının güncel listesinden en uygunu seçilir.
// Sabit model adı yazmıyoruz: ücretsiz modeller sık sık kalkıyor ya da adı değişiyor.
export const OTOMATIK = 'otomatik';

// Limit dolan sağlayıcıyı bir süre dinlendir
const bekleme = {}; // id ya da id:model -> zaman damgası (ms)
const listeOnbellek = {}; // id -> { zaman, modeller }

// Ücret/bakiye hatası kısa sürede düzelmez; sağlayıcıyı uzun süre atla (ayar.dinlen'de kalıcı tutulur)
const UCRETLI_BEKLEME = 6 * 60 * 60_000;
const KOTA_BEKLEME = 60_000;
// Yanıt akış (stream) olarak alınır: model yazmaya devam ettiği sürece beklenir, yalnızca susarsa kesilir.
// Uzun dosya yazımı tek seferde 3 dakikayı aşabiliyor; toplam süre sınırı bu yüzden geniş.
const ILK_YANIT_SURESI = 180_000; // büyük bağlamda ilk kelime gelene kadar
const SESSIZLIK_SURESI = 90_000; // iki parça arasında
const TOPLAM_SURE = 15 * 60_000;
const BOS_AKIS_SURESI = 6 * 60_000; // bağlantı açık ama tek kelime yok
const ILERLEME_ARALIGI = 3000;

// Düşünmeyi açık bırakan roller: plan çıkarma ve takılınca danışma
const DUSUNEN_ROLLER = new Set(['planlayici']);
// Sunucu düşünme kapatma parametresini reddettiyse bu oturumda bir daha gönderilmez
const dusunmeDesteksiz = new Set();
const parametreHatasiMi = (status, metin) => status === 400 &&
  /chat_template_kwargs|enable_thinking|extra (fields|inputs|parameters)|unrecognized|unexpected (keyword|field|argument)|not permitted|unknown (field|parameter)/i.test(metin);

/** Model çağrılarının süresi (ajan bunu görev sonunda özetler). */
export const olcum = { istek: 0, sure: 0, sonSure: 0, sifirla() { this.istek = 0; this.sure = 0; this.sonSure = 0; } };

const sayi = (n) => (n < 1000 ? String(n) : (n / 1000).toFixed(1) + ' bin');

function zamanAsimi(mesaj) {
  const e = new Error(mesaj);
  e.name = 'TimeoutError';
  return e;
}

/**
 * /chat/completions isteğini akışla yapar. Hata durumunda { ok: false, status, metin },
 * başarıda { ok: true, message } döner. Sunucu akışı desteklemezse düz JSON da okunur.
 */
async function akisliIstek(url, hdr, govde, ilerleme) {
  const ac = new AbortController();
  let neden = null;
  let zamanlayici = null;
  let okuyucu = null;
  const kes = (m) => {
    neden = zamanAsimi(m);
    ac.abort();
    // Bazı ortamlarda abort açık akışı kapatmıyor; okuyucuyu da iptal et ki read() beklemede kalmasın
    okuyucu?.cancel().catch(() => {});
  };
  const kur = (ms, m) => {
    clearTimeout(zamanlayici);
    zamanlayici = setTimeout(() => kes(m), ms);
  };
  const toplam = setTimeout(() => kes(`${TOPLAM_SURE / 60_000} dk içinde bitmedi`), TOPLAM_SURE);
  kur(ILK_YANIT_SURESI, `${ILK_YANIT_SURESI / 1000} sn içinde yanıt vermeye başlamadı`);
  try {
    const r = await fetch(url, { method: 'POST', headers: hdr, body: JSON.stringify({ ...govde, stream: true }), signal: ac.signal });
    const tur = r.headers.get('content-type') || '';
    if (!r.ok || !r.body || !tur.includes('event-stream')) {
      const metin = await r.text();
      if (!r.ok) return { ok: false, status: r.status, metin };
      return { ok: true, message: JSON.parse(metin).choices?.[0]?.message };
    }
    okuyucu = r.body.getReader();
    const coz = new TextDecoder();
    const msg = { role: 'assistant', content: '', tool_calls: [] };
    let tampon = '';
    let yazi = 0;
    let dusunce = 0;
    let sonIlerleme = 0;
    const bas = Date.now();
    for (;;) {
      kur(SESSIZLIK_SURESI, `${SESSIZLIK_SURESI / 1000} sn boyunca sustu`);
      const { done, value } = await okuyucu.read();
      if (neden) throw neden;
      if (done) break;
      // Sunucu yalnızca bağlantıyı canlı tutup hiç yazmıyorsa sessizlik süresi hiç dolmaz; ayrıca sınırla
      if (!yazi && !dusunce && Date.now() - bas > BOS_AKIS_SURESI) throw zamanAsimi(`${BOS_AKIS_SURESI / 60_000} dk boyunca bağlantı açık ama hiç yazmadı`);
      tampon += coz.decode(value, { stream: true });
      const satirlar = tampon.split('\n');
      tampon = satirlar.pop();
      for (const satir of satirlar) {
        const v = satir.trim();
        if (!v.startsWith('data:')) continue;
        const veri = v.slice(5).trim();
        if (!veri || veri === '[DONE]') continue;
        let j;
        try { j = JSON.parse(veri); } catch { continue; }
        if (j.error) return { ok: false, status: 500, metin: JSON.stringify(j.error) };
        const d = j.choices?.[0]?.delta || j.choices?.[0]?.message;
        if (!d) continue;
        if (d.content) msg.content += d.content;
        // Düşünen modeller cevaptan önce akıl yürütür; alan adı sunucuya göre değişiyor
        for (const k of ['reasoning_content', 'reasoning', 'thinking']) {
          if (typeof d[k] === 'string') dusunce += d[k].length;
        }
        for (const tc of d.tool_calls || []) {
          const t = (msg.tool_calls[tc.index ?? 0] ||= { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) t.id = tc.id;
          if (tc.function?.name) t.function.name += tc.function.name;
          if (tc.function?.arguments) t.function.arguments += tc.function.arguments;
        }
        yazi += (d.content?.length || 0) +
          (d.tool_calls || []).reduce((n, tc) => n + (tc.function?.arguments?.length || 0), 0);
      }
      if (Date.now() - sonIlerleme > ILERLEME_ARALIGI) {
        sonIlerleme = Date.now();
        ilerleme({ yazi, dusunce, sure: Math.round((Date.now() - bas) / 1000) });
      }
    }
    msg.tool_calls = msg.tool_calls.filter((t) => t && t.function.name);
    if (!msg.tool_calls.length) delete msg.tool_calls;
    if (!msg.content && msg.tool_calls) msg.content = null;
    return { ok: true, message: msg };
  } catch (e) {
    throw neden || e;
  } finally {
    clearTimeout(zamanlayici);
    clearTimeout(toplam);
  }
}
const VARSAYILAN_SART_SURUMU = 1;

// Kullanım şartları onayını arayüz sorar; llm.js'in ekrana erişimi yok
let sartOnayiSor = async () => false;
export function sartOnayiAyarla(fn) {
  sartOnayiSor = fn;
}

const sartlarKabulEdilmediMi = (metin) => /terms_not_accepted/i.test(metin);
// "quota" kelimesi tek başına yetmez: dakikalık hız limitleri de "quota" diyebilir
const ucretliMi = (status, metin) => status === 402 ||
  ([400, 403, 429].includes(status) && /payment|billing|insufficient|credit|balance|subscription|paid plan|free (tier|period).*(ended|expired)/i.test(metin));

function sartBilgisi(metin) {
  const v = jsonOnar(metin) || {};
  const e = (typeof v.error === 'object' && v.error) || v;
  return {
    mesaj: e.message || e.detail || (typeof v.error === 'string' ? v.error : '') || '',
    adres: (String(metin).match(/https?:\/\/[^\s"'<>\\]+/) || [])[0] || '',
    surum: Number(e.terms_version ?? e.version ?? v.terms_version) || VARSAYILAN_SART_SURUMU,
  };
}

/** Şartları kullanıcıya gösterir, onaylarsa sunucuya bildirir. Onaylandıysa true. */
async function sartlariOnayla(id, key, metin) {
  const bilgi = sartBilgisi(metin);
  if (!(await sartOnayiSor({ saglayici: PROVIDERS[id].ad, ...bilgi }))) return false;
  const r = await fetch(`${PROVIDERS[id].url}/terms/accept`, {
    method: 'POST',
    headers: headers(id, key),
    body: JSON.stringify({ version: bilgi.surum }),
  });
  if (!r.ok) throw new Error(`şart onayı gönderilemedi: HTTP ${r.status} ${(await r.text()).slice(0, 150)}`);
  return true;
}

function headers(id, key) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
}

export function aktifSaglayicilar(ayar) {
  return (ayar.sira || Object.keys(PROVIDERS))
    .filter((id) => PROVIDERS[id] && ayar.anahtar?.[id]);
}

export async function modelleriGetir(id, key, { tazele = false } = {}) {
  const o = listeOnbellek[id];
  if (!tazele && o && Date.now() - o.zaman < 30 * 60_000) return o.modeller;
  const p = PROVIDERS[id];
  let r = await fetch(`${p.url}/models`, { headers: headers(id, key) });
  if (!r.ok) {
    const metin = await r.text();
    if (sartlarKabulEdilmediMi(metin)) {
      if (!(await sartlariOnayla(id, key, metin))) throw new Error('kullanım şartları onaylanmadı');
      r = await fetch(`${p.url}/models`, { headers: headers(id, key) });
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }
  const veri = await r.json();
  const liste = veri.data || veri.models || [];
  const modeller = liste.map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
  listeOnbellek[id] = { zaman: Date.now(), modeller };
  return modeller;
}

const surum = (ad) => {
  const m = ad.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
};

/** Listeden işe en uygun modeli seçer. tur: 'hizli' (uygulayıcı) | 'guclu' (planlayıcı/gözden geçiren) */
export function enIyiModel(id, modeller, tur = 'hizli') {
  if (!modeller?.length) return null;
  let adaylar = modeller;
  let puan = () => 0;

  if (id === 'evren') {
    adaylar = modeller.filter((m) => !/embed|whisper|tts|rerank|guard|vision|image/i.test(m));
    const p = PROVIDERS.evren;
    const sira = [(m) => m === p.anaModel, (m) => m === p.yedekModel, /deepseek/, /glm/, /qwen.*coder/, /qwen/, /kimi/]
      .map((k) => (typeof k === 'function' ? k : (m) => k.test(m)));
    puan = (m) => {
      const i = sira.findIndex((f) => f(m));
      return (i < 0 ? 0 : 100 - i * 10) + Math.min(surum(m), 9);
    };
  }
  if (!adaylar.length) adaylar = modeller;
  return [...adaylar].sort((a, b) => puan(b) - puan(a))[0];
}

const modelYokMu = (status, metin) => (status === 404 || status === 400) &&
  /model|slug/i.test(metin) && /not found|no longer|unavailable|does not exist|decommission|deprecated|not supported|invalid model/i.test(metin);
const aracHatasiMi = (status, metin) => status === 400 && /tool call validation|tool_use_failed|failed_generation|function call/i.test(metin);

/** Modeli çöz: ayarlıysa onu, değilse güncel listeden en iyisini (ve ayara kaydet). */
async function modelCoz(ayar, id, rol) {
  const istenen = rol ? ayar.roller?.[rol]?.model : ayar.model?.[id];
  if (istenen && istenen !== OTOMATIK) return istenen;
  let liste;
  try {
    liste = await modelleriGetir(id, ayar.anahtar[id]);
  } catch (e) {
    if (PROVIDERS[id].anaModel) return PROVIDERS[id].anaModel;
    throw e;
  }
  const secilen = enIyiModel(id, liste, rol ? 'guclu' : 'hizli');
  if (!secilen) throw new Error('uygun model bulunamadı');
  return secilen;
}

function modelKaydet(ayar, id, rol, model) {
  if (rol) ayar.roller[rol] = { ...(ayar.roller[rol] || {}), saglayici: id, model };
  else ayar.model = { ...(ayar.model || {}), [id]: model };
  ayar.degisti = true; // arayüz bunu görünce ayarları kaydeder
}

/**
 * messages: OpenAI formatında mesajlar, tools: araç tanımları.
 * rol: 'planlayici' | 'gozden' | undefined — o rol için seçilen model önce denenir,
 * olmazsa normal sıraya düşülür.
 * Dönen: { message, saglayici, model }
 */
export async function sohbet(ayar, messages, tools, durum = () => {}, rol) {
  const liste = aktifSaglayicilar(ayar);
  if (!liste.length) throw new Error('Ayarlardan en az bir model API anahtarı gir.');

  const hatalar = [];
  let aracHatasi = '';
  const simdi = Date.now();
  const dinleniyor = (id) => bekleme[id] > simdi || ayar.dinlen?.[id] > simdi;
  // Önce dinlenmeyenler, sonra (hepsi doluysa) dinlenenler
  const sirali = [
    ...liste.filter((id) => !dinleniyor(id)),
    ...liste.filter(dinleniyor),
  ].map((id) => ({ id }));

  const t = rol && ayar.roller?.[rol];
  if (t?.saglayici && ayar.anahtar?.[t.saglayici] && !(bekleme[`${t.saglayici}:${rol}`] > simdi)) {
    sirali.unshift({ id: t.saglayici, rol });
  }

  for (const aday of sirali) {
    const { id } = aday;
    const p = PROVIDERS[id];
    let model;
    let sartDenendi = false;
    let modelYenilendi = false;
    let yedekte = false;
    // Her biri en fazla bir kez: şart onayı, kalkmış modelin yenisi, yedek model, düşünme parametresi
    for (let deneme = 0; deneme < 5; deneme++) {
      if (!yedekte) {
        try {
          model = await modelCoz(ayar, id, aday.rol);
        } catch (e) {
          hatalar.push(`${p.ad}: model listesi alınamadı (${e.message})`);
          break;
        }
      }
      const is = rol === 'planlayici' ? 'plan yapıyor' : rol === 'gozden' ? 'gözden geçiriyor' : 'düşünüyor';
      durum(`${p.ad} (${model}) ${is}…`);
      try {
        const govde = { model, messages, temperature: 0.2 };
        const dusunmeKapat = p.dusunmeKapali && !dusunmeDesteksiz.has(id) && !DUSUNEN_ROLLER.has(aday.rol);
        if (dusunmeKapat) Object.assign(govde, p.dusunmeKapali);
        if (tools?.length) {
          govde.tools = tools;
          govde.tool_choice = 'auto';
        }
        const istekBas = Date.now();
        const r = await akisliIstek(`${p.url}/chat/completions`, headers(id, ayar.anahtar[id]), govde, ({ yazi, dusunce, sure }) => durum(
          yazi ? `${p.ad} (${model}) yazıyor… ${sayi(yazi)} karakter`
            : dusunce ? `${p.ad} (${model}) düşünüyor… ${sayi(dusunce)} karakter akıl yürütme`
              : `${p.ad} (${model}) isteği işliyor, bağlantı açık… ${sure} sn`));
        const metin = r.metin;
        olcum.istek++;
        olcum.sonSure = Date.now() - istekBas;
        olcum.sure += olcum.sonSure;
        if (!r.ok) {
          if (dusunmeKapat && parametreHatasiMi(r.status, metin)) {
            dusunmeDesteksiz.add(id);
            durum(`${p.ad} düşünme kapatmayı desteklemiyor, normal devam ediliyor…`);
            continue;
          }
          if (!sartDenendi && sartlarKabulEdilmediMi(metin)) {
            sartDenendi = true;
            durum(`${p.ad} kullanım şartlarını onaylaman gerekiyor…`);
            if (await sartlariOnayla(id, ayar.anahtar[id], metin)) continue;
            hatalar.push(`${p.ad}: kullanım şartları onaylanmadı`);
            break;
          }
          if (ucretliMi(r.status, metin)) {
            ayar.dinlen = { ...(ayar.dinlen || {}), [id]: Date.now() + UCRETLI_BEKLEME };
            ayar.degisti = true;
            durum(`${p.ad} ücretli olmuş ya da bakiye bitmiş…`);
            hatalar.push(`${p.ad} (${model}): ücret/bakiye hatası HTTP ${r.status} ${metin.slice(0, 150)}`);
            break;
          }
          if (!modelYenilendi && !yedekte && modelYokMu(r.status, metin)) {
            modelYenilendi = true;
            const yeni = enIyiModel(id, (await modelleriGetir(id, ayar.anahtar[id], { tazele: true })).filter((m) => m !== model), aday.rol ? 'guclu' : 'hizli');
            if (yeni) {
              modelKaydet(ayar, id, aday.rol, yeni);
              durum(`${p.ad}: ${model} kalkmış, ${yeni} seçildi…`);
              continue;
            }
          }
          if (aracHatasiMi(r.status, metin)) aracHatasi = metin.slice(0, 400);
          // Anahtar geçersizse (401) yedek model de aynı sonucu verir
          if (p.yedekModel && !yedekte && model !== p.yedekModel && r.status !== 401) {
            hatalar.push(`${p.ad} (${model}): HTTP ${r.status} ${metin.slice(0, 200)}`);
            yedekte = true;
            durum(`${p.ad}: ${model} yanıt vermedi, yedek model ${p.yedekModel} deneniyor…`);
            model = p.yedekModel;
            continue;
          }
          // Rol modeli dolduysa yalnızca o rolü dinlendir; sağlayıcının diğer modeli çalışabilir
          if (r.status === 429) bekleme[aday.rol ? `${id}:${aday.rol}` : id] = Date.now() + KOTA_BEKLEME;
          hatalar.push(`${p.ad} (${model}): HTTP ${r.status} ${metin.slice(0, 200)}`);
          break;
        }
        const { message } = r;
        if (!message || (!message.content && !message.tool_calls?.length)) {
          hatalar.push(`${p.ad}: boş yanıt`);
          break;
        }
        if (!aday.rol && !yedekte && !ayar.model?.[id]) modelKaydet(ayar, id, null, model);
        return { message, saglayici: p.ad, model };
      } catch (e) {
        if (e.name === 'TimeoutError') {
          hatalar.push(`${p.ad} (${model}): ${e.message} (yanıt vermedi)`);
          // Takılan model yerine yedeği dene; o da takılırsa bir sonraki adım önce diğer sağlayıcılarla denensin
          if (p.yedekModel && !yedekte && model !== p.yedekModel) {
            yedekte = true;
            durum(`${p.ad}: ${model} yanıt vermedi, yedek model ${p.yedekModel} deneniyor…`);
            model = p.yedekModel;
            continue;
          }
          bekleme[id] = Date.now() + KOTA_BEKLEME;
          durum(`${p.ad} yanıt vermedi: ${e.message}`);
        } else {
          hatalar.push(`${p.ad}: ${e.message}`);
        }
        break;
      }
    }
  }
  const e = new Error('Hiçbir model yanıt vermedi:\n' + hatalar.join('\n'));
  // Model geçersiz bir araç çağrısı ürettiyse ajan bunu modele söyleyip tekrar deneyebilir
  if (aracHatasi) e.aracHatasi = aracHatasi;
  throw e;
}

// ---------- Zayıf modeller için onarım yardımcıları ----------

/** Bozuk JSON'u kurtarmaya çalışır: kod çiti, sondaki virgül, eksik kapanış. Olmazsa null. */
export function jsonOnar(s) {
  if (s && typeof s === 'object') return s;
  if (!s || !String(s).trim()) return {};
  let t = String(s).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const dene = (x) => { try { return JSON.parse(x); } catch { return undefined; } };
  let v = dene(t);
  if (v !== undefined) return v;
  const bas = t.indexOf('{');
  const son = t.lastIndexOf('}');
  if (bas >= 0 && son > bas) {
    v = dene(t.slice(bas, son + 1));
    if (v !== undefined) return v;
    t = t.slice(bas, son + 1);
  }
  t = t.replace(/,\s*([}\]])/g, '$1');
  v = dene(t);
  if (v !== undefined) return v;
  // Eksik kapanan parantezleri tamamla
  let ac = 0, koseli = 0, tirnak = false, kacis = false;
  for (const c of t) {
    if (kacis) { kacis = false; continue; }
    if (c === '\\') { kacis = true; continue; }
    if (c === '"') tirnak = !tirnak;
    if (tirnak) continue;
    if (c === '{') ac++; else if (c === '}') ac--;
    else if (c === '[') koseli++; else if (c === ']') koseli--;
  }
  v = dene(t + (tirnak ? '"' : '') + ']'.repeat(Math.max(0, koseli)) + '}'.repeat(Math.max(0, ac)));
  return v === undefined ? null : v;
}

/**
 * Bazı ücretsiz modeller araç çağrısını tool_calls yerine metnin içine yazar:
 * {"arac": "dosya_oku", "arg": {...}} ya da {"name": ..., "arguments": ...}
 * Bunları yakalayıp gerçek araç çağrısına çevirir.
 */
export function metindenAracCagrilari(metin, gecerliAdlar) {
  if (!metin || !metin.includes('{')) return [];
  const sonuc = [];
  const bloklar = [...metin.matchAll(/```(?:json|tool)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  if (!bloklar.length) bloklar.push(metin);
  for (const b of bloklar) {
    const v = jsonOnar(b);
    const liste = Array.isArray(v) ? v : v ? [v] : [];
    for (const x of liste) {
      const ad = x?.arac || x?.name || x?.tool || x?.function?.name;
      const arg = x?.arg ?? x?.arguments ?? x?.parameters ?? x?.function?.arguments ?? {};
      if (ad && gecerliAdlar.has(ad)) {
        sonuc.push({
          id: `metin_${Date.now()}_${sonuc.length}`,
          type: 'function',
          function: { name: ad, arguments: typeof arg === 'string' ? arg : JSON.stringify(arg) },
        });
      }
    }
  }
  return sonuc;
}
