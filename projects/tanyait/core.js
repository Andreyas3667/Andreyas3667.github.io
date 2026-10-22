/* TanyaIT core: Indonesian text processing, TF-IDF retrieval over a helpdesk knowledge base,
   and multinomial Naive Bayes for ticket category + priority. Pure JS, runs in browser and Node. */
(function (root) {
  "use strict";

  const CATEGORIES = {
    network: "Jaringan & Internet", vpn: "VPN & Akses Cabang", email: "Email", printer: "Printer & Scanner",
    hardware: "Komputer & Hardware", account: "Akun & Password", nas: "Backup & File Server",
    phone: "Telepon Kantor (IP-PBX)", cctv: "CCTV", software: "Aplikasi & Software",
  };
  const PRIORITIES = { kritis: "Kritis", tinggi: "Tinggi", sedang: "Sedang", rendah: "Rendah" };
  const SLA = { kritis: "Respons 15 menit", tinggi: "Respons 1 jam", sedang: "Respons 4 jam", rendah: "Respons 1 hari kerja" };

  // ---------- text processing ----------
  const STOP = new Set(("yang dan di ke dari ini itu dengan untuk pada ada saya kami kita aku gue gw mas mbak pak bu bapak ibu " +
    "tolong mohon bantu bantuan minta please pls dong deh sih ya yah nih tuh kok kah lah juga sudah udah udh sdh lagi lg " +
    "jadi bisa sedang masih sangat banget bgt agak sejak tadi pagi siang sore malam hari kemarin kemaren mau akan atau " +
    "karena krn kalau kalo klo saat waktu setiap semua para the a an is to of in on it my not cant can").split(/\s+/));
  // keep "tidak" style negations as a token because they matter for symptoms
  const SYN = {
    lemot: "lambat", lelet: "lambat", lag: "lambat", slow: "lambat", ngelag: "lambat",
    inet: "internet", internetnya: "internet", koneksi: "internet", konek: "internet", connect: "internet", online: "internet",
    wifi: "wifi", wi: "wifi", hotspot: "wifi", ap: "wifi", lan: "kabel",
    gak: "tidak", ga: "tidak", nggak: "tidak", ngga: "tidak", engga: "tidak", enggak: "tidak", tdk: "tidak", gk: "tidak", gabisa: "tidak bisa", gbs: "tidak bisa",
    eror: "error", err: "error", errornya: "error", gagal: "error",
    pc: "komputer", laptop: "komputer", kompi: "komputer", cpu: "komputer", pcnya: "komputer", laptopnya: "komputer",
    ngeprint: "print", cetak: "print", mencetak: "print", nge: "", printernya: "printer", scan: "scanner", scanning: "scanner",
    pw: "password", pass: "password", sandi: "password", katasandi: "password", passwordnya: "password",
    surel: "email", mail: "email", outlook: "email", gmail: "email", emailnya: "email", inbox: "email",
    nas: "nas", truenas: "nas", server: "server", folder: "folder", shared: "sharing", share: "sharing", drive: "drive",
    telp: "telepon", telpon: "telepon", telfon: "telepon", ext: "extension", ekstensi: "extension", pabx: "pbx", ippbx: "pbx", yeastar: "pbx",
    kamera: "cctv", dvr: "nvr", rekaman: "rekam",
    mati: "mati", hang: "hang", ngehang: "hang", freeze: "hang", bluescreen: "bluescreen", bsod: "bluescreen",
    aplikasi: "aplikasi", app: "aplikasi", apk: "aplikasi", software: "aplikasi", program: "aplikasi",
    vpnnya: "vpn", wireguard: "vpn", ipsec: "vpn", cabang: "cabang",
    mikrotik: "router", router: "router", modem: "router", isp: "router",
  };
  function stem(w) {
    // light Indonesian stemmer: strip common particles/suffixes then prefixes; keep words >= 4 chars
    let s = w;
    s = s.replace(/(lah|kah|tah|pun|nya)$/, "");
    if (s.length > 6) s = s.replace(/(kan|an)$/, "");
    if (s.length > 6) s = s.replace(/^(meng|meny|mem|men|peng|peny|pem|pen|ter|ber)/, "");
    if (s.length > 6 && /^di[^aeiou]/.test(s) && !/^(direksi|diskon|display|digital|disk)/.test(s)) s = s.slice(2);
    return s.length >= 3 ? s : w;
  }
  function tokenize(text) {
    const raw = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    const out = [];
    for (let w of raw) {
      if (SYN[w] !== undefined) w = SYN[w];
      for (const part of w.split(" ")) {
        if (!part || STOP.has(part)) continue;
        if (/^\d+$/.test(part)) continue;
        out.push(part === "tidak" ? part : stem(part));
      }
    }
    // bigram "tidak X" captures negated symptoms ("tidak bisa", "tidak nyala")
    const bi = [];
    for (let i = 0; i < out.length - 1; i++) if (out[i] === "tidak") bi.push("tidak_" + out[i + 1]);
    return out.concat(bi);
  }

  // ---------- knowledge base ----------
  const KB = [
    { id: "net-01", cat: "network", title: "Internet lambat di satu komputer", tags: "internet lambat lemot satu komputer browser loading lama",
      steps: ["Bandingkan dengan komputer lain di ruangan yang sama. Jika hanya satu yang lambat, masalah ada di perangkat tersebut.", "Tutup aplikasi yang memakan bandwidth (update Windows, sinkronisasi cloud, streaming).", "Restart komputer, lalu jalankan speedtest dan catat hasilnya.", "Jika memakai Wi-Fi, coba kabel LAN untuk memastikan masalah bukan di sinyal."] },
    { id: "net-02", cat: "network", title: "Internet mati untuk seluruh kantor", tags: "internet mati semua kantor tidak ada koneksi down putus seluruh ruangan router modem isp",
      steps: ["Cek lampu modem/ONT ISP: lampu LOS merah berarti gangguan dari ISP, segera hubungi call center ISP.", "Login ke router MikroTik (Winbox), cek interface WAN aktif dan ping 8.8.8.8 dari router.", "Jika WAN normal tetapi klien tidak bisa browsing, cek DHCP server dan DNS di router.", "Aktifkan jalur cadangan (failover) jika tersedia dan informasikan ke seluruh pengguna."] },
    { id: "net-03", cat: "network", title: "Wi-Fi tidak muncul atau sering putus", tags: "wifi tidak muncul putus sinyal lemah access point ruijie hilang tersambung tidak ada internet",
      steps: ["Pastikan access point menyala (lampu indikator) dan kabel PoE terpasang.", "Cek status AP di Ruijie Cloud: online/offline dan jumlah klien.", "Lupakan jaringan (Forget network) di perangkat lalu sambungkan ulang.", "Jika sinyal lemah di area tertentu, catat lokasinya untuk evaluasi penempatan AP."] },
    { id: "net-04", cat: "network", title: "Komputer tersambung tetapi 'No internet access'", tags: "no internet access tersambung tanda seru ip dhcp 169 limited kabel lan",
      steps: ["Jalankan ipconfig; alamat 169.254.x.x berarti komputer tidak mendapat IP dari DHCP.", "Cabut-pasang kabel LAN atau pindah port switch.", "Jalankan ipconfig /release lalu ipconfig /renew.", "Jika masih gagal, cek DHCP lease pool di MikroTik apakah sudah penuh."] },
    { id: "vpn-01", cat: "vpn", title: "VPN ke kantor pusat tidak tersambung", tags: "vpn tidak tersambung wireguard handshake cabang kantor pusat akses server remote",
      steps: ["Pastikan internet lokal berjalan normal terlebih dahulu.", "Di aplikasi WireGuard, cek 'latest handshake'. Jika kosong, tunnel belum terbentuk.", "Nonaktifkan lalu aktifkan kembali tunnel; pastikan jam/tanggal komputer benar.", "Jika seluruh cabang terdampak, cek peer dan port WireGuard di router pusat."] },
    { id: "vpn-02", cat: "vpn", title: "Cabang tidak bisa mengakses server pusat (site-to-site)", tags: "cabang tidak bisa akses server pusat site to site ipsec tunnel down sistem tidak bisa dibuka cabang",
      steps: ["Ping gateway kantor pusat dari router cabang untuk memastikan tunnel aktif.", "Cek status IPsec/WireGuard peer di kedua router (phase 1/phase 2 atau handshake).", "Periksa apakah IP publik salah satu sisi berubah; perbarui konfigurasi peer bila perlu.", "Restart tunnel di luar jam sibuk dan catat waktu gangguan untuk laporan."] },
    { id: "mail-01", cat: "email", title: "Email tidak bisa mengirim (terjebak di Outbox)", tags: "email tidak bisa kirim outbox terkirim gagal smtp outlook lampiran besar",
      steps: ["Cek ukuran lampiran; batas umumnya 20–25 MB. Kirim file besar melalui link berbagi.", "Pastikan internet berjalan dan coba kirim email kecil tanpa lampiran.", "Di Outlook, cek pengaturan SMTP (server, port 465/587, autentikasi).", "Jika muncul pesan password, perbarui password akun email."] },
    { id: "mail-02", cat: "email", title: "Email tidak masuk atau kotak masuk penuh", tags: "email tidak masuk inbox penuh kuota mailbox full terima",
      steps: ["Cek folder Spam/Junk dan aturan (rules) yang memindahkan email.", "Periksa kuota mailbox; arsipkan atau hapus email lama berlampiran besar.", "Minta pengirim mengirim ulang dan catat pesan error yang mereka terima."] },
    { id: "mail-03", cat: "email", title: "Email mencurigakan / phishing", tags: "email mencurigakan phishing link aneh minta password hadiah transfer penipuan virus klik",
      steps: ["Jangan klik link atau membuka lampiran dari email tersebut.", "Teruskan email sebagai lampiran ke tim IT, lalu hapus.", "Jika sudah terlanjur memasukkan password, segera ganti password dan laporkan ke IT.", "IT akan memblokir domain pengirim dan memberi peringatan ke pengguna lain."] },
    { id: "prn-01", cat: "printer", title: "Printer tidak bisa mencetak / antrean macet", tags: "printer tidak bisa print antrean macet stuck pending dokumen tidak keluar",
      steps: ["Pastikan printer menyala, ada kertas, dan tidak ada lampu error.", "Buka antrean printer, batalkan semua dokumen, lalu restart layanan Print Spooler.", "Pastikan printer yang dipilih benar (bukan 'Copy' atau printer lama).", "Untuk printer jaringan, ping IP printer; jika tidak membalas, cek kabel atau Wi-Fi printer."] },
    { id: "prn-02", cat: "printer", title: "Kertas macet atau hasil cetak bergaris", tags: "kertas macet paper jam bergaris pudar tinta toner habis hasil cetak jelek",
      steps: ["Matikan printer, buka penutup, tarik kertas perlahan searah jalur kertas.", "Untuk hasil bergaris/pudar, jalankan head cleaning (inkjet) atau kocok toner (laser).", "Ganti tinta/toner jika indikator menunjukkan habis dan catat pemakaian."] },
    { id: "prn-03", cat: "printer", title: "Scanner tidak terdeteksi / hasil scan tidak masuk folder", tags: "scanner tidak terdeteksi scan folder email hasil tidak masuk smb",
      steps: ["Pastikan driver scanner terpasang dan kabel USB terhubung.", "Untuk scan-to-folder, cek folder tujuan masih ada dan izin sharing belum berubah.", "Jika password Windows pengguna baru diganti, perbarui kredensial di pengaturan scan printer."] },
    { id: "hw-01", cat: "hardware", title: "Komputer tidak mau menyala", tags: "komputer tidak mau nyala mati total power tombol tidak ada lampu listrik",
      steps: ["Cek kabel power, stop kontak, dan UPS. Coba stop kontak lain.", "Pastikan monitor juga menyala dan kabel video terpasang.", "Lepas semua perangkat USB, tekan tombol power 30 detik (laptop: lepas charger), lalu coba lagi.", "Jika tetap mati, bawa unit ke IT untuk cek power supply atau motherboard."] },
    { id: "hw-02", cat: "hardware", title: "Komputer sangat lambat atau sering hang", tags: "komputer lambat hang freeze lemot not responding penuh disk 100 ram",
      steps: ["Buka Task Manager, lihat CPU, RAM, dan Disk; catat aplikasi yang paling berat.", "Restart komputer (bukan sleep) dan biarkan Windows Update selesai.", "Pastikan sisa ruang disk C: lebih dari 15%; hapus file sementara.", "Jika disk selalu 100%, kemungkinan HDD perlu diganti SSD: ajukan ke IT."] },
    { id: "hw-03", cat: "hardware", title: "Blue screen (BSOD) / restart sendiri", tags: "bluescreen bsod restart sendiri layar biru error stop code crash",
      steps: ["Catat atau foto kode error di layar biru.", "Ingat perubahan terakhir (driver, perangkat baru, update).", "Jalankan pengecekan disk dan memori; IT dapat memeriksa log minidump.", "Simpan pekerjaan secara berkala sampai masalah selesai."] },
    { id: "hw-04", cat: "hardware", title: "Mouse, keyboard, atau monitor bermasalah", tags: "mouse keyboard monitor tidak berfungsi layar gelap tidak tampil usb",
      steps: ["Pindahkan ke port USB lain dan cek baterai (perangkat wireless).", "Untuk monitor, cek kabel HDMI/VGA dan tombol input source.", "Coba perangkat cadangan untuk memastikan kerusakan pada perangkat atau komputernya."] },
    { id: "acc-01", cat: "account", title: "Lupa password atau akun terkunci", tags: "lupa password akun terkunci locked tidak bisa login masuk windows salah password",
      steps: ["Akun terkunci otomatis setelah beberapa kali salah password; tunggu 15 menit atau hubungi IT.", "IT akan memverifikasi identitas lalu mereset password sementara.", "Segera ganti password sementara saat login pertama. Jangan bagikan password ke siapa pun."] },
    { id: "acc-02", cat: "account", title: "Permintaan akses folder atau aplikasi", tags: "minta akses folder aplikasi hak akses izin permission tidak punya akses user baru karyawan baru",
      steps: ["Ajukan permintaan dengan persetujuan atasan (nama folder/aplikasi dan level akses).", "IT memberi akses sesuai prinsip least privilege dan mencatatnya.", "Untuk karyawan baru, sertakan tanggal mulai agar akun disiapkan sebelumnya."] },
    { id: "nas-01", cat: "nas", title: "Folder bersama di server (NAS) tidak bisa dibuka", tags: "folder bersama sharing nas server tidak bisa dibuka drive hilang mapping network path not found",
      steps: ["Cek apakah komputer lain juga tidak bisa membuka folder. Jika semua gagal, laporkan sebagai gangguan server.", "Buka \\\\alamat-server melalui File Explorer untuk memastikan server bisa dijangkau.", "Jika drive mapping hilang, sambungkan ulang dengan kredensial yang benar.", "IT akan memeriksa status layanan SMB dan kesehatan pool di TrueNAS."] },
    { id: "nas-02", cat: "nas", title: "File terhapus atau tertimpa: pemulihan dari backup", tags: "file terhapus hilang tertimpa kehapus restore backup kembalikan versi lama snapshot",
      steps: ["Jangan menyimpan file baru dengan nama yang sama agar versi lama tidak tertimpa lagi.", "Laporkan nama file, lokasi folder, dan perkiraan waktu terakhir file masih benar.", "IT memulihkan dari snapshot TrueNAS sesuai jadwal backup (biasanya harian).", "Setelah dipulihkan, cek isi file dan konfirmasi ke IT."] },
    { id: "nas-03", cat: "nas", title: "File terenkripsi / dicurigai ransomware", tags: "file terenkripsi ransomware tidak bisa dibuka ekstensi aneh tebusan virus file berubah nama",
      steps: ["Cabut kabel LAN dan matikan Wi-Fi komputer tersebut segera. Jangan matikan komputer.", "Hubungi IT saat itu juga; ini insiden kritis.", "IT akan mengisolasi share yang terdampak dan memulihkan dari snapshot yang bersih.", "Jangan membayar tebusan atau membuka file tebusan."] },
    { id: "pbx-01", cat: "phone", title: "Telepon kantor tidak ada nada / tidak bisa menelepon", tags: "telepon kantor tidak ada nada tidak bisa telepon extension pbx yeastar ip phone mati",
      steps: ["Cek layar IP phone: status 'registered' atau 'unregistered'.", "Pastikan kabel LAN/PoE telepon terpasang dan lampu port menyala.", "Restart telepon; jika tetap unregistered, IT akan cek akun extension di Yeastar.", "Jika seluruh kantor tidak bisa menelepon keluar, cek trunk/SIP provider."] },
    { id: "pbx-02", cat: "phone", title: "Suara putus-putus atau satu arah", tags: "suara putus putus satu arah tidak terdengar echo telepon voip kualitas jelek",
      steps: ["Catat waktu dan nomor tujuan saat suara putus.", "Hindari download besar saat panggilan; IT dapat mengatur QoS untuk VoIP di MikroTik.", "Suara satu arah sering disebabkan NAT/SIP ALG; IT akan memeriksa pengaturan router."] },
    { id: "cctv-01", cat: "cctv", title: "Kamera CCTV offline atau rekaman tidak ada", tags: "cctv kamera offline tidak tampil rekaman tidak ada nvr hdd penuh no signal",
      steps: ["Cek di NVR kamera mana yang offline dan sejak kapan.", "Periksa adaptor/PoE dan kabel kamera tersebut.", "Jika rekaman kosong, cek status HDD di NVR (error/penuh) dan jadwal rekam.", "Untuk keperluan investigasi, segera ekspor rekaman sebelum tertimpa."] },
    { id: "sw-01", cat: "software", title: "Aplikasi error atau tidak mau terbuka", tags: "aplikasi error tidak mau terbuka force close crash not responding update gagal install",
      steps: ["Catat atau foto pesan error yang muncul.", "Tutup aplikasi sepenuhnya lalu buka kembali; restart komputer bila perlu.", "Cek apakah pengguna lain mengalami hal yang sama (masalah server vs. lokal).", "IT dapat memperbaiki instalasi atau membersihkan cache aplikasi."] },
    { id: "sw-02", cat: "software", title: "Permintaan instalasi software atau lisensi", tags: "install software minta pasang aplikasi lisensi baru microsoft office aktivasi expired",
      steps: ["Ajukan nama software, versi, dan alasan kebutuhan kerja beserta persetujuan atasan.", "IT hanya memasang software berlisensi resmi dari sumber tepercaya.", "Untuk Office yang meminta aktivasi, login ulang dengan akun kantor atau hubungi IT."] },
    { id: "sw-03", cat: "software", title: "Sistem ERP / aplikasi bisnis lambat atau tidak bisa login", tags: "sistem erp aplikasi bisnis lambat tidak bisa login server down semua user transaksi",
      steps: ["Pastikan masalah terjadi di lebih dari satu komputer.", "Coba akses dari jaringan lain untuk memisahkan masalah jaringan dan server.", "Jika seluruh pengguna terdampak, IT akan mengecek server aplikasi dan database serta menginformasikan estimasi pemulihan."] },
  ];

  // ---------- training tickets (text, category, priority) ----------
  const TRAIN = [
    ["internet di ruangan saya lemot banget dari pagi", "network", "sedang"],
    ["internet satu kantor mati total tidak ada yang bisa kerja", "network", "kritis"],
    ["semua komputer tidak bisa browsing, modem lampunya merah", "network", "kritis"],
    ["wifi lantai 2 sering putus putus", "network", "sedang"],
    ["wifi tidak muncul di laptop saya", "network", "sedang"],
    ["laptop konek wifi tapi no internet access", "network", "sedang"],
    ["pc saya tidak dapat ip, tanda seru kuning di jaringan", "network", "sedang"],
    ["internet lambat sekali saat meeting zoom", "network", "tinggi"],
    ["kabel lan di meja saya tidak ada koneksi", "network", "sedang"],
    ["bisa minta password wifi tamu untuk klien", "network", "rendah"],
    ["internet gudang down sejak jam 8, scanner barang tidak bisa sync", "network", "tinggi"],
    ["sinyal wifi di ruang meeting lemah", "network", "rendah"],
    ["vpn ke kantor pusat tidak bisa connect", "vpn", "tinggi"],
    ["cabang tidak bisa akses sistem pusat dari tadi pagi", "vpn", "kritis"],
    ["wireguard tidak ada handshake", "vpn", "tinggi"],
    ["kerja dari rumah tidak bisa masuk vpn kantor", "vpn", "sedang"],
    ["tunnel ipsec ke cabang palembang down", "vpn", "kritis"],
    ["koneksi vpn sering putus tiap 10 menit", "vpn", "sedang"],
    ["minta dibuatkan akun vpn untuk karyawan baru", "vpn", "rendah"],
    ["semua cabang tidak bisa input transaksi ke server pusat", "vpn", "kritis"],
    ["email saya tidak bisa kirim, nyangkut di outbox", "email", "sedang"],
    ["email dari customer tidak masuk ke inbox", "email", "tinggi"],
    ["inbox penuh tidak bisa terima email", "email", "sedang"],
    ["ada email aneh minta login ulang dan password", "email", "tinggi"],
    ["saya terlanjur klik link di email mencurigakan", "email", "kritis"],
    ["outlook minta password terus", "email", "sedang"],
    ["lampiran email terlalu besar tidak terkirim", "email", "rendah"],
    ["minta buat tanda tangan email baru", "email", "rendah"],
    ["email direksi tidak bisa kirim ke klien penting hari ini", "email", "tinggi"],
    ["printer tidak bisa print, dokumen pending terus", "printer", "sedang"],
    ["kertas macet di printer lantai 1", "printer", "rendah"],
    ["hasil print bergaris dan pudar", "printer", "rendah"],
    ["printer tidak terdeteksi di komputer saya", "printer", "sedang"],
    ["scanner tidak bisa scan ke folder", "printer", "sedang"],
    ["tinta printer habis minta diganti", "printer", "rendah"],
    ["printer kasir tidak bisa cetak struk, pelanggan antri", "printer", "tinggi"],
    ["semua printer di kantor tidak bisa cetak faktur", "printer", "tinggi"],
    ["komputer saya tidak mau nyala sama sekali", "hardware", "tinggi"],
    ["laptop sangat lemot dan sering hang", "hardware", "sedang"],
    ["pc bluescreen terus restart sendiri", "hardware", "tinggi"],
    ["mouse saya rusak tidak bisa klik", "hardware", "rendah"],
    ["monitor layar gelap tidak ada tampilan", "hardware", "sedang"],
    ["keyboard beberapa tombol tidak berfungsi", "hardware", "rendah"],
    ["laptop tidak bisa charge", "hardware", "sedang"],
    ["minta upgrade ram komputer karena lambat", "hardware", "rendah"],
    ["komputer kasir mati, transaksi berhenti", "hardware", "kritis"],
    ["lupa password windows tidak bisa login", "account", "tinggi"],
    ["akun saya terkunci setelah salah password", "account", "tinggi"],
    ["minta akses folder keuangan", "account", "rendah"],
    ["karyawan baru minggu depan butuh akun email dan komputer", "account", "rendah"],
    ["tidak bisa login ke aplikasi, password salah terus", "account", "sedang"],
    ["minta hapus akses karyawan yang resign", "account", "tinggi"],
    ["minta reset password akun sistem", "account", "sedang"],
    ["lupa password email kantor", "account", "sedang"],
    ["lupa pw tidak bisa masuk", "account", "tinggi"],
    ["password email expired harus diganti", "account", "sedang"],
    ["akun outlook terkunci", "account", "tinggi"],
    ["folder sharing di server tidak bisa dibuka", "nas", "tinggi"],
    ["drive Z hilang dari komputer saya", "nas", "sedang"],
    ["file laporan bulanan kehapus tolong dikembalikan", "nas", "tinggi"],
    ["file excel tertimpa versi lama, butuh versi kemarin", "nas", "sedang"],
    ["semua file di folder bersama berubah ekstensi dan tidak bisa dibuka", "nas", "kritis"],
    ["muncul file minta tebusan bitcoin di server", "nas", "kritis"],
    ["server file lambat sekali saat buka dokumen", "nas", "sedang"],
    ["minta dibuatkan folder baru di server untuk divisi gudang", "nas", "rendah"],
    ["network path not found saat buka folder bersama", "nas", "tinggi"],
    ["telepon meja saya tidak ada nada", "phone", "sedang"],
    ["semua telepon kantor tidak bisa telepon keluar", "phone", "kritis"],
    ["suara telepon putus putus", "phone", "sedang"],
    ["extension saya unregistered", "phone", "sedang"],
    ["minta tambah extension untuk ruang meeting", "phone", "rendah"],
    ["lawan bicara tidak dengar suara saya di telepon kantor", "phone", "sedang"],
    ["cctv gudang offline", "cctv", "tinggi"],
    ["rekaman cctv kemarin tidak ada", "cctv", "tinggi"],
    ["kamera cctv parkir tidak tampil di nvr", "cctv", "sedang"],
    ["minta ekspor rekaman cctv untuk investigasi kehilangan barang", "cctv", "tinggi"],
    ["hdd nvr penuh tidak merekam", "cctv", "tinggi"],
    ["gambar cctv buram di malam hari", "cctv", "rendah"],
    ["aplikasi tidak mau terbuka setelah update", "software", "sedang"],
    ["minta install adobe reader", "software", "rendah"],
    ["microsoft office minta aktivasi", "software", "sedang"],
    ["sistem erp tidak bisa login semua user", "software", "kritis"],
    ["aplikasi akuntansi error saat tutup buku", "software", "tinggi"],
    ["aplikasi sering not responding", "software", "sedang"],
    ["minta install software desain", "software", "rendah"],
    ["sistem penjualan lambat sekali semua cabang", "software", "kritis"],
    ["zoom tidak bisa share screen", "software", "rendah"],
    ["browser chrome crash terus", "software", "sedang"],
  ];

  // ---------- TF-IDF retrieval ----------
  function buildIndex(kb) {
    const docs = kb.map((a) => tokenize(`${a.title} ${a.title} ${a.tags} ${a.tags} ${a.steps.join(" ")}`));
    const df = {};
    docs.forEach((d) => new Set(d).forEach((t) => (df[t] = (df[t] || 0) + 1)));
    const N = docs.length, idf = {};
    Object.keys(df).forEach((t) => (idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1));
    const vecs = docs.map((d) => vectorize(d, idf));
    return { idf, vecs };
  }
  function vectorize(tokens, idf) {
    const tf = {};
    tokens.forEach((t) => { if (idf[t]) tf[t] = (tf[t] || 0) + 1; });
    let norm = 0; const v = {};
    Object.keys(tf).forEach((t) => { v[t] = (1 + Math.log(tf[t])) * idf[t]; norm += v[t] * v[t]; });
    norm = Math.sqrt(norm) || 1;
    Object.keys(v).forEach((t) => (v[t] /= norm));
    return v;
  }
  function search(index, kb, query, topN = 3) {
    const q = vectorize(tokenize(query), index.idf);
    return index.vecs.map((v, i) => {
      let s = 0; const hits = [];
      for (const t in q) if (v[t]) { s += q[t] * v[t]; hits.push(t); }
      return { article: kb[i], score: s, hits };
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, topN);
  }

  // ---------- Multinomial Naive Bayes ----------
  function trainNB(rows, labelIdx) {
    const classes = {}, vocab = new Set();
    rows.forEach((r) => {
      const y = r[labelIdx], toks = tokenize(r[0]);
      const c = classes[y] || (classes[y] = { docs: 0, words: {}, total: 0 });
      c.docs++;
      toks.forEach((t) => { c.words[t] = (c.words[t] || 0) + 1; c.total++; vocab.add(t); });
    });
    return { classes, vocab: vocab.size, n: rows.length };
  }
  function predictNB(model, text) {
    const toks = tokenize(text);
    const V = model.vocab + 1, scores = {};
    for (const y in model.classes) {
      const c = model.classes[y];
      let s = Math.log(c.docs / model.n);
      toks.forEach((t) => { s += Math.log(((c.words[t] || 0) + 1) / (c.total + V)); });
      scores[y] = s;
    }
    const mx = Math.max(...Object.values(scores));
    let z = 0; const prob = {};
    for (const y in scores) { prob[y] = Math.exp(scores[y] - mx); z += prob[y]; }
    for (const y in prob) prob[y] /= z;
    const label = Object.keys(prob).sort((a, b) => prob[b] - prob[a])[0];
    // evidence: tokens that most favour the winning class over the others
    const ev = [...new Set(toks)].map((t) => {
      const c = model.classes[label];
      const pw = ((c.words[t] || 0) + 1) / (c.total + V);
      let other = 0, k = 0;
      for (const y in model.classes) if (y !== label) { const o = model.classes[y]; other += ((o.words[t] || 0) + 1) / (o.total + V); k++; }
      return { token: t, weight: Math.log(pw / (other / Math.max(1, k))) };
    }).filter((e) => e.weight > 0.3).sort((a, b) => b.weight - a.weight).slice(0, 5);
    return { label, prob, evidence: ev };
  }
  function crossValidate(rows, labelIdx, folds = 5, seed = 7) {
    let a = seed >>> 0;
    const rand = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    const idx = rows.map((_, i) => i).sort(() => rand() - 0.5);
    let ok = 0;
    for (let f = 0; f < folds; f++) {
      const test = idx.filter((_, i) => i % folds === f), testSet = new Set(test);
      const model = trainNB(rows.filter((_, i) => !testSet.has(i)), labelIdx);
      test.forEach((i) => { if (predictNB(model, rows[i][0]).label === rows[i][labelIdx]) ok++; });
    }
    return ok / rows.length;
  }

  function draftReply(name, ticket, cat, prio, article) {
    const greet = name ? `Halo ${name},` : "Halo,";
    const lines = [greet, "", `Terima kasih, laporan Anda sudah kami terima dengan prioritas ${PRIORITIES[prio]} (${SLA[prio].toLowerCase()}).`];
    if (article) {
      lines.push("", `Dugaan awal: ${article.title.toLowerCase()}. Silakan coba langkah berikut:`);
      article.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    } else {
      lines.push("", "Kami belum menemukan panduan yang cocok. Tim IT akan menghubungi Anda untuk pengecekan langsung.");
    }
    if (prio === "kritis") lines.push("", "Karena berdampak besar, tim IT langsung menangani tiket ini sekarang. Anda tidak perlu menunggu langkah di atas selesai.");
    lines.push("", "Jika masalah belum teratasi, balas pesan ini dengan foto layar atau pesan error yang muncul.", "", "Salam,", "Tim IT Support");
    return lines.join("\n");
  }

  // ---------- combined triage ----------
  // Category: Naive Bayes blended with the category of the best-matching KB article.
  // Priority: Naive Bayes adjusted by explicit business-impact signals (scope, revenue, security).
  const IMPACT = [
    { re: /\b(semua|seluruh|satu kantor|semua cabang|seluruh cabang|semua user|semua orang|kantor pusat)\b/, w: 2, why: "berdampak ke banyak pengguna" },
    { re: /\b(kasir|transaksi|penjualan|pelanggan antri|customer|klien|faktur|tutup buku|direksi)\b/, w: 1, why: "mengganggu transaksi atau pelanggan" },
    { re: /\b(ransomware|tebusan|terenkripsi|terlanjur klik|phishing|virus|bitcoin)\b/, w: 3, why: "indikasi insiden keamanan" },
    { re: /\b(tidak bisa kerja|berhenti|down|mati total|tidak ada yang bisa)\b/, w: 1, why: "pekerjaan terhenti" },
    { re: /\b(minta|request|tambah|install|pasang|buatkan|dibuatkan|upgrade)\b/, w: -1, why: "permintaan layanan, bukan gangguan" },
  ];
  const PRIO_ORDER = ["rendah", "sedang", "tinggi", "kritis"];
  function triage(models, index, text) {
    const nbC = predictNB(models.cat, text), nbP = predictNB(models.prio, text);
    const hits = search(index, KB, text, 3);
    const catScore = {};
    for (const c in CATEGORIES) catScore[c] = 0.6 * (nbC.prob[c] || 0);
    if (hits.length) { const top = hits[0].score; hits.forEach((h) => { catScore[h.article.cat] += 0.4 * (h.score / top) * Math.min(1, top / 0.25); }); }
    const cat = Object.keys(catScore).sort((a, b) => catScore[b] - catScore[a])[0];
    const low = String(text).toLowerCase();
    const reasons = []; let impact = 0;
    IMPACT.forEach((r) => { if (r.re.test(low)) { impact += r.w; reasons.push(r.why); } });
    const expected = PRIO_ORDER.reduce((s, p, i) => s + i * (nbP.prob[p] || 0), 0);
    const lvl = Math.max(0, Math.min(3, Math.round(expected + impact * 0.75)));
    return { category: cat, catConfidence: catScore[cat] / Object.values(catScore).reduce((a, b) => a + b, 0), priority: PRIO_ORDER[lvl], nbCategory: nbC, nbPriority: nbP, impactReasons: reasons, articles: hits };
  }
  function evaluateTriage(rows, folds = 5) {
    const idxKB = buildIndex(KB);
    let a = 11 >>> 0; const rand = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    const order = rows.map((_, i) => i).sort(() => rand() - 0.5);
    let okC = 0, okP = 0, nearP = 0;
    for (let f = 0; f < folds; f++) {
      const test = new Set(order.filter((_, i) => i % folds === f));
      const train = rows.filter((_, i) => !test.has(i));
      const m = { cat: trainNB(train, 1), prio: trainNB(train, 2) };
      test.forEach((i) => {
        const r = triage(m, idxKB, rows[i][0]);
        if (r.category === rows[i][1]) okC++;
        if (r.priority === rows[i][2]) okP++;
        if (Math.abs(PRIO_ORDER.indexOf(r.priority) - PRIO_ORDER.indexOf(rows[i][2])) <= 1) nearP++;
      });
    }
    return { category: okC / rows.length, priority: okP / rows.length, priorityWithinOne: nearP / rows.length };
  }

  const api = { triage, evaluateTriage, PRIO_ORDER, CATEGORIES, PRIORITIES, SLA, KB, TRAIN, tokenize, buildIndex, search, trainNB, predictNB, crossValidate, draftReply };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TanyaCore = api;
})(typeof window !== "undefined" ? window : globalThis);
