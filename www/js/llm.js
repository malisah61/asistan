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
 * Dönen: { message, saglayici, model }
 */
export async function sohbet(ayar, messages, tools, durum = () => {}) {
  const liste = aktifSaglayicilar(ayar);
  if (!liste.length) throw new Error('Ayarlardan en az bir model API anahtarı gir.');

  const hatalar = [];
  // Önce dinlenmeyenler, sonra (hepsi doluysa) dinlenenler
  const simdi = Date.now();
  const sirali = [
    ...liste.filter((id) => !(bekleme[id] > simdi)),
    ...liste.filter((id) => bekleme[id] > simdi),
  ];

  for (const id of sirali) {
    const p = PROVIDERS[id];
    const model = ayar.model?.[id] || p.model;
    durum(`${p.ad} (${model}) düşünüyor…`);
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
        if (r.status === 429) bekleme[id] = Date.now() + 60_000;
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
