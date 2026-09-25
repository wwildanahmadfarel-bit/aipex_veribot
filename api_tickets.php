<?php
// DEPRECATED — jalur aktif: PATCH /api/admin/tickets (api/admin/tickets.ts + api/_lib/wa.ts via Fonnte).
// File ini hanya referensi template pesan + rewrite legacy (vercel.json: /api_tickets.php -> /api/admin/tickets).
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS");
header("Content-Type: application/json");

// Handle Preflight OPTIONS Request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Koneksi ke Database MariaDB / MySQL
$host = "localhost";
$user = "root";
$pass = "";
$db   = "db_veribot"; // Sesuaikan nama database Anda

$conn = new mysqli($host, $user, $pass, $db);
if ($conn->connect_error) {
    die(json_encode(["success" => false, "message" => "Koneksi database gagal: " . $conn->connect_error]));
}

$method = $_SERVER['REQUEST_METHOD'];

// HANDLING REQUEST GET (AMBIL DAFTAR TIKET)
if ($method === 'GET') {
    $query = "SELECT * FROM tb_tiket ORDER BY id DESC";
    $result = $conn->query($query);
    
    $tickets = [];
    if ($result) {
        while ($row = $result->fetch_assoc()) {
            $tickets[] = $row;
        }
    }
    
    echo json_encode([
        "success" => true,
        "data" => $tickets
    ]);
    exit;
}

// HANDLING REQUEST PATCH / POST (UPDATE STATUS & KIRIM NOTIFIKASI)
if ($method === 'PATCH' || $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);

    $ticketId = $input['ticketId'] ?? null;
    $officerId = $input['officerId'] ?? null;
    $status = $input['status'] ?? null;      // 'DISETUJUI', 'DITOLAK', 'PERLU_PERBAIKAN'
    $noHpPemohon = $input['no_hp'] ?? null;  // Nomor HP pemohon
    $namaPemohon = $input['nama'] ?? 'Pemohon';
    $jenisDokumen = $input['jenis_dokumen'] ?? 'Dokumen';
    $kodeTiket = $input['kode_tiket'] ?? '';
    $catatanPetugas = $input['catatan'] ?? '';

    if (!$ticketId || !$status) {
        echo json_encode(["success" => false, "message" => "Data tidak lengkap"]);
        exit;
    }

    // 1. AMBIL PROFIL KELURAHAN DARI DATABASE (tb_pengaturan)
    $queryConfig = $conn->query("SELECT * FROM tb_pengaturan WHERE id = 1 LIMIT 1");
    $config = ($queryConfig && $queryConfig->num_rows > 0) ? $queryConfig->fetch_assoc() : null;

    $namaKelurahan = $config['nama_kelurahan'] ?? 'Kelurahan Sukamaju';
    $noKelurahan   = $config['no_whatsapp_kelurahan'] ?? '0812-3456-7890';
    $jamOperasional = $config['jam_operasional'] ?? '08.00 - 15.00 WIB';

    // 2. UPDATE STATUS TIKET DIBERIKAN OLEH PETUGAS
    $stmt = $conn->prepare("UPDATE tb_tiket SET status_verifikasi = ?, officer_id = ?, catatan = ? WHERE id = ?");
    if ($stmt) {
        $stmt->bind_param("sssi", $status, $officerId, $catatanPetugas, $ticketId);
        $stmt->execute();
        $stmt->close();
    }

    // 3. SUSUN TEMPLATE PESAN NOTIFIKASI DENGAN KONTAK KELURAHAN DARI DATABASE
    if ($status === 'DISETUJUI') {
        $pesanWA = "Halo Sdr/i *{$namaPemohon}*,\n\n"
                 . "Dokumen *{$jenisDokumen}* (Kode Tiket: *{$kodeTiket}*) Anda telah *VALID & DISETUJUI* oleh petugas *{$namaKelurahan}*.\n\n"
                 . "Silakan bisa langsung datang ke Kantor Kelurahan pada jam operasional ({$jamOperasional}).\n\n"
                 . "Jika ada pertanyaan, silakan hubungi kontak layanan kelurahan kami di: *{$noKelurahan}*.\n\nTerima kasih.";
    } elseif ($status === 'DITOLAK') {
        $pesanWA = "Halo Sdr/i *{$namaPemohon}*,\n\n"
                 . "Mohon maaf, dokumen *{$jenisDokumen}* (Kode Tiket: *{$kodeTiket}*) Anda *DITOLAK*.\n\n"
                 . "*Catatan Petugas:* {$catatanPetugas}\n\n"
                 . "Untuk informasi lebih lanjut, hubungi layanan *{$namaKelurahan}* di: *{$noKelurahan}*.";
    } else { // PERLU_PERBAIKAN
        $pesanWA = "Halo Sdr/i *{$namaPemohon}*,\n\n"
                 . "Dokumen *{$jenisDokumen}* (Kode Tiket: *{$kodeTiket}*) Anda *PERLU PERBAIKAN*.\n\n"
                 . "*Catatan Petugas:* {$catatanPetugas}\n\n"
                 . "Mohon unggah ulang foto dokumen yang lebih jelas. Layanan Bantuan: *{$noKelurahan}*.";
    }

    // 4. KIRIM NOTIFIKASI VIA WHATSAPP API GATEWAY (CONTOH: WHACENTER)
    if (!empty($noHpPemohon)) {
        kirimWhatsApp($noHpPemohon, $pesanWA);
    }

    echo json_encode([
        "success" => true, 
        "message" => "Status berhasil diperbarui dan notifikasi WhatsApp terkirim!"
    ]);
}

// HELPER FUNGSI KIRIM WHATSAPP GATEWAY
function kirimWhatsApp($target, $pesan) {
    $deviceId = 'ISI_DEVICE_ID_WHACENTER_ANDA'; // Ganti Device ID API Anda
    
    $curl = curl_init();
    curl_setopt_array($curl, array(
      CURLOPT_URL => 'https://whacenter.com/api/send',
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_POST => true,
      CURLOPT_POSTFIELDS => array(
        'device_id' => $deviceId,
        'number' => $target,
        'message' => $pesan
      ),
    ));
    $response = curl_exec($curl);
    curl_close($curl);
    return $response;
}
?>
