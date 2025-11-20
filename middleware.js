import { NextResponse } from 'next/server';

export function middleware(request) {
  // Dozvoli pristup samo index.html-u
  const url = request.nextUrl.clone();
  
  // Blokiraj direktan pristup drugim HTML fajlovima
  if (url.pathname.includes('/page2.html') || url.pathname.includes('/page3.html')) {
    // Proveri da li dolazi sa validnog referera
    const referer = request.headers.get('referer');
    
    if (!referer || !referer.includes(request.headers.get('host'))) {
      return new NextResponse('Access Denied', { status: 403 });
    }
  }
  
  return NextResponse.next();
}
