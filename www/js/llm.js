// Model sağlayıcıları — hepsi OpenAI uyumlu /chat/completions kullanır.
// Bir sağlayıcının limiti dolunca (429) ya da hata verince sıradakine geçilir.

export const PROVIDERS = {
  gemini: {
    ad: 'Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    anahtarSayfasi: 'https://aistudio.google.com/apikey',
  },
  openrouter: {
    ad: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1',
    model: 'qwen/qwen3-coder:free',
    anahtarSayfasi: 'https://openrouter.ai/keys',
  },
  groq: {
    ad: 'Groq',
    url: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    anahtarSayfasi: 'https://console.groq.com/keys',
  },
};

// Limit dolan sağlayıcıyı bir süre dinlendir
const bekleme = {}; // id -> zaman damgası (ms)

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
  // Önce dinlenmeyenler, sonra (hepsi doluysa) dinlenenler
  const simdi = Date.now();
  const sirali = [
    ...liste.filter((id) => !(bekleme[id] > simdi)),
    ...liste.filter((id) => bekleme[id] > simdi),
  ].map((id) => ({ id, model: ayar.model?.[id] || PROVIDERS[id].model }));

  const t = rol && ayar.roller?.[rol];
  if (t?.saglayici && ayar.anahtar?.[t.saglayici] && !(bekleme[`${t.saglayici}:${t.model}`] > simdi)) {
    sirali.unshift({ id: t.saglayici, model: t.model || PROVIDERS[t.saglayici].model, rolModeli: true });
  }

  for (const { id, model, rolModeli } of sirali) {
    const p = PROVIDERS[id];
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
        // Rol modeli dolduysa yalnızca o modeli dinlendir; sağlayıcının diğer modeli çalışabilir
        if (r.status === 429) bekleme[rolModeli ? `${id}:${model}` : id] = Date.now() + 60_000;
        hatalar.push(`${p.ad}: HTTP ${r.status} ${metin.slice(0, 200)}`);
        continue;
      }
      const veri = JSON.parse(metin);
      const message = veri.choices?.[0]?.message;
      if (!message) {
        hatalar.push(`${p.ad}: boş yanıt`);
        continue;
      }
      return { message, saglayici: p.ad, model };
    } catch (e) {
      hatalar.push(`${p.ad}: ${e.message}`);
    }
  }
  throw new Error('Hiçbir model yanıt vermedi:\n' + hatalar.join('\n'));
}

export async function modelleriGetir(id, key) {
  const p = PROVIDERS[id];
  const r = await fetch(`${p.url}/models`, { headers: headers(id, key) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const veri = await r.json();
  let ids = (veri.data || veri.models || []).map((m) => (m.id || m.name || '').replace(/^models\//, ''));
  if (id === 'openrouter') ids = ids.filter((m) => m.endsWith(':free'));
  return ids.filter(Boolean).sort();
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
