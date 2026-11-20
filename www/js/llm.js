// Model sağlayıcıları — hepsi OpenAI uyumlu /chat/completions kullanır.
// Bir sağlayıcının limiti dolunca (429) ya da hata verince sıradakine geçilir.

export const PROVIDERS = {
  gemini: {
    ad: 'Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    anahtarSayfasi: 'https://aistudio.google.com/apikey',
  },
  openrouter: {
    ad: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1',
    anahtarSayfasi: 'https://openrouter.ai/keys',
  },
  groq: {
    ad: 'Groq',
    url: 'https://api.groq.com/openai/v1',
    anahtarSayfasi: 'https://console.groq.com/keys',
  },
};

// Model boş ya da "otomatik" ise sağlayıcının güncel listesinden en uygunu seçilir.
// Sabit model adı yazmıyoruz: ücretsiz modeller sık sık kalkıyor ya da adı değişiyor.
export const OTOMATIK = 'otomatik';

// Limit dolan sağlayıcıyı bir süre dinlendir
const bekleme = {}; // id ya da id:model -> zaman damgası (ms)
const listeOnbellek = {}; // id -> { zaman, modeller }

function headers(id, key) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  if (id === 'openrouter') {
    h['HTTP-Referer'] = 'https://github.com/malisah61/asistan';
    h['X-Title'] = 'Asistan';
  }
  return h;
}

export function aktifSaglayicilar(ayar) {
  return (ayar.sira || Object.keys(PROVIDERS))
    .filter((id) => PROVIDERS[id] && ayar.anahtar?.[id]);
}

export async function modelleriGetir(id, key, { tazele = false } = {}) {
  const o = listeOnbellek[id];
  if (!tazele && o && Date.now() - o.zaman < 30 * 60_000) return o.modeller;
  const p = PROVIDERS[id];
  const r = await fetch(`${p.url}/models`, { headers: headers(id, key) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const veri = await r.json();
  let liste = veri.data || veri.models || [];
  if (id === 'openrouter') {
    // Yalnızca ücretsiz ve araç (tool) kullanabilen modeller işimize yarar
    liste = liste.filter((m) => String(m.id).endsWith(':free') &&
      (!m.supported_parameters || m.supported_parameters.includes('tools')));
  }
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

  if (id === 'gemini') {
    adaylar = modeller.filter((m) => /^gemini-\d/.test(m) &&
      !/lite|image|tts|audio|live|embed|vision|native|computer|robotics|learnlm|aqa/i.test(m));
    puan = (m) => surum(m) * 100 +
      (tur === 'guclu' ? (/pro/.test(m) ? 50 : 0) : (/flash/.test(m) ? 50 : 0)) -
      (/preview|exp/.test(m) ? 5 : 0) - (/-\d{2,}$|-\d{4}/.test(m) ? 2 : 0);
  } else if (id === 'groq') {
    adaylar = modeller.filter((m) => !/whisper|tts|guard|embed|vision|compound|playai|distil/i.test(m));
    const sira = ['openai/gpt-oss-120b', 'moonshotai/kimi', 'qwen/qwen3', 'meta-llama/llama-4-maverick', 'llama-3.3-70b', 'openai/gpt-oss-20b'];
    puan = (m) => {
      const i = sira.findIndex((x) => m.includes(x));
      return i < 0 ? 0 : 100 - i * 10;
    };
  } else if (id === 'openrouter') {
    const sira = [/qwen.*coder/, /deepseek/, /kimi/, /glm/, /gpt-oss-120b/, /devstral/, /qwen3/, /llama-4/, /gemini/, /mistral/];
    puan = (m) => {
      const i = sira.findIndex((re) => re.test(m));
      return (i < 0 ? 0 : 100 - i * 8) + Math.min(surum(m.split('/')[1] || ''), 9);
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
  const secilen = enIyiModel(id, await modelleriGetir(id, ayar.anahtar[id]), rol ? 'guclu' : 'hizli');
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
  // Önce dinlenmeyenler, sonra (hepsi doluysa) dinlenenler
  const sirali = [
    ...liste.filter((id) => !(bekleme[id] > simdi)),
    ...liste.filter((id) => bekleme[id] > simdi),
  ].map((id) => ({ id }));

  const t = rol && ayar.roller?.[rol];
  if (t?.saglayici && ayar.anahtar?.[t.saglayici] && !(bekleme[`${t.saglayici}:${rol}`] > simdi)) {
    sirali.unshift({ id: t.saglayici, rol });
  }

  for (const aday of sirali) {
    const { id } = aday;
    const p = PROVIDERS[id];
    let model;
    // Model kalkmışsa listeden yenisini seçip bir kez daha dene
    for (let deneme = 0; deneme < 2; deneme++) {
      try {
        model = await modelCoz(ayar, id, aday.rol);
      } catch (e) {
        hatalar.push(`${p.ad}: model listesi alınamadı (${e.message})`);
        break;
      }
      durum(`${p.ad} (${model}) ${rol === 'planlayici' ? 'plan yapıyor' : rol === 'gozden' ? 'gözden geçiriyor' : 'düşünüyor'}…`);
      try {
        const govde = { model, messages, temperature: 0.2 };
        if (tools?.length) {
          govde.tools = tools;
          govde.tool_choice = 'auto';
        }
        const r = await fetch(`${p.url}/chat/completions`, {
          method: 'POST',
          headers: headers(id, ayar.anahtar[id]),
          body: JSON.stringify(govde),
        });
        const metin = await r.text();
        if (!r.ok) {
          if (deneme === 0 && modelYokMu(r.status, metin)) {
            const yeni = enIyiModel(id, (await modelleriGetir(id, ayar.anahtar[id], { tazele: true })).filter((m) => m !== model), aday.rol ? 'guclu' : 'hizli');
            if (yeni) {
              modelKaydet(ayar, id, aday.rol, yeni);
              durum(`${p.ad}: ${model} kalkmış, ${yeni} seçildi…`);
              continue;
            }
          }
          if (aracHatasiMi(r.status, metin)) aracHatasi = metin.slice(0, 400);
          // Rol modeli dolduysa yalnızca o rolü dinlendir; sağlayıcının diğer modeli çalışabilir
          if (r.status === 429) bekleme[aday.rol ? `${id}:${aday.rol}` : id] = Date.now() + 60_000;
          hatalar.push(`${p.ad} (${model}): HTTP ${r.status} ${metin.slice(0, 200)}`);
          break;
        }
        const veri = JSON.parse(metin);
        const message = veri.choices?.[0]?.message;
        if (!message) {
          hatalar.push(`${p.ad}: boş yanıt`);
          break;
        }
        if (!aday.rol && !ayar.model?.[id]) modelKaydet(ayar, id, null, model);
        return { message, saglayici: p.ad, model };
      } catch (e) {
        hatalar.push(`${p.ad}: ${e.message}`);
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
