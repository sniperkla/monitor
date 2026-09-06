'use client';


/* The guest landing sits on the same desktop the app uses: the default
   wallpaper with a dimming overlay and a subtle scanline texture. */

const WALLPAPER = 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop';



export default function DesktopChrome() {
  return (
    <>
      {/* Wallpaper + dimming overlay */}
      <div className="fixed inset-0 z-0" aria-hidden="true">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('${WALLPAPER}')` }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(2,6,12,0.7) 0%, rgba(2,6,12,0.42) 38%, rgba(2,6,12,0.55) 72%, rgba(2,6,12,0.82) 100%)',
          }}
        />
        {/* Subtle scanline texture keeps the CRT/terminal identity */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 1px, transparent 1px 3px)',
          }}
        />
      </div>
    </>
  );
}
