// The blog's markdown renderer (server.js renderMarkdown), held to its brief.
//
//   node markdown-test.js
//
// The function is lifted out of server.js with the two helpers it reads and
// run as it is, so the test sees the real renderer, not a copy. Backlog 45e:
// the image rule's output was re-read by the link rule, so a link written in
// an image's alt text broke out of the attribute.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
// From `head` to the brace that closes the block it opens.
function lift(head) {
  const at = src.indexOf(head);
  if (at < 0) throw new Error('not found: ' + head);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}
const code = [
  src.match(/const safeImgSrc = [^\n]+\n/)[0],
  lift('const PAGE_SKIN = {') + ';',
  lift('function renderMarkdown(src, skin) {'),
  'result.render = renderMarkdown;',
].join('\n');
const box = { result: {} };
vm.runInNewContext(code, box);
const md = box.result.render;

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`  ok    ${label}`);
}
// The tags the output contains, in order, with their attributes.
const tags = (html) => (html.match(/<[a-z][^>]*>/gi) || []);

console.log('ordinary markdown still renders');
check('a paragraph', md('Hello world'), '<p>Hello world</p>');
check('bold and italic', md('**bold** and *it*'), '<p><strong>bold</strong> and <em>it</em></p>');
check('a link', md('[site](https://example.com)'), '<p><a href="https://example.com" target="_blank" rel="noopener">site</a></p>');
check('an internal link', md('[blog](/blog)'), '<p><a href="/blog">blog</a></p>');
check('a javascript: link keeps its words only', md('[x](javascript:void)'), '<p>x</p>');
check('an image (a line of its own is a figure, not a paragraph)', md('![A chart](https://example.com/c.png)'), '<figure class="pimg"><img src="https://example.com/c.png" alt="A chart" loading="lazy" /><figcaption>A chart</figcaption></figure>');
check('a sized image', md('![A](https://e.com/a.png "small")').includes('class="pimg small"'), true);
check('a protocol-relative link is not treated as internal', md('[x](//evil.example/a)'), '<p>x</p>');
check('nor a backslash one', md('[x](/\\evil.example/a)'), '<p>x</p>');
check('code is literal', md('`<b>` and `[x](https://e.com)`'), '<p><code>&lt;b&gt;</code> and <code>[x](https://e.com)</code></p>');
check('raw HTML is escaped', md('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');

console.log('a link in an image\'s alt text stays inside the attribute');
const out = md('![see [here](https://evil.example/x" onerror="alert(1)) now](https://example.com/p.png)');
check('no element carries an onerror attribute', tags(out).some((t) => /\sonerror\s*=/i.test(t)), false);
check('no <a> is written inside the img tag', /<img[^>]*<a\s/i.test(out), false);
const alt = md('![a [b](https://e.com) c](https://example.com/p.png)');
check('nested brackets in alt text never become a tag inside the img', /<img[^>]*<a\s/i.test(alt), false);
// The way in that worked: the title slot can hold `[l](url)`, and the link rule
// wrote an <a> inside the img's title attribute, whose own quotes ended it.
const titled = md('![x](https://e.com/p.png "t [l](https://e.com)")');
check('a link in the title is not written inside the img tag', /<img[^>]*<a\s/i.test(titled), false);
check('the title keeps its words', /title="t \[l\]\(https:\/\/e\.com\)"/.test(titled), true);
check('a NUL in the source cannot forge a placeholder', md('a \u00000\u0000 b'), '<p>a 0 b</p>');

console.log(`\n${n - failed} of ${n} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exitCode = failed ? 1 : 0;
