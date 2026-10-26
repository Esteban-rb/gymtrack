// GymTrack — profile avatar: the user's photo if they added one, otherwise one of a few
// small illustrations picked by a random seed saved on the profile.
import React from 'react';

const SCENES = [
  { bg: ['#FF8A5C', '#FF3B30'], art: (  // barbell
    <g fill="#fff"><rect x="8" y="30" width="48" height="4" rx="2" /><rect x="12" y="20" width="6" height="24" rx="2" /><rect x="46" y="20" width="6" height="24" rx="2" /><rect x="5" y="25" width="5" height="14" rx="2" /><rect x="54" y="25" width="5" height="14" rx="2" /></g>) },
  { bg: ['#6FD2FF', '#2A6FDB'], art: (  // mountain
    <g><path d="M4 50 24 20 36 36 44 26 60 50Z" fill="#fff" opacity="0.95" /><circle cx="46" cy="16" r="5" fill="#FFE08A" /></g>) },
  { bg: ['#BF5AF2', '#5E5CE6'], art: (  // bolt
    <path d="M36 8 18 36h12l-4 20 20-30H34z" fill="#fff" />) },
  { bg: ['#32D74B', '#1F8A5B'], art: (  // kettlebell
    <g fill="#fff"><path d="M22 26a10 10 0 0 1 20 0" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" /><circle cx="32" cy="40" r="14" /></g>) },
  { bg: ['#FFD60A', '#FF9F0A'], art: (  // flame
    <path d="M32 8c2 10 14 14 14 28a14 14 0 0 1-28 0c0-8 5-10 6-18 4 3 6 6 6 10 3-4 3-12 2-20z" fill="#fff" />) },
  { bg: ['#2AC0C8', '#0A84FF'], art: (  // heart pulse
    <path d="M6 34h14l5-12 8 24 6-16 4 4h15" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />) },
];

export function randomAvatarSeed() { return Math.floor(Math.random() * SCENES.length); }

export default function Avatar({ photo, seed = 0, size = 64 }) {
  const style = { width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'block', objectFit: 'cover' };
  if (photo) return <img src={photo} alt="" style={style} />;
  const scene = SCENES[Math.abs(seed | 0) % SCENES.length];
  const gid = 'av' + (Math.abs(seed | 0) % SCENES.length);
  return (
    <svg viewBox="0 0 64 64" style={style} aria-hidden="true">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={scene.bg[0]} /><stop offset="1" stopColor={scene.bg[1]} /></linearGradient></defs>
      <rect width="64" height="64" fill={`url(#${gid})`} />
      {scene.art}
    </svg>
  );
}

/** Downscale a picked image to a small square JPEG data URL so it stays light in IndexedDB/backups. */
export function resizePhoto(file, side = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const cv = document.createElement('canvas');
      cv.width = cv.height = side;
      cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, side, side);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}
