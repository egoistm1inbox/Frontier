import React from 'react';

// Colour icons from public/icons. Layer kinds and erosion types map onto these file names.
const FILES = {
  terrain: 'terrain',
  noise: 'noise',
  ridge: 'ridge',
  island: 'island',
  offset: 'offset',
  terrace: 'terrace',
  smooth: 'smooth',
  levels: 'levels',
  erosion: 'fluid',
  rain: 'weather-rain',
  fluid: 'fluid',
  scree: 'scree',
  wind: 'wind',
  satmap: 'satmap',
  forest: 'forest',
  clouds: 'clouds',
};

export default function Icon({ name, size = 24, className = '' }) {
  const file = FILES[name] ?? name;
  return (
    <img
      className={'lx-icon ' + className}
      src={`${import.meta.env.BASE_URL}icons/${file}.svg`}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}
