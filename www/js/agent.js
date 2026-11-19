// Ajan döngüsü + hafıza (AGENTS.md ve dersler.md) + görev sonu öz değerlendirme

import { sohbet } from './llm.js';
import { ARACLAR, calistir } from './tools.js';

const YEDEK_STIL = `Önce oku ve anla, sonra planla, sonra küçük adımlarla değiştir.
Değiştirmeden önce dosyayı mutlaka oku. Varsayım yapma; emin değilsen kullanıcıya sor.
Ana dala doğrudan yazma: dal aç, commit at, PR aç. Değişiklikten sonra Actions sonucunu kontrol et.`;

export class Hafiza {
  constructor(gh, repo) {
    this.gh = gh;
    this.repo = repo;
    this.yol = 'hafiza/dersler.md';
  }

  async oku(yol) {
    try {
      return (await this.gh.dosyaOku(this.repo, yol)).icerik;
    } catch {
      return '';
    }
  }

  stil() {
    return this.oku('AGENTS.md');
  }

  dersler() {
    return this.oku(this.yol);
  }

  async dersEkle(ders) {
    ders = String(ders).replace(/\s+/g, ' ').trim();
    if (!ders) return;
    const mevcut = await this.dersler();
    if (mevcut.includes(ders)) return;
    const tarih = new Date().toISOString().slice(0, 10);
    const yeni = (mevcut || '# Asistanın dersleri\n') .trimEnd() + `\n- ${tarih}: ${ders}\n`;
    await this.gh.dosyaYaz(this.repo, this.yol, yeni, 'hafıza: yeni ders');
  }

  async yenidenYaz(icerik) {
    await this.gh.dosyaYaz(this.repo, this.yol, icerik, 'hafıza: dersler birleştirildi');
  }
}

