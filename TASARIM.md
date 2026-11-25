# Asistan tasarım notları: güçlü bir kodlama ajanı nasıl çalışır?

Bu belge 25 soruyu Asistan'ın gerçek deneyimiyle (25 Kasım 2026'daki hatalar ve düzeltmeler) cevaplar.
**(tahmin)** işaretli yerler modelin iç yapısına dair doğrulanamayan çıkarımlardır.

---

## A) Düşünme ve akıl yürütme

**1. Model cevabı nasıl üretir, "düşünme" neyi değiştirir?**
Model metni parça parça (token) üretir; her parça, o ana kadarki bütün bağlama bakılarak seçilir. Ayrı bir mantık motoru yoktur. "Düşünme" aşaması, cevaptan önce modelin kendine yazdığı ara metindir: ara adımları açıkça yazınca karmaşık işlerde (hata ayıklama, mimari karar, çok adımlı plan) daha doğru sonuca varır. Bedeli süredir: EVREN'de bu aşama adım başına dakikalar sürebiliyor. **Gereksiz olduğu yerler:** dosya okumak, belli bir satırı değiştirmek, araç çağırmak gibi ne yapılacağı açık adımlar. Asistan bu yüzden düşünmeyi yalnızca planlayıcıda açık tutar.

**2. Planlama modelde mi, iskelette mi?**
İkisinde de. Güçlü modeller kendi içinde planlar **(tahmin: eğitimde bu davranış ödüllendirildiği için)**. Zayıf modeller ise bir iki adım sonra hedefi unutur. İskeletin plan listesini dışarıda tutması ve her adımda "şu an 3. maddedesin" diye hatırlatması zayıf modelde büyük fark yaratır.
- *Ayrı planlayıcı faydalı:* birden çok dosyaya dokunan, sırası önemli işler ("karakter sistemini değiştir, sonra NPC'leri uyarla, sonra PR").
- *Zaman kaybı:* tek dosyalık düzeltme, "devam et", soru-cevap. Asistan 60 karakterden kısa isteklerde ve yarım plan varken yeni plan çıkarmaz.

**3. Model "emin değilim"i nasıl fark eder, dışarıdan nasıl anlaşılır?**
Model kendi belirsizliğini güvenilir biçimde ölçemez **(tahmin)**; emin olmadığı şeyi de akıcı yazabilir. Dışarıdan bakılacak sinyaller:
- aynı dosyayı tekrar tekrar okuması,
- aynı aracı aynı argümanla tekrar çağırması,
- "yapacağım" deyip araç çağırmaması,
- var olmayan araç ya da fonksiyon adı uydurması,
- kontrolün üst üste kırılması.

Bunlar görülünce iskelet müdahale etmeli: dürtme notu, `danis`, kullanıcıya soru ya da devretme.

**4. Zayıf ve güçlü model farkı en çok nerede?**
Sırayla:
- **Kendini kontrol:** zayıf model "bitti" der ama test etmemiştir.
- **Hata ayıklama:** belirtiyi düzeltir, kök sebebi bulmaz.
- **Uzun görevde odak:** plandan sapar, baştan başlar.
- **Araç kullanımı:** yanlış JSON, girdisiz çağrı.

Kısa ve net kod yazmada fark en azdır. Sonuç: zayıf modelle çalışırken iskeletin en çok kontrol ve odak konusunda yardım etmesi gerekir.

---

## B) Çalışma döngüsü ve mantık

**5. "Oku → planla → değiştir → doğrula → raporla" döngüsünde sık hatalar**
- *Oku:* her şeyi okumak (bağlam şişer, yavaşlar) ya da hiç okumadan yazmak. Doğrusu: repo haritası → yalnızca ilgili dosyalar → büyük dosyada ilgili satırlar.
- *Planla:* dosyayı görmeden plan yapmak; plan maddesi yerine "her şeyi iyileştir" gibi belirsiz hedef.
- *Değiştir:* bütün dosyayı yeniden yazmak (yavaş, bozulmaya açık); `…kalanı aynı` diye kısaltmak; yanlış dala yazmak.
- *Doğrula:* hiç doğrulamamak ya da "build geçti"yi "oyun çalışıyor" sanmak.
- *Raporla:* yapılmayanı yapılmış gibi anlatmak; eksik kalanı söylememek. Bugünkü PR'da 4 karakter atlanmıştı ama rapor "hepsi" diyordu.

