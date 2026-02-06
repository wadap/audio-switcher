/**
 * Generates tray-icon-light.png and tray-icon-dark.png from the same SVG
 * design used in the app. Run: node scripts/generate-tray-icons.js
 */
const { writeFileSync } = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const size = 16;

function createSvg(iconColor) {
  return `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 5 L5 5 L8 2 L8 14 L5 11 L3 11 Z" fill="${iconColor}"/>
      <path d="M10 4.5 Q12.5 8 10 11.5" stroke="${iconColor}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M12 2.5 Q16 8 12 13.5" stroke="${iconColor}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    </svg>
  `;
}

const assetsDir = path.join(__dirname, '..', 'assets');

[
  { color: '#000000', file: 'tray-icon-light.png' },
  { color: '#ffffff', file: 'tray-icon-dark.png' }
].forEach(({ color, file }) => {
  const svg = createSvg(color);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  writeFileSync(path.join(assetsDir, file), pngBuffer);
  console.log('Written', file);
});

console.log('Done.');
