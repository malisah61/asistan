// Bağlayıcılar: uzak MCP (Model Context Protocol) sunucularına "Streamable HTTP" ile bağlanır,
// araçlarını Asistan'ın araçlarına ekler. Yalnızca bulut çalıştırıcısında kullanılır.

const ISTEK_SURESI = 60_000;
const BASLAMA_SURESI = 20_000;
const PROTOKOL = '2025-06-18';
// Bir sunucudan en fazla bu kadar araç: modelin araç listesi şişmesin
const MAKS_ARAC = 15;
const MAKS_SONUC = 12_000;

// Varsayılan, ücretsiz ve girişsiz bağlayıcılar
export const VARSAYILAN_BAGLAYICILAR = [
  {
    ad: 'context7', url: 'https://mcp.context7.com/mcp', acik: true,
    aciklama: 'Güncel kütüphane/motor belgeleri (Godot, Phaser, React…)',
    anahtarOrtam: 'CONTEXT7_ANAHTAR', anahtarBaslik: 'CONTEXT7_API_KEY',
  },
  {
    ad: 'deepwiki', url: 'https://mcp.deepwiki.com/mcp', acik: true,
    aciklama: 'Herkese açık GitHub projelerinin nasıl çalıştığını anlatır',
  },
];

export const aracAdi = (sunucu, arac) => `mcp_${sunucu}_${arac}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

export class McpIstemci {
  constructor({ ad, url, basliklar = {} }) {
    this.ad = ad;
    this.url = url;
    this.basliklar = basliklar;
    this.no = 0;
    this.oturum = null;
    this.surum = null;
  }

  async istek(method, params, { bildirim = false, sure = ISTEK_SURESI } = {}) {
    const id = bildirim ? undefined : ++this.no;
    const r = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.surum ? { 'MCP-Protocol-Version': this.surum } : {}),
        ...(this.oturum ? { 'Mcp-Session-Id': this.oturum } : {}),
        ...this.basliklar,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(bildirim ? {} : { id }) }),
      signal: AbortSignal.timeout(sure),
    });
    const sid = r.headers.get('mcp-session-id');
    if (sid) this.oturum = sid;
    const metin = await r.text();
    if (bildirim) return null;
    if (!r.ok) throw new Error(`${this.ad}: HTTP ${r.status} ${metin.slice(0, 200)}`);
    const cevap = (r.headers.get('content-type') || '').includes('event-stream')
      ? metin.split('\n').filter((l) => l.startsWith('data:')).map((l) => { try { return JSON.parse(l.slice(5)); } catch { return null; } })
        .find((j) => j && j.id === id)
      : JSON.parse(metin);
    if (!cevap) throw new Error(`${this.ad}: boş cevap`);
    if (cevap.error) throw new Error(`${this.ad}: ${cevap.error.message || JSON.stringify(cevap.error)}`);
    return cevap.result;
  }

  async baslat() {
    const r = await this.istek('initialize', {
      protocolVersion: PROTOKOL, capabilities: {}, clientInfo: { name: 'asistan', version: '0.4' },
    }, { sure: BASLAMA_SURESI });
    this.surum = r.protocolVersion || PROTOKOL;
    await this.istek('notifications/initialized', undefined, { bildirim: true });
    return r;
  }

  async araclar() {
    const liste = [];
    let cursor;
    do {
      const r = await this.istek('tools/list', cursor ? { cursor } : {});
      liste.push(...(r.tools || []));
      cursor = r.nextCursor;
    } while (cursor && liste.length < MAKS_ARAC);
    return liste.slice(0, MAKS_ARAC);
  }

  async cagir(arac, argumanlar) {
    const r = await this.istek('tools/call', { name: arac, arguments: argumanlar || {} });
    const metin = (r.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}${c.uri ? ' ' + c.uri : ''}]`)).join('\n');
    const sonuc = metin.length > MAKS_SONUC ? metin.slice(0, MAKS_SONUC) + `\n…(${metin.length - MAKS_SONUC} karakter kesildi)` : metin;
    return (r.isError ? 'HATA: ' : '') + (sonuc || '(boş sonuç)');
  }
}

/**
 * Açık bağlayıcılara bağlanır, araçlarını Asistan araç biçimine çevirir.
 * anahtarlar: { bağlayıcı adı → token } (MCP_ANAHTARLARI secret'ı) ve ortam değişkenleri.
 * Dönen: { araclar: [{ tanim, calistir, okuma }], notlar: ['context7: 2 araç', 'x: bağlanamadı (...)'] }
 */
export async function baglayicilariYukle(liste, { ortam = {}, anahtarlar = {} } = {}) {
  const araclar = [];
  const notlar = [];
  await Promise.all((liste || []).filter((b) => b.acik !== false && b.url).map(async (b) => {
    const basliklar = {};
    const token = anahtarlar[b.ad] || (b.anahtarOrtam && ortam[b.anahtarOrtam]);
    if (token) basliklar[b.anahtarBaslik || 'Authorization'] = b.anahtarBaslik ? token : `Bearer ${token}`;
    const istemci = new McpIstemci({ ad: b.ad, url: b.url, basliklar });
    try {
      await istemci.baslat();
      const tanimlar = await istemci.araclar();
      for (const t of tanimlar) {
        araclar.push({
          tanim: {
            type: 'function',
            function: {
              name: aracAdi(b.ad, t.name),
              description: `[${b.ad} bağlayıcısı] ${(t.description || t.title || '').slice(0, 900)}`,
              parameters: t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} },
            },
          },
          okuma: Boolean(t.annotations?.readOnlyHint),
          calistir: (arg) => istemci.cagir(t.name, arg),
        });
      }
      notlar.push(`${b.ad}: ${tanimlar.length} araç`);
    } catch (e) {
      notlar.push(`${b.ad}: bağlanamadı (${String(e.message).slice(0, 120)})`);
    }
  }));
  return { araclar, notlar };
}