**6. "Varsayma, bak" kuralları**
- Var olduğundan emin olmadığın fonksiyon, dosya, girdi ya da ayar için önce oku ya da ara.
- Başka bir sistemi çağırmadan önce (iş akışı, API) onun tanımını oku. Bugün `siparis.yml`'in `hedef` girdisi okunmadığı için Komando'ya üretim başladı.
- Tahmin edilebilecek şeyler: kod stili, değişken adı önerisi, kolayca geri alınabilecek küçük kararlar. Tahmin ettiysen raporda söyle.

**7. Kök sebep analizi**
1. Belirtiyi kesin yaz.
2. Zinciri çiz (kullanıcı → uygulama → bulut → EVREN).
3. Her halkada iz ara (kayıt, zaman damgası, yazılan dosya).
4. İlk bozulan halkayı bul.
5. Düzeltmeyi o halkaya yap.

Örnek: "180 sn yanıt vermedi". Oturum kaydındaki zaman damgaları EVREN'in 35 adımı yavaş ama başarıyla attığını gösterdi. Takılma, uzun dosya yazımındaydı. 180 sn ise bizim koyduğumuz toplam süre sınırıydı. Kök sebep model değil, akış (stream) kullanılmayan istekti.
- *Hata metninde bizim sabitimiz geçiyorsa* (180 sn), önce kendi kodumuzdan şüphelen.
- *Bağlantı hiç kurulmuyorsa* ağdır.
- *Bağlantı açık ama veri gelmiyorsa* sunucudur.

**8. Ne zaman durup sormalı?**
Kural: **maliyet × geri alınamazlık × başkasını etkileme**. Bunlardan biri yüksekse sor.
- *Hep sor:* para harcayan iş akışları (GPU üretimi, yayın), aktif repo dışında başlatılan iş akışları, ana dala yazma, silme, birleştirme.
- *Sorma:* dal açma, dalda commit, dosya okuma.

Asistan'da bu, araç katmanında kod olarak duruyor; modelin iyi niyetine bırakılmıyor. Pahalı işlem "otomatik izin" açıkken bile sorulur, gece görevlerinde hiç yapılmaz.

**9. Aynı hata döngüsünden çıkış**
- Aynı çağrı ile aynı hata ikinci kez gelirse uyar.
- Kontrol 3 kez kırılırsa yaklaşım değiştir, `danis` kullan.
- Hâlâ olmuyorsa devret ya da kullanıcıya sor.
- Ayrıca adım sınırı ve görev süresi sınırı koy.

---

## C) Bağlam ve hafıza

**10. Bağlam yönetimi**
- *Kısaltılabilir:* eski araç sonuçları (dosya içerikleri yeniden okunabilir), büyük argümanlar (yazılmış dosya içeriği), repo haritası.
- *Asla atılmamalı:* sistem kuralları, kullanıcının isteği, plan durumu, açılan dal adı, son hata, son birkaç adım.

Asistan sınırı 35 bin karakter. Aynı dosyanın değişmemiş halini ikinci kez göndermez, yerine kısa bir not koyar.

**11. "Devam et" için taşınacaklar**
Plan (hangi madde bitti), son ~40 adımın tek satırlık özeti (araç + argüman + sonucun başı), açılan dal, yazılan dosyalar, son hata ve "baştan başlama" talimatı. Dosya içerikleri taşınmaz; gerekirse yeniden okunur.