async function sistemMesaji(hafiza, aktifRepo, gh) {
  const [stil, dersler] = await Promise.all([hafiza.stil(), hafiza.dersler()]);
  let repoKurallari = '';
  if (aktifRepo && aktifRepo !== hafiza.repo) {
    try {
      repoKurallari = (await gh.dosyaOku(aktifRepo, 'AGENTS.md')).icerik;
    } catch { /* yoksa sorun değil */ }
  }
  return [
    'Sen "Asistan"sın: kullanıcının GitHub repoları üzerinde çalışan bir kodlama ajanısın.',
    'Kullanıcıyla her zaman Türkçe konuş. Kısa ve net ol; telefondan okunuyor.',
    'Araçlarla repoları okuyup yazabilir, dal/PR açabilir, GitHub Actions sonuçlarını okuyabilirsin.',
    'Telefonda terminal yok: test ve build için GitHub Actions kullan, sonucu actions_durum/actions_hata ile kontrol et.',
    '',
    '## Çalışma stilin (AGENTS.md)',
    stil || YEDEK_STIL,
    '',
    '## Geçmiş işlerden öğrendiğin dersler',
    dersler ? dersler.slice(-6000) : '(henüz ders yok)',
    repoKurallari ? `\n## ${aktifRepo} reposunun kendi kuralları\n${repoKurallari.slice(0, 6000)}` : '',
    '',
    aktifRepo ? `Aktif repo: ${aktifRepo}` : 'Aktif repo seçilmedi; gerekirse repolari_listele ile bak.',
    `Bugün: ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');
}

function argCoz(s) {
  try {
    return typeof s === 'string' ? JSON.parse(s || '{}') : s || {};
  } catch {
    return null;
  }
}

/**
 * Bir görevi çalıştırır. gecmis: önceki kullanıcı/asistan mesajları (yalnızca metin).
 * ui: { durum(t), arac(ad, arg, sonuc), onayla(ad, ozet), durdurulduMu() }
 */
export async function gorevCalistir({ ayar, gh, hafiza, aktifRepo, gecmis, istek, ui }) {
  const sistem = await sistemMesaji(hafiza, aktifRepo, gh);
  const mesajlar = [{ role: 'system', content: sistem }, ...gecmis.slice(-12), { role: 'user', content: istek }];
  const gunluk = []; // öz değerlendirme için
  const maksAdim = Number(ayar.maksAdim) || 30;

  for (let adim = 0; adim < maksAdim; adim++) {
    if (ui.durdurulduMu()) return { cevap: '(Durduruldu)', gunluk };
    const { message, saglayici, model } = await sohbet(ayar, mesajlar, ARACLAR, ui.durum);
    const cagrilar = (message.tool_calls || []).map((c, i) => ({ ...c, id: c.id || `cagri_${adim}_${i}`, type: 'function' }));
    mesajlar.push({
      role: 'assistant',
      content: message.content || (cagrilar.length ? null : ''),
      ...(cagrilar.length ? { tool_calls: cagrilar } : {}),
    });

    if (!cagrilar.length) {
      return { cevap: message.content || '(boş yanıt)', gunluk, saglayici, model };
    }

    for (const c of cagrilar) {
      const ad = c.function?.name;
      const arg = argCoz(c.function?.arguments);
      let sonuc;
      if (arg === null) {
        sonuc = 'HATA: argümanlar geçerli JSON değil. Tekrar dene.';
      } else {
        try {
          ui.durum(`${ad} çalışıyor…`);
          sonuc = await calistir(ad, arg, { gh, onayla: ui.onayla, hafiza, ayar });
        } catch (e) {
          sonuc = `HATA: ${e.message}`;
        }
      }
      ui.arac(ad, arg, sonuc);
      gunluk.push(`${ad}(${JSON.stringify(arg).slice(0, 200)}) → ${String(sonuc).slice(0, 200)}`);
      mesajlar.push({ role: 'tool', tool_call_id: c.id, name: ad, content: String(sonuc) });
    }
  }
  return { cevap: `Adım sınırına (${maksAdim}) ulaştım. "devam et" yazarsan kaldığım yerden sürdürürüm.`, gunluk };
}

/** Görev bitince: bu işten kalıcı bir ders çıkar, dersler çok uzadıysa birleştir. */
export async function ozDegerlendir({ ayar, hafiza, istek, cevap, gunluk }) {
  if (!gunluk.length) return null;
  const istem = [
    { role: 'system', content: 'Bir kodlama ajanının az önceki işini değerlendiriyorsun. Yalnızca JSON döndür.' },
    {
      role: 'user',
      content: `İstek: ${istek}\n\nAraç günlüğü:\n${gunluk.join('\n').slice(0, 6000)}\n\nSonuç: ${String(cevap).slice(0, 1500)}\n\n` +
        'Bu işte bir hata, tekrar eden zorluk ya da kullanıcı tercihi ortaya çıktıysa, gelecekte işe yarayacak TEK kısa ve genel bir ders yaz. ' +
        'Önemli bir şey yoksa ders null olsun. Biçim: {"ders": "..."} ya da {"ders": null}',
    },
  ];
  try {
    const { message } = await sohbet(ayar, istem, null, () => {});
    const m = (message.content || '').match(/\{[\s\S]*\}/);
    const ders = m ? JSON.parse(m[0]).ders : null;
    if (ders) await hafiza.dersEkle(ders);

    const tum = await hafiza.dersler();
    const satir = tum.split('\n').filter((l) => l.startsWith('- ')).length;
    if (satir > 60) await dersleriBirlestir({ ayar, hafiza, tum });
    return ders;
  } catch {
    return null;
  }
}

async function dersleriBirlestir({ ayar, hafiza, tum }) {
  const { message } = await sohbet(ayar, [
    { role: 'system', content: 'Ders listesini düzenliyorsun. Yalnızca markdown döndür.' },
    {
      role: 'user',
      content: 'Aşağıdaki dersleri birleştir: tekrarları ve eskimişleri at, benzerleri tek maddede topla, en fazla 35 madde kalsın. ' +
        'Başlık "# Asistanın dersleri" olsun, her madde "- " ile başlasın.\n\n' + tum,
    },
  ], null, () => {});
  const yeni = (message.content || '').replace(/^```\w*\n?|```$/g, '').trim();
  if (yeni.startsWith('# ') && yeni.includes('\n- ')) await hafiza.yenidenYaz(yeni + '\n');
}
