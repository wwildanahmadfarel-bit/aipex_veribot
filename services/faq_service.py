import os
from supabase import create_client
from google import genai
from google.genai import types

raw_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or ""
clean_url = raw_url.strip().rstrip("/").removesuffix("/rest/v1").rstrip("/")
supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or ""
supabase = create_client(clean_url, supabase_key) if clean_url and supabase_key else None
gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

def get_faq_response(user_message: str) -> str:
    # 1. Ambil data FAQ resmi dari Supabase DB
    response = supabase.table("faq_knowledge_base").select("*").eq("is_active", True).execute()
    faqs = response.data or []

    # 2. Format konteks pengetahuan untuk AI
    context = ""
    for item in faqs:
        context += f"- [{item['kategori']}] {item['pertanyaan']}: {item['jawaban_resmi']}\n"

    system_prompt = f"""
    Anda adalah VeriBot AI, asisten resmi Kelurahan Sukamaju.
    Jawab pertanyaan warga HANYA berdasarkan basis data resmi berikut:
    {context}
    
    ATURAN:
    - Jawab dengan ramah, singkat (2-3 kalimat), dan presisi.
    - Jika pertanyaan TIDAK ADA di data di atas, katakan dengan sopan bahwa informasi belum tersedia dan sarankan bertanya langsung ke loket.
    """

    # 3. Panggil Gemini 3.6 Flash
    res = gemini_client.models.generate_content(
        model="gemini-3.6-flash",
        contents=user_message,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.2
        )
    )
    return res.text