**12. Ağırlık değişmeden öğrenme**
- *Ders dosyası:* ucuz, okunur, düzenlenebilir. Ama yanlış ders yayılır ve dosya büyüyünce gürültü olur. Seçerek (ilgili dersler) vermek gerekir.
- *Repo kuralları (AGENTS.md):* projeye özel, kalıcı, insan yazar; en güvenilir kaynaktır.
- *Örnek havuzu (iyi çözülmüş görevler):* zayıf modelde çok etkilidir ama bağlamı doldurur.

Öneri: kurallar AGENTS.md'de, dersler etiketli ve sınırlı sayıda, örnekler yalnızca benzer görevde.

**13. İyi ders**
Tek cümle, genel, eyleme dönük, nedenli: "Workflow başlatmadan önce dosyasını okuyup girdilerini ver; varsayılan başka repoyu hedefleyebilir."
- *Kötü ders:* "Bugün siparis.yml'i düzelttim."
- *Ne zaman eklenir:* bir hata ya da kullanıcı düzeltmesinden sonra.
- *Ne zaman birleştirilir:* 60 dersi geçince.
- *Zararı sınırlamak:* tarih ve etiket koy, kullanıcı 📚 panelinden görüp silebilsin, çelişen yeni bilgi eskisinin yerine geçsin.

---

## D) Araç tasarımı

**14. Araç açıklaması neden önemli?**
Model aracı yalnızca adından, açıklamasından ve parametrelerinden tanır.
- *Kötü:* `actions_baslat: workflow başlatır {repo, workflow}`. Girdi verilemiyor, model varsayılanın tehlikesini bilmiyor.
- *İyi:* `actions_baslat: ... Workflow girdi alıyorsa hepsini girdiler ile ver: varsayılanlar başka bir repoyu hedefliyor olabilir. {repo, workflow, dal, girdiler, varsayilan_tamam}`

Açıklama ne zaman kullanılacağını, ne zaman kullanılmayacağını ve tuzakları söylemeli.

**15. Korkuluklar**
Model hatasını araç yakalamalı:
- sözdizimi hatalı kodu commit etmeme,
- kısaltılmış (`…`) dosya yazmayı reddetme,
- `eski` metin dosyada birden çok geçiyorsa reddetme,
- girdisiz pahalı iş akışını başlatmama,
- doğrulanmadan "bitti" dememe.

Reddederken *ne yapması gerektiğini* de söylemeli.

