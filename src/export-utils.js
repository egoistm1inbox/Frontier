import JSZip from 'jszip';

export function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  } else {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      textArea.remove();
      return Promise.resolve();
    } catch (err) {
      textArea.remove();
      return Promise.reject(err);
    }
  }
}

export function downloadSvgFile(svgContent, filename) {
  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadPngFromSvg(svgContent, filename, size = 1024) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Canvas toBlob failed'));
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(pngUrl);
        resolve();
      }, 'image/png');
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };

    img.src = url;
  });
}

export function generateReactComponent(icon, is3D = true) {
  const componentName = icon.name.replace(/[^a-zA-Z0-9]/g, '') + 'Icon';
  const svg = is3D ? icon.svg3d : icon.svg2d;
  return `import React from 'react';

/**
 * ${icon.name} - ${icon.category}
 * ${icon.description}
 */
export function ${componentName}({ size = ${is3D ? 48 : 24}, className = '', ...props }) {
  return (
    <span 
      className={\`inline-block \${className}\`} 
      style={{ width: size, height: size }}
      {...props}
      dangerouslySetInnerHTML={{
        __html: \`${svg.replace(/`/g, '\\`')}\`
      }}
    />
  );
}

export default ${componentName};
`;
}

export function generateVueComponent(icon, is3D = true) {
  const svg = is3D ? icon.svg3d : icon.svg2d;
  return `<template>
  <span :class="['inline-block', className]" :style="{ width: size + 'px', height: size + 'px' }" v-html="svgCode" />
</template>

<script setup>
/**
 * ${icon.name} - ${icon.category}
 * ${icon.description}
 */
defineProps({
  size: {
    type: Number,
    default: ${is3D ? 48 : 24}
  },
  className: {
    type: String,
    default: ''
  }
});

const svgCode = \`${svg.replace(/`/g, '\\`')}\`;
</script>
`;
}

export async function downloadAllIconsZip(icons, mode = 'both') {
  const zip = new JSZip();

  // Create subfolders
  const folder3d = zip.folder('3d-claymorphic');
  const folder2d = zip.folder('2d-production');

  icons.forEach(icon => {
    if (mode === '3d' || mode === 'both') {
      folder3d.file(`${icon.id}.svg`, icon.svg3d);
    }
    if (mode === '2d' || mode === 'both') {
      folder2d.file(`${icon.id}.svg`, icon.svg2d);
    }
  });

  // Include JSON manifest
  const manifest = icons.map(i => ({
    id: i.id,
    name: i.name,
    category: i.category,
    tags: i.tags,
    description: i.description,
    hotkeys: i.hotkeys
  }));
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // Generate README
  const readme = `# Frontier 3D DCC Icon Set
A full icon collection for UV Editor, Forcefields, Vector Fields, and 3D Modelling.
Crafted in 3D claymorphic matte style and clean 2D vector format.

Total Icons: ${icons.length}
- UV Editor: 16 icons
- Forcefields: 14 icons
- Vector Fields: 14 icons
- 3D Modelling: 18 icons
`;
  zip.file('README.md', readme);

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Frontier-DCC-Icon-Set-${mode}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadSpriteSheet(icons, is3D = true) {
  let symbols = '';
  icons.forEach(icon => {
    const rawSvg = is3D ? icon.svg3d : icon.svg2d;
    // Extract inner contents of SVG
    const inner = rawSvg.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '');
    const viewBox = is3D ? '0 0 128 128' : '0 0 24 24';
    symbols += `\n  <symbol id="${icon.id}" viewBox="${viewBox}">\n    ${inner}\n  </symbol>`;
  });

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display: none;">${symbols}\n</svg>`;
  downloadSvgFile(sprite, `frontier-icons-spritesheet-${is3D ? '3d' : '2d'}.svg`);
}
