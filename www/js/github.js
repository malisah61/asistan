// GitHub REST API sarmalayıcısı (token ile)

const API = 'https://api.github.com';
// Geçici hatada bekleme süreleri (ms): üç tekrar, toplam ~8 sn
const GECICI_DENEME = [1000, 2500, 4500];

export function b64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function b64Decode(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GitHub {
  constructor(token) {
    this.token = token;
  }

  async istek(yol, secenek = {}) {
    // GitHub zaman zaman boş 5xx ya da bağlantı hatası veriyor; tekrarlanması güvenli isteklerde biraz bekleyip yeniden dene.
    // POST (ör. workflow başlatma, PR açma) tekrarlanmaz: ilki aslında başarılıysa iş iki kez yapılır.
    const tekrarlanabilir = (secenek.method || 'GET') !== 'POST';
    for (let deneme = 0; ; deneme++) {
      try {
        return await this.tekIstek(yol, secenek);
      } catch (e) {
        const gecici = e.status >= 500 || (e instanceof TypeError && !e.status);
        if (!tekrarlanabilir || !gecici || deneme >= GECICI_DENEME.length) throw e;
        await new Promise((r) => setTimeout(r, GECICI_DENEME[deneme]));
      }
    }
  }

  async tekIstek(yol, { method = 'GET', body, ham = false } = {}) {
    if (!this.token) throw new Error('Ayarlardan GitHub token gir.');
    const r = await fetch(yol.startsWith('http') ? yol : API + yol, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: ham ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      // Oturum dosyaları sık yoklanıyor; tarayıcı önbelleği 60 sn eski veri gösterebilir
      cache: 'no-store',
    });
    const metin = await r.text();
    if (!r.ok) {
      const e = new Error(`GitHub ${r.status}: ${metin.slice(0, 300) || (r.status >= 500 ? 'GitHub geçici bir sunucu hatası verdi, birazdan tekrar dene' : '')}`);
      e.status = r.status;
      throw e;
    }
    if (ham) return metin;
    return metin ? JSON.parse(metin) : {};
  }

  kullanici() {
    return this.istek('/user');
  }

  async repolar() {
    const r = await this.istek('/user/repos?per_page=100&sort=pushed');
    return r.map((x) => ({ ad: x.full_name, ozel: x.private, dal: x.default_branch, aciklama: x.description }));
  }

  async varsayilanDal(repo) {
    return (await this.istek(`/repos/${repo}`)).default_branch;
  }

  async agac(repo, ref) {
    ref = ref || (await this.varsayilanDal(repo));
    const r = await this.istek(`/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    return r.tree.filter((t) => t.type === 'blob').map((t) => t.path);
  }

  async dosyaOku(repo, yol, ref) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const r = await this.istek(`/repos/${repo}/contents/${encodeURI(yol)}${q}`);
    if (Array.isArray(r)) return { klasor: true, icerik: r.map((x) => x.path) };
    return { sha: r.sha, icerik: r.content ? b64Decode(r.content) : await this.istek(r.download_url, { ham: true }) };
  }

  /** Bir dosyaya dokunan son commit: ne zaman, hangi mesajla değişti. */
  async sonDegisiklik(repo, yol, dal) {
    const q = `path=${encodeURIComponent(yol)}&per_page=1${dal ? `&sha=${encodeURIComponent(dal)}` : ''}`;
    const r = await this.istek(`/repos/${repo}/commits?${q}`);
    const c = r[0];
    return c ? { tarih: c.commit.author?.date || c.commit.committer?.date, mesaj: c.commit.message.split('\n')[0], sha: c.sha.slice(0, 7) } : null;
  }

  /** Görseli tarayıcıda gösterilecek URL olarak getirir (gizli repolar dahil; token ile). */
  async gorselUrl(repo, yol, dal) {
    const q = dal ? `?ref=${encodeURIComponent(dal)}` : '';
    const r = await this.istek(`/repos/${repo}/contents/${encodeURI(yol)}${q}`);
    const tur = /\.png$/i.test(yol) ? 'image/png' : /\.gif$/i.test(yol) ? 'image/gif' : /\.webp$/i.test(yol) ? 'image/webp' : 'image/jpeg';
    // 1 MB altı dosyalar JSON içinde base64 gelir; bu yol uygulamada da tarayıcıda da güvenle çalışır
    if (r.content) return `data:${tur};base64,${r.content.replace(/\n/g, '')}`;
    const ham = await fetch(`${API}/repos/${repo}/contents/${encodeURI(yol)}${q}`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!ham.ok) throw new Error(`GitHub ${ham.status}`);
    return URL.createObjectURL(await ham.blob());
  }

  async sha(repo, yol, dal) {
    try {
      return (await this.dosyaOku(repo, yol, dal)).sha;
    } catch (e) {
      if (e.status === 404) return undefined;
      throw e;
    }
  }

  async dosyaYaz(repo, yol, icerik, mesaj, dal) {
    const sha = await this.sha(repo, yol, dal);
    const body = { message: mesaj, content: b64Encode(icerik) };
    if (sha) body.sha = sha;
    if (dal) body.branch = dal;
    const r = await this.istek(`/repos/${repo}/contents/${encodeURI(yol)}`, { method: 'PUT', body });
    this.sonCommit = r.commit?.sha;
    return r.commit?.html_url;
  }

  async issueAc(repo, baslik, govde, etiket) {
    if (etiket) {
      try {
        await this.istek(`/repos/${repo}/labels`, {
          method: 'POST',
          body: { name: etiket, color: 'd97757', description: 'Asistan çözemedi, Claude devraldı' },
        });
      } catch (e) {
        if (e.status !== 422) throw e; // 422 = etiket zaten var
      }
    }
    const r = await this.istek(`/repos/${repo}/issues`, {
      method: 'POST',
      body: { title: baslik, body: govde, labels: etiket ? [etiket] : [] },
    });
    return r.html_url;
  }

  async dosyaSil(repo, yol, mesaj, dal) {
    const sha = await this.sha(repo, yol, dal);
    if (!sha) throw new Error('Dosya bulunamadı');
    const body = { message: mesaj, sha };
    if (dal) body.branch = dal;
    await this.istek(`/repos/${repo}/contents/${encodeURI(yol)}`, { method: 'DELETE', body });
  }

  async dalOlustur(repo, yeni, kaynak) {
    kaynak = kaynak || (await this.varsayilanDal(repo));
    const ref = await this.istek(`/repos/${repo}/git/ref/heads/${encodeURIComponent(kaynak)}`);
    await this.istek(`/repos/${repo}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${yeni}`, sha: ref.object.sha },
    });
    return yeni;
  }

  async prAc(repo, baslik, aciklama, dal, hedef) {
    hedef = hedef || (await this.varsayilanDal(repo));
    const r = await this.istek(`/repos/${repo}/pulls`, {
      method: 'POST',
      body: { title: baslik, body: aciklama, head: dal, base: hedef },
    });
    return r.html_url;
  }

  async prBirlestir(repo, numara, baslik) {
    const r = await this.istek(`/repos/${repo}/pulls/${numara}/merge`, {
      method: 'PUT',
      body: { merge_method: 'squash', ...(baslik ? { commit_title: baslik } : {}) },
    });
    return r.sha;
  }

  async releaseEtiket(repo, etiket) {
    try {
      return await this.istek(`/repos/${repo}/releases/tags/${encodeURIComponent(etiket)}`);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async kodAra(repo, sorgu) {
    const r = await this.istek(`/search/code?q=${encodeURIComponent(sorgu + ' repo:' + repo)}&per_page=20`);
    return r.items.map((i) => i.path);
  }

  async calismalar(repo, dal, sha) {
    const q = (dal ? `&branch=${encodeURIComponent(dal)}` : '') + (sha ? `&head_sha=${sha}` : '');
    const r = await this.istek(`/repos/${repo}/actions/runs?per_page=10${q}`);
    return r.workflow_runs.map((w) => ({
      id: w.id, ad: w.name, dal: w.head_branch, sha: w.head_sha, durum: w.status, sonuc: w.conclusion, url: w.html_url,
    }));
  }

  async dalSonCommit(repo, dal) {
    dal = dal || (await this.varsayilanDal(repo));
    return (await this.istek(`/repos/${repo}/commits/${encodeURIComponent(dal)}`)).sha;
  }

  async calismaHatalari(repo, runId) {
    const r = await this.istek(`/repos/${repo}/actions/runs/${runId}/jobs`);
    const ciktilar = [];
    for (const job of r.jobs) {
      const basarisiz = job.steps?.filter((s) => s.conclusion === 'failure').map((s) => s.name) || [];
      let log = '';
      if (job.conclusion === 'failure') {
        try {
          log = await this.istek(`/repos/${repo}/actions/jobs/${job.id}/logs`, { ham: true });
          log = log.split('\n').slice(-120).join('\n'); // sondaki 120 satır yeterli
        } catch (e) {
          log = `(log alınamadı: ${e.message})`;
        }
      }
      ciktilar.push({ is: job.name, sonuc: job.conclusion, basarisizAdimlar: basarisiz, log });
    }
    return ciktilar;
  }

  async calismaBaslat(repo, workflowDosyasi, dal, girdiler) {
    dal = dal || (await this.varsayilanDal(repo));
    await this.istek(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflowDosyasi)}/dispatches`, {
      method: 'POST',
      body: { ref: dal, ...(girdiler ? { inputs: girdiler } : {}) },
    });
    return 'Başlatıldı';
  }

  async repoBilgi(repo) {
    try {
      return await this.istek(`/repos/${repo}`);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /** Gizli hafıza reposu yoksa oluşturmayı dener (token'ın Administration izni varsa olur). */
  async ozelRepoOlustur(ad, aciklama) {
    return this.istek('/user/repos', { method: 'POST', body: { name: ad, private: true, auto_init: true, description: aciklama } });
  }

  async secretAdlari(repo) {
    const r = await this.istek(`/repos/${repo}/actions/secrets?per_page=100`);
    return r.secrets.map((x) => x.name);
  }
}
