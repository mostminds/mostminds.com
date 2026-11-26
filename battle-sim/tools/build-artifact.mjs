// Produces dist/: the page body without the html/head wrapper (the artifact
// host adds its own skeleton), plus every asset beside it.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const html = readFileSync(join(root, 'index.html'), 'utf8');
const body = html.split('<!--BODY-START-->')[1].split('<!--BODY-END-->')[0]
  .replace(/<\/head>\s*<body>/, '');
writeFileSync(join(out, 'index.html'), body.trim() + '\n');
cpSync(join(root, 'style.css'), join(out, 'style.css'));
cpSync(join(root, 'src'), join(out, 'src'), { recursive: true });
console.log('built', out);