**16. Araç sonuçlarının biçimi**
Kısa, başında özet ("❌ 2 kontrol başarısız"), sonra ayrıntı, sınırlı uzunluk (Asistan'da 10 bin karakter). Fazlası için "başlangıç/bitiş ile parça parça oku" yönlendirmesi. Satır numaralı dosya içeriği düzenlemeyi kolaylaştırır.

---

## E) Doğrulama ve dürüstlük

**17. İşin çalıştığının kanıtı**
- *Sözdizimi/JSON kontrolü:* her yazımda (en ucuz).
- *CI build:* her değişiklik grubunda.
- *Duman testi (oyunu başlatıp betik hatası var mı):* oyun kodunda.
- *Ekran görüntüsü ya da üretilen görsel:* görünüşle ilgili işlerde.

Görünüş işinde build geçmesi kanıt değildir. Bugünkü sipariş tarifleri JSON olarak geçerliydi ama görseller üretilmeden "gerçekçi" denemezdi.

**18. "Test edemedim" nasıl söylenir?**
Ne test edildi, ne edilmedi, neden edilmedi, kullanıcı nasıl test eder: tek cümlede. "Build geçti; oyunda denemedim, karakter kartında görünüşe bakmalısın."

**19. Gözden geçiren model**
- *Faydalı:* büyük ya da çok dosyalı değişiklikte, mantık değişikliğinde, zayıf uygulayıcı modelde.
- *Yalnızca yavaşlatır:* birkaç satırlık değişiklikte, metin/JSON düzenlemesinde. Asistan 12 satırın altını gözden geçirmez.

---

## F) Sonuç gösterme ve iletişim

**20. Telefon raporu**
Sıra:
1. Sonuç (bitti mi?),
2. ne değişti,
3. nerede (link),
4. nasıl test edildi,
5. senden ne gerekiyor.

Atlanacaklar: adım adım ne yapıldığı, okunan dosyalar, iç ayrıntılar. 2–6 kısa satır.

**21. Kullanıcıya adım verirken**
Numaralı, her adımda tek eylem, doğrudan link, kutuya ne yazılacağı aynen. Riskli adımın (para harcar, geri alınamaz) önünde uyarı. Sonunda "takılırsan ekran görüntüsü at".

**22. İlerleme bilgisi**
Uzun işte sessizlik "takıldı mı?" kaygısı yaratır. Plan listesi, "yazıyor… 4 bin karakter" ve süre notları güveni artırır, yanlış alarmı (gereksiz durdurmayı) azaltır. Bugün "0 karakter" görmek bile "bağlantı açık, model işliyor" diye okunabildi.

---

## G) Hız ve maliyet

**23. Yavaş sağlayıcıyla hızlanma (etki sırasıyla)**
1. *Daha az tur:* birden çok dosyayı tek turda okumak. Her tur EVREN'de ~40 sn.
2. *Düşünmeyi basit adımlarda kapatmak.*
3. *Bağlamı küçültmek.*
4. *Gereksiz yan istekleri kaldırmak:* küçük işte plan ya da gözden geçirme yok.
5. *Akış (stream):* hızlandırmaz, ama uzun yazımın yarıda kesilip baştan başlamasını önler.

**24. Küçük ve büyük model**
- *Küçük/hızlı:* dosya okuma kararları, küçük düzeltme, ders çıkarma, özetleme.
- *Büyük/düşünen:* plan, mimari karar, üç kez kırılan hatanın çözümü.

EVREN'de şimdilik `deepseek-v4.1-flash` uygulayıcı; düşünme yalnızca planlayıcıda açık.

**25. Ölçülecekler**
Görev başına toplam süre, model süresi ve istek sayısı, adım sayısı, araç sayısı, sonuç (bitti/hata/durduruldu), tekrar okunan dosya sayısı, kırılan kontrol sayısı. Nasıl kullanılır:
- ortalama model süresi yüksekse bağlamı küçült,
- adım sayısı yüksekse okumaları paralelleştir ya da planı iyileştir,
- hata oranı yüksekse o hata türüne korkuluk ekle.

Asistan bunları `asistan-hafiza/metrikler/` altına yazar.

---

## Asistan için 10 değişiklik (öncelik sırasıyla)

| # | Değişiklik | Neden | Durum |
|---|---|---|---|
| 1 | Akışla (stream) yanıt, susunca kes | Uzun yazım yarıda kesilip baştan başlıyordu | ✅ |
| 2 | "Devam et"te plan + adım özeti taşınır | Her seferinde baştan başlıyordu | ✅ |
| 3 | Birden çok okuma tek turda ve paralel | Her tur ~40 sn; en büyük hız kazancı | ✅ |
| 4 | Değişmemiş dosyayı tekrar göndermeme | Bağlam şişmesi ve tekrar okuma döngüsü | ✅ |
| 5 | Pahalı/dış repo iş akışında zorunlu onay, gece yasak | Komando'ya yanlışlıkla GPU üretimi | ✅ |
| 6 | Workflow girdilerini okuyup isteme | Aynı olayın kök sebebi | ✅ |
| 7 | Yazdıysa doğrulamadan bitirmeme | "Bitti" deyip test etmeme | ✅ |
| 8 | Rapor şablonu + eksik kalanı söyleme kuralı | PR raporunda 4 karakter atlanmıştı | ✅ |
| 9 | Basit adımlarda düşünme kapalı, küçük işte plan/gözden geçirme yok | Adım başına dakikalar | ✅ |
| 10 | Görev metrikleri kaydı | Neyin yavaş/hatalı olduğunu ölçmek | ✅ |
