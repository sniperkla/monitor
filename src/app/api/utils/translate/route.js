import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export async function POST(req) {
  try {
    const { text, texts, targetLang, sourceLang = 'en' } = await req.json();

    if (!targetLang) {
      return NextResponse.json({ success: false, error: 'Missing targetLang' }, { status: 400 });
    }

    // Bulk translation (multiple texts)
    if (texts && Array.isArray(texts) && texts.length > 0) {
      const translations = await Promise.all(
        texts.map(async (item) => {
          try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(item.text)}`;
            const res = await fetch(url);
            const data = await res.json();
            
            if (data && data[0]) {
              const translated = data[0].map(part => part[0]).join('');
              return { key: item.key, translated, success: true };
            }
            return { key: item.key, translated: item.text, success: false };
          } catch (err) {
            return { key: item.key, translated: item.text, success: false, error: err.message };
          }
        })
      );
      
      return NextResponse.json({ success: true, translations });
    }

    // Single text translation (backward compatible)
    if (!text || !text.trim()) {
      return NextResponse.json({ success: false, error: 'Missing text' }, { status: 400 });
    }

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    
    const res = await fetch(url);
    const data = await res.json();

    if (data && data[0]) {
      const translated = data[0].map(item => item[0]).join('');
      return NextResponse.json({ success: true, translated });
    }

    return NextResponse.json({ success: false, error: 'Translation failed' }, { status: 500 });
  } catch (error) {
    logger.error('Translation API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
