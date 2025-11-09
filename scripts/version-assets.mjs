// Version asset references in HTML files by appending a short content hash as ?v=
// Safe approach: only updates references to /assets/*.css and /assets/*.js
// - For <link rel="stylesheet" href="/assets/*.css">
// - For <script src="/assets/*.js">
// - For <script type="module" src="/assets/*.js">
// - For inline dynamic imports like import('/assets/x.js') it appends ?v=HASH
//
// This script is idempotent per run (replaces existing ?v=... for those files).
// It computes the hash from the source file content so pushing code auto updates.
//
// Usage: node scripts/version-assets.mjs

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const assetsDir = path.join(root, 'assets');
const htmlGlobs = [
  '**/*.html'
];

function walk(dir){
  return fs.readdir(dir, { withFileTypes: true }).then(async entries => {
    const out = [];
    for (const e of entries){
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
    }
    return out;
  });
}

async function sha1Of(file){
  try{
    const buf = await fs.readFile(file);
    return createHash('sha1').update(buf).digest('hex').slice(0,10);
  }catch{
    return null;
  }
}

function withVersion(u, v){
  // Preserve existing query params but replace or add v=...
  const hasQuery = u.includes('?');
  const [base, query] = hasQuery ? u.split('?') : [u, ''];
  const params = new URLSearchParams(query);
  params.set('v', v);
  return `${base}?${params.toString()}`.replace(/\?$/, '');
}

function isAssetUrl(u){
  return /(^|["'`])\/?assets\/[a-zA-Z0-9_\-/]+\.(?:js|css)(?:\?[^"'`]*)?(["'`]|$)/.test(u);
}

async function main(){
  // Map asset path -> hash
  const allAssetFiles = await walk(assetsDir).catch(()=>[]);
  const hashByRel = new Map();
  for (const abs of allAssetFiles){
    const rel = '/' + path.relative(root, abs).replace(/\\/g, '/');
    const h = await sha1Of(abs);
    if (h) hashByRel.set(rel, h);
  }

  // Process HTML files
  const allFiles = (await walk(root))
    .filter(f => f.endsWith('.html'))
    // Do not touch files in node_modules or netlify folders
    .filter(f => !/node_modules|\.netlify|public\//.test(f));

  for (const file of allFiles){
    let src = await fs.readFile(file, 'utf8');
    let changed = false;

    // 1) link/script tags with src/href pointing to /assets/*
    src = src.replace(/(src|href)=("|')([^"']+)(\2)/g, (m, attr, q, url, q2) => {
      if (!url.includes('/assets/')) return m;
      const bare = url.split('#')[0];
      const [pathOnly] = bare.split('?');
      const key = pathOnly.startsWith('/') ? pathOnly : '/' + pathOnly;
      const h = hashByRel.get(key);
      if (!h) return m;
      changed = true;
      return `${attr}=${q}${withVersion(url, h)}${q2}`;
    });

    // 2) dynamic imports import('/assets/x.js') in inline scripts
    src = src.replace(/import\(("|')([^"']+)(\1)\)/g, (m, q, url, q2) => {
      if (!url.includes('/assets/')) return m;
      const bare = url.split('#')[0];
      const [pathOnly] = bare.split('?');
      const key = pathOnly.startsWith('/') ? pathOnly : '/' + pathOnly;
      const h = hashByRel.get(key);
      if (!h) return m;
      changed = true;
      return `import(${q}${withVersion(url, h)}${q2})`;
    });

    // 3) static imports in inline module scripts: import {...} from '/assets/x.js'
    src = src.replace(/import\s+[^;]*?from\s+("|')([^"']+)(\1)/g, (m, q, url, q2) => {
      if (!url.includes('/assets/')) return m;
      // Only handle JS/CSS assets
      if (!/\.(js|css)(\?|$)/.test(url)) return m;
      const bare = url.split('#')[0];
      const [pathOnly] = bare.split('?');
      const key = pathOnly.startsWith('/') ? pathOnly : '/' + pathOnly;
      const h = hashByRel.get(key);
      if (!h) return m;
      changed = true;
      return m.replace(url, withVersion(url, h));
    });

    if (changed){
      await fs.writeFile(file, src, 'utf8');
      console.log('Updated versions in', path.relative(root, file));
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
