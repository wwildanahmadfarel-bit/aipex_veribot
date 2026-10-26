#!/usr/bin/env python3
"""Buat 6 foto dokumen sintetis untuk demo halaman /transparansi (batch demo-001).

PENTING:
- Gambar ini BUKAN data warga. Semua NIK = 0000000000000000 dan nama fiktif.
- Setiap gambar diberi watermark "DEMO - DATA SINTETIS".
- Jangan pernah memasukkan output ini ke batch ycwc-001.

Output default:
  eval/demo/private/P001.jpg .. P006.jpg
  eval/demo/labels.csv

Jalankan:
  python scripts/generate-demo-eval.py
  python scripts/generate-demo-eval.py --out-dir eval/demo/private --labels-csv eval/demo/labels.csv
"""
import argparse
import csv
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = REPO_ROOT / "eval" / "demo" / "private"
DEFAULT_LABELS_CSV = REPO_ROOT / "eval" / "demo" / "labels.csv"

W, H = 1200, 800
FAKE_NIK = "0000000000000000"
WATERMARK = "DEMO — DATA SINTETIS"
FONT_DIR = Path("C:/Windows/Fonts")

INK = (24, 32, 45)
MUTED = (88, 99, 112)
LINE = (45, 55, 70)
PAPER = (250, 249, 244)
BLUE = (30, 64, 175)
RED = (153, 27, 27)
GREEN = (22, 101, 52)


def load_font(size: int, bold: bool = False, mono: bool = False):
    if mono:
        names = ["consola.ttf", "cour.ttf", "arial.ttf"]
    elif bold:
        names = ["arialbd.ttf", "calibrib.ttf", "arial.ttf"]
    else:
        names = ["arial.ttf", "calibri.ttf"]
    for name in names:
        path = FONT_DIR / name
        if path.is_file():
            try:
                return ImageFont.truetype(str(path), size)
            except OSError:
                continue
    return ImageFont.load_default()


def new_page(seed: int) -> Image.Image:
    rng = random.Random(seed)
    img = Image.new("RGB", (W, H), PAPER)
    # Tekstur ringan supaya file > 20 KB (guard OCR) dan terlihat seperti foto.
    noise = Image.effect_noise((W, H), 20).convert("RGB")
    img = Image.blend(img, noise, 0.07)
    draw = ImageDraw.Draw(img)
    draw.rectangle([18, 18, W - 18, H - 18], outline=(120, 128, 138), width=3)
    # Bintik debu/kertas.
    for _ in range(90):
        x = rng.randint(25, W - 25)
        y = rng.randint(25, H - 25)
        c = rng.randint(200, 235)
        draw.point((x, y), fill=(c, c, c))
    return img


def draw_center(draw: ImageDraw.ImageDraw, text: str, y: int, font, fill=INK):
    box = draw.textbbox((0, 0), text, font=font)
    draw.text(((W - (box[2] - box[0])) / 2, y), text, font=font, fill=fill)


def draw_field(draw, x, y, label, value, label_font, value_font, width=520):
    draw.text((x, y), label, font=label_font, fill=MUTED)
    draw.text((x, y + 22), value, font=value_font, fill=INK)


def draw_photo_box(draw, x, y, w, h):
    draw.rectangle([x, y, x + w, y + h], fill=(225, 228, 232), outline=(120, 128, 138), width=3)
    cx, cy = x + w // 2, y + h // 3
    draw.ellipse([cx - 38, cy - 44, cx + 38, cy + 32], fill=(166, 172, 180))
    draw.ellipse([cx - 66, cy + 54, cx + 66, cy + 150], fill=(166, 172, 180))
    f = load_font(16, bold=True)
    draw_center_in_box(draw, "FOTO FIKTIF", x, y + h - 26, w, f, fill=(90, 96, 104))


def draw_center_in_box(draw, text, x, y, w, font, fill=INK):
    box = draw.textbbox((0, 0), text, font=font)
    draw.text((x + (w - (box[2] - box[0])) / 2, y), text, font=font, fill=fill)


