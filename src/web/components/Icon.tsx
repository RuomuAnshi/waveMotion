import React from 'react';

const paths = {
  wave: 'M2 12h3l2-7 4 14 3-16 3 13 2-4h3',
  play: 'm9 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  start: 'M5 5v14M19 5 8 12l11 7Z',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  music: 'M9 18V5l11-2v13M9 8l11-2M9 18c0 4-7 4-7 1s7-4 7-1Zm11-2c0 4-7 4-7 1s7-4 7-1Z',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  sliders: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  chevron: 'm9 5 7 7-7 7',
} as const;
export const Icon = ({name, size = 16}: {name: keyof typeof paths; size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
);
