// Bundle the game into one HTML file: CSS and local scripts inlined, three.js + fonts from CDN.
//   node tools/build.mjs                 -> dist/cold-shutdown.html (full document, open it directly)
//   node tools/build.mjs --fragment OUT  -> page body only (for hosts that wrap the page in their own <html>)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const outArg = args.find((a) => !a.startsWith('--'));
const out = path.resolve(outArg || path.join(ROOT, 'dist', fragment ? 'cold-shutdown.fragment.html' : 'cold-shutdown.html'));

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="css\/style\.css">/, () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  return `<style>\n${css}\n</style>`;
});

html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, src) => {
  const js = fs.readFileSync(path.join(ROOT, src), 'utf8');
  if (/<\/script/i.test(js)) throw new Error(`${src} contains a closing script tag`);
  return `<script>\n/* ${src} */\n${js}\n</script>`;
});

if (fragment) {
  const title = (html.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
  const head = (html.match(/<head>([\s\S]*?)<\/head>/) || ['', ''])[1];
  const links = head.match(/<link[^>]+>/g) || [];
  const styles = head.match(/<style>[\s\S]*?<\/style>/g) || [];
  const body = (html.match(/<body>([\s\S]*?)<\/body>/) || ['', ''])[1];
  html = [title, ...links, ...styles, body.trim()].join('\n');
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB)`);
