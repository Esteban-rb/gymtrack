import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pngDimensions(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(0, 8)).toEqual(signature);
  expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('PWA icons', () => {
  it('provides valid PNG files for every configured manifest icon size', async () => {
    const viteConfig = await readFile(path.join(projectRoot, 'vite.config.js'), 'utf8');
    const configured = [...viteConfig.matchAll(/src:\s*'icons\/icon-(192|512)\.png',[\s\S]*?sizes:\s*'(192|512)x\2'/g)];
    expect(configured.length).toBeGreaterThanOrEqual(2);

    for (const match of configured) {
      const size = Number(match[1]);
      const file = path.join(projectRoot, 'public', 'icons', `icon-${size}.png`);
      const bytes = await readFile(file);
      expect(pngDimensions(bytes)).toEqual({ width: size, height: size });
    }
  });
});
