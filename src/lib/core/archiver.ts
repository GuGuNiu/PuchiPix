

import AdmZip from 'adm-zip';

export interface CbzMetadata {
  title: string;
  protagonist?: string;
  tags?: string[];
  imageCount: number;
}

export interface CbzImageEntry {
  filename: string;
  data: Buffer;
}

function generateComicInfoXml(meta: CbzMetadata): string {
  const escapeXml = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const tags = meta.tags && meta.tags.length > 0
    ? `  <Tags>${escapeXml(meta.tags.join(', '))}</Tags>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>${escapeXml(meta.title)}</Title>
${meta.protagonist ? `  <Writer>${escapeXml(meta.protagonist)}</Writer>\n` : ''}  <PageCount>${meta.imageCount}</PageCount>
${tags}</ComicInfo>
`;
}

/**
 * Generate CBZ archivefile。
 *
 */
export function generateCbz(images: CbzImageEntry[], metadata: CbzMetadata): Buffer {
  const zip = new AdmZip();

  for (let i = 0; i < images.length; i++) {
    const entry = images[i];
    const paddedIndex = String(i + 1).padStart(5, '0');
    const ext = entry.filename.split('.').pop() || 'jpg';
    zip.addFile(`${paddedIndex}.${ext}`, entry.data);
  }

  zip.addFile('ComicInfo.xml', Buffer.from(generateComicInfoXml(metadata), 'utf-8'));

  return zip.toBuffer();
}

export interface ZipImageEntry {
  filename: string;
  data: Buffer;
}


export function generateZip(images: ZipImageEntry[]): Buffer {
  const zip = new AdmZip();

  for (const entry of images) {
    const safeName = entry.filename.split('/').pop() || entry.filename;
    zip.addFile(safeName, entry.data);
  }

  return zip.toBuffer();
}

// ─── Types ───

export type ArchiveFormat = 'cbz' | 'zip';
