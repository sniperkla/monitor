import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { text, targetLang, sourceLang = 'en' } = await req.json();

    if (!text || !targetLang) {
      return NextResponse.json({ success: false, error: 'Missing parameters' }, { status: 400 });
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
    console.error('Translation API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
