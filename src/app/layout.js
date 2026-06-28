
import "./globals.css";

export const metadata = {
  title: "SSH Monitor — Terminal & Server Management",
  description: "A modern SSH terminal manager with real-time server monitoring, key management, and multi-session support.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SSH Monitor",
  },
};

export const viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

import { Providers } from '@/components/Providers';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var ua=navigator.userAgent||'';
            var isMobile=/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
            if(isMobile){
              var m=document.querySelector('meta[name="viewport"]');
              var v='width=1024,minimum-scale=0.1,maximum-scale=10,user-scalable=yes';
              if(m){m.setAttribute('content',v);}
              else{
                m=document.createElement('meta');
                m.name='viewport';
                m.content=v;
                document.head.appendChild(m);
              }
              document.documentElement.style.overflowX='hidden';
              document.documentElement.style.minWidth='1024px';
            }
          })();
        `}} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Share+Tech+Mono&family=VT323&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased" style={{ touchAction: 'pan-y pinch-zoom' }}>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var startX=0,startY=0;
            document.addEventListener('touchstart',function(e){
              if(e.touches.length===1){
                startX=e.touches[0].clientX;
                startY=e.touches[0].clientY;
              }
            },{passive:true});
            document.addEventListener('touchmove',function(e){
              if(e.touches.length===1){
                var dx=e.touches[0].clientX-startX;
                var dy=e.touches[0].clientY-startY;
                if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>10){
                  var edge=25;
                  if(startX<edge||startX>window.innerWidth-edge){
                    e.preventDefault();
                  }
                }
              }
            },{passive:false});
          })();
        `}} />
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