def add_footer(draw, note=""):
    f = load_font(16, bold=True)
    draw.line([40, H - 72, W - 40, H - 72], fill=(150, 155, 165), width=2)
    draw.text((40, H - 60), "DOKUMEN DEMO - BUKAN DATA WARGA", font=f, fill=RED)
    draw.text((40, H - 38), f"NIK palsu: {FAKE_NIK} | Nama fiktif | {note}".rstrip(" |"), font=load_font(15), fill=MUTED)


def add_watermark(img: Image.Image) -> Image.Image:
    """Watermark diagonal yang tetap tajam walau dokumennya sengaja diburamkan."""
    diag = int((W**2 + H**2) ** 0.5) + 500
    layer = Image.new("RGBA", (diag, diag), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f = load_font(34, bold=True)
    for y in range(0, diag, 150):
        for x in range(-100, diag, 360):
            d.text((x, y), WATERMARK, font=f, fill=(190, 18, 18, 58))
    rotated = layer.rotate(24, expand=False)
    left = (diag - W) // 2
    top = (diag - H) // 2
    overlay = rotated.crop((left, top, left + W, top + H))
    out = Image.alpha_composite(img.convert("RGBA"), overlay)

    d = ImageDraw.Draw(out)
    d.rectangle([0, 0, W, 58], fill=(153, 27, 27, 245))
    d.text((28, 14), "DEMO — DATA SINTETIS", font=load_font(28, bold=True), fill=(255, 255, 255, 255))
    d.text(
        (W - 250, 20),
        "BUKAN FOTO WARGA",
        font=load_font(20, bold=True),
        fill=(255, 255, 255, 255),
    )
    return out.convert("RGB")


def doc_ktp(blurred: bool = False) -> Image.Image:
    img = new_page(101 if not blurred else 102)
    draw = ImageDraw.Draw(img)
    draw.rectangle([40, 40, W - 40, 150], fill=(245, 245, 245), outline=(90, 95, 105), width=3)
    draw_center(draw, "PROVINSI JAWA TENGAH", 58, load_font(28, bold=True))
    draw_center(draw, "KOTA CONTOH", 98, load_font(20))

    draw.text((48, 174), "KARTU TANDA PENDUDUK", font=load_font(38, bold=True), fill=INK)
    draw.text((W - 210, 184), "e-KTP", font=load_font(28, bold=True), fill=BLUE)

    draw.text((48, 238), "NIK", font=load_font(18), fill=MUTED)
    draw.text((48, 260), FAKE_NIK, font=load_font(34, bold=True, mono=True), fill=INK)

    label = load_font(18)
    value = load_font(24, bold=False)
    fields = [
        ("Nama", "CONTOH WARGA SATU" if not blurred else "CONTOH WARGA DUA"),
        ("Tempat/Tgl Lahir", "CONTOH, 01-01-1990"),
        ("Jenis Kelamin", "LAKI-LAKI"),
        ("Alamat", "JL. CONTOH NO. 1"),
        ("RT/RW", "001/002"),
        ("Kel/Desa", "KELURAHAN CONTOH"),
        ("Kecamatan", "KECAMATAN SINTETIS"),
        ("Agama", "CONTOH"),
        ("Status Perkawinan", "BELUM KAWIN"),
        ("Pekerjaan", "KARYAWAN CONTOH"),
    ]
    y = 320
    for i, (lab, val) in enumerate(fields):
        col = 0 if i < 5 else 1
        row = i if i < 5 else i - 5
        draw_field(draw, 48 + col * 500, y + row * 62, f"{lab}", val, label, value)

    draw_photo_box(draw, 900, 230, 220, 280)
    draw.text((900, 530), "Kewarganegaraan: INDONESIA", font=load_font(18), fill=INK)
    draw.text((900, 560), "Berlaku hingga: SEUMUR HIDUP", font=load_font(18), fill=INK)
    add_footer(draw, "KTP contoh untuk demo metrik")

    if blurred:
        img = img.filter(ImageFilter.GaussianBlur(radius=4.6))
        # Simulasi silau/flash supaya skor kejelasan turun.
        glare = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        g = ImageDraw.Draw(glare)
        g.polygon([(520, 0), (900, 0), (520, H), (140, H)], fill=(255, 255, 255, 70))
        img = Image.alpha_composite(img.convert("RGBA"), glare).convert("RGB")
    return add_watermark(img)


def doc_kk() -> Image.Image:
    img = new_page(201)
    draw = ImageDraw.Draw(img)
    draw.rectangle([40, 40, W - 40, 140], fill=(240, 244, 250), outline=(90, 95, 105), width=3)
    draw_center(draw, "KARTU KELUARGA", 54, load_font(34, bold=True), fill=BLUE)
    draw_center(draw, "KOTA CONTOH - KECAMATAN SINTETIS", 104, load_font(18), fill=MUTED)

    draw.text((48, 166), "No. KK", font=load_font(18), fill=MUTED)
    draw.text((150, 160), FAKE_NIK, font=load_font(28, bold=True, mono=True), fill=INK)
    draw.text((48, 204), "Nama Kepala Keluarga", font=load_font(18), fill=MUTED)
    draw.text((300, 198), "CONTOH KEPALA KELUARGA", font=load_font(26, bold=True), fill=INK)
    draw.text((48, 242), "Alamat", font=load_font(18), fill=MUTED)
    draw.text((150, 236), "JL. CONTOH NO. 1, RT 001 / RW 002, KELURAHAN CONTOH", font=load_font(20), fill=INK)

    # Tabel anggota keluarga.
    table_top = 288
    cols = [40, 90, 330, 560, 700, 900, 1150]
    row_h = 46
    headers = ["No", "Nama", "NIK", "Jenis Kelamin", "Tempat Lahir", "Tgl Lahir"]
    draw.rectangle([40, table_top, W - 40, table_top + row_h], fill=(226, 232, 240), outline=LINE, width=2)
    for i, h in enumerate(headers):
        draw.text((cols[i] + 6, table_top + 12), h, font=load_font(15, bold=True), fill=INK)
    rows = [
        ("1", "CONTOH KEPALA KELUARGA", FAKE_NIK, "LAKI-LAKI", "CONTOH", "01-01-1985"),
        ("2", "CONTOH ISTRI", FAKE_NIK, "PEREMPUAN", "CONTOH", "02-02-1988"),
        ("3", "CONTOH ANAK SATU", FAKE_NIK, "LAKI-LAKI", "CONTOH", "03-03-2012"),
        ("4", "CONTOH ANAK DUA", FAKE_NIK, "PEREMPUAN", "CONTOH", "04-04-2016"),
    ]
    for r, row in enumerate(rows):
        top = table_top + row_h * (r + 1)
        draw.rectangle([40, top, W - 40, top + row_h], outline=LINE, width=1)
        for i, cell in enumerate(row):
            draw.text((cols[i] + 6, top + 12), cell, font=load_font(14), fill=INK)
    draw.text(
        (40, table_top + row_h * 5 + 22),
        "Dokumen contoh. Seluruh nama dan NIK adalah fiktif.",
        font=load_font(17, bold=True),
        fill=RED,
    )
    add_footer(draw, "Kartu Keluarga contoh")
    return add_watermark(img)


def doc_akta_kematian() -> Image.Image:
    img = new_page(301)
    draw = ImageDraw.Draw(img)
    draw.rectangle([40, 40, W - 40, 128], fill=(244, 244, 244), outline=(90, 95, 105), width=3)
    draw_center(draw, "PEMERINTAH KOTA CONTOH", 52, load_font(24, bold=True))
    draw_center(draw, "DINAS KEPENDUDUKAN DAN PENCATATAN SIPIL", 88, load_font(19))

    draw_center(draw, "KUTIPAN AKTA KEMATIAN", 166, load_font(34, bold=True), fill=RED)
    draw_center(draw, "Nomor: 0000/2026", 214, load_font(20), fill=MUTED)

    label = load_font(18)
    value = load_font(24)
    fields = [
        ("Nama almarhum/almarhumah", "CONTOH ALMARHUM"),
        ("NIK", FAKE_NIK),
        ("Jenis Kelamin", "LAKI-LAKI"),
        ("Tempat/Tgl Lahir", "CONTOH, 01-01-1950"),
        ("Tanggal Kematian", "01-01-2026"),
        ("Tempat Kematian", "KOTA CONTOH"),
        ("Sebab Kematian", "CONTOH (DATA SINTETIS)"),
    ]
    y = 270
    for lab, val in fields:
        draw.text((60, y), lab, font=label, fill=MUTED)
        draw.text((430, y - 4), ":", font=value, fill=INK)
        draw.text((460, y - 4), val, font=value, fill=INK)
        y += 58

    draw.text((760, 590), "Pejabat Pencatatan Sipil", font=load_font(18), fill=MUTED)
    draw.text((760, 620), "CONTOH PEJABAT", font=load_font(22, bold=True), fill=INK)
    draw.rectangle([760, 660, 1010, 664], fill=LINE)
    add_footer(draw, "Akta kematian contoh")
    return add_watermark(img)


def doc_kia() -> Image.Image:
    img = new_page(401)
    draw = ImageDraw.Draw(img)
    draw.rectangle([40, 40, W - 40, 142], fill=(240, 249, 255), outline=(90, 95, 105), width=3)
    draw_center(draw, "KARTU IDENTITAS ANAK", 56, load_font(34, bold=True), fill=(3, 105, 161))
    draw_center(draw, "KOTA CONTOH - KECAMATAN SINTETIS", 106, load_font(18), fill=MUTED)

    draw.text((48, 174), "NIK", font=load_font(18), fill=MUTED)
    draw.text((48, 196), FAKE_NIK, font=load_font(32, bold=True, mono=True), fill=INK)
    draw.text((48, 250), "Nama", font=load_font(18), fill=MUTED)
    draw.text((48, 274), "CONTOH ANAK", font=load_font(30, bold=True), fill=INK)

    label = load_font(18)
    value = load_font(23)
    fields = [
        ("Tempat/Tgl Lahir", "CONTOH, 04-04-2016"),
        ("Jenis Kelamin", "PEREMPUAN"),
        ("Agama", "CONTOH"),
        ("Alamat", "JL. CONTOH NO. 1, RT 001 / RW 002"),
        ("Kel/Desa", "KELURAHAN CONTOH"),
        ("Kecamatan", "KECAMATAN SINTETIS"),
        ("Kewarganegaraan", "INDONESIA"),
        ("Berlaku hingga", "04-04-2031"),
    ]
    for i, (lab, val) in enumerate(fields):
        col = 0 if i < 4 else 1
        row = i if i < 4 else i - 4
        draw_field(draw, 48 + col * 520, 336 + row * 64, lab, val, label, value)

    draw_photo_box(draw, 920, 220, 200, 240)
    draw.text((48, 620), "Dokumen contoh untuk demo metrik - bukan identitas anak sungguhan.", font=load_font(18, bold=True), fill=RED)
    add_footer(draw, "KIA contoh")
    return add_watermark(img)


def doc_lainnya() -> Image.Image:
    img = new_page(501)
    draw = ImageDraw.Draw(img)
    draw.text((60, 56), "TOKO CONTOH", font=load_font(34, bold=True), fill=INK)
    draw.text((60, 100), "Jl. Contoh No. 9, Kota Contoh", font=load_font(19), fill=MUTED)
    draw.text((60, 128), "BUKAN DOKUMEN KEPENDUDUKAN", font=load_font(20, bold=True), fill=RED)
    draw.line([60, 168, W - 60, 168], fill=LINE, width=3)

    draw.text((60, 190), "STRUK PEMBAYARAN", font=load_font(28, bold=True), fill=INK)
    draw.text((60, 228), "No. 0000/DEMO", font=load_font(18), fill=MUTED)
    draw.text((60, 256), "Tanggal: 01-01-2026", font=load_font(18), fill=MUTED)

    items = [
        ("Kertas contoh", "2", "10.000"),
        ("Pena contoh", "1", "5.000"),
        ("Map contoh", "1", "7.000"),
    ]
    y = 320
    for name, qty, price in items:
        draw.text((60, y), name, font=load_font(22), fill=INK)
        draw.text((620, y), qty, font=load_font(22), fill=INK)
        draw.text((760, y), price, font=load_font(22), fill=INK)
        y += 48
    draw.line([60, y + 8, W - 60, y + 8], fill=LINE, width=2)
    draw.text((60, y + 26), "TOTAL", font=load_font(24, bold=True), fill=INK)
    draw.text((760, y + 26), "22.000", font=load_font(24, bold=True), fill=INK)
    draw.text((60, y + 96), "Terima kasih. Ini hanya gambar sintetis untuk demo.", font=load_font(18), fill=MUTED)
    add_footer(draw, "Struk contoh (bukan dokumen kependudukan)")
    return add_watermark(img)


DEMO_DOCS = [
    {
        "filename": "P001.jpg",
        "jenis_true": "KTP",
        "status_true": "BERHASIL",
        "lighting": "terang",
        "device": "hp-demo",
        "builder": lambda: doc_ktp(blurred=False),
        "note": "KTP terang",
    },
    {
        "filename": "P002.jpg",
        "jenis_true": "KTP",
        "status_true": "BURAM",
        "lighting": "redup-silau",
        "device": "hp-demo",
        "builder": lambda: doc_ktp(blurred=True),
        "note": "KTP buram",
    },
    {
        "filename": "P003.jpg",
        "jenis_true": "KK",
        "status_true": "BERHASIL",
        "lighting": "terang",
        "device": "hp-demo",
        "builder": doc_kk,
        "note": "Kartu Keluarga",
    },
    {
        "filename": "P004.jpg",
        "jenis_true": "AKTA_KEMATIAN",
        "status_true": "BERHASIL",
        "lighting": "terang",
        "device": "hp-demo",
        "builder": doc_akta_kematian,
        "note": "Akta kematian",
    },
    {
        "filename": "P005.jpg",
        "jenis_true": "KIA",
        "status_true": "BERHASIL",
        "lighting": "terang",
        "device": "hp-demo",
        "builder": doc_kia,
        "note": "Kartu Identitas Anak",
    },
    {
        "filename": "P006.jpg",
        "jenis_true": "LAINNYA",
        "status_true": "TIDAK_VALID",
        "lighting": "terang",
        "device": "hp-demo",
        "builder": doc_lainnya,
        "note": "Bukan dokumen kependudukan",
    },
]


def save_jpeg(img: Image.Image, path: Path) -> int:
    quality = 90
    img.save(path, "JPEG", quality=quality, optimize=True)
    size = path.stat().st_size
    # Guard OCR menolak file < 20 KB. Tambah grain dan naikkan kualitas bila perlu.
    attempt = 0
    while size < 32_000 and attempt < 3:
        attempt += 1
        noisy = Image.blend(img, Image.effect_noise((W, H), 45 + attempt * 20).convert("RGB"), 0.10)
        quality = min(96, quality + 2)
        noisy.save(path, "JPEG", quality=quality, optimize=True)
        size = path.stat().st_size
    return size


def main():
    parser = argparse.ArgumentParser(description="Buat 6 foto dokumen sintetis untuk demo evaluasi OCR.")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="folder output foto demo")
    parser.add_argument("--labels-csv", default=str(DEFAULT_LABELS_CSV), help="path labels.csv demo")
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    labels_csv = Path(args.labels_csv).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    labels_csv.parent.mkdir(parents=True, exist_ok=True)

    rows = []
    for spec in DEMO_DOCS:
        path = out_dir / spec["filename"]
        size = save_jpeg(spec["builder"](), path)
        if size < 20 * 1024:
            raise SystemExit(f"GAGAL: {path.name} hanya {size} byte (<20 KB, akan ditolak guard OCR).")
        rows.append(
            {
                "filename": spec["filename"],
                "jenis_true": spec["jenis_true"],
                "status_true": spec["status_true"],
                "lighting": spec["lighting"],
                "device": spec["device"],
                "relawan_id": "DEMO",
                "consent_ref": "SINTETIS",
            }
        )
        print(f"{spec['filename']}: {size / 1024:.1f} KB - {spec['jenis_true']}/{spec['status_true']} ({spec['note']})")

    with labels_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["filename", "jenis_true", "status_true", "lighting", "device", "relawan_id", "consent_ref"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n{len(rows)} gambar demo -> {out_dir}")
    print(f"label demo       -> {labels_csv}")
    print("Semua NIK palsu 0000000000000000, nama fiktif, watermark DEMO — DATA SINTETIS.")
    print("Jangan pernah memasukkan file ini ke batch ycwc-001.")


if __name__ == "__main__":
    main()
