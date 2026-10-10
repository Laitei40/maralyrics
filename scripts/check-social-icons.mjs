#!/usr/bin/env node
// Checks for public/social-icons.js (link → platform name + icon).   npm run test:social
// Loads the real browser file in a sandbox: right service per hostname, no false matches from substrings,
// and every icon is a well-formed inline <svg>. Exit code 1 on failure.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = fs.readFileSync(path.join(ROOT, 'public/social-icons.js'), 'utf8');
const ctx = vm.createContext({ URL });
vm.runInContext(`${code}\nthis.SocialIcons = SocialIcons;`, ctx);
const { SocialIcons } = ctx;

let passes = 0;
let failures = 0;
const check = (cond, msg) => { if (cond) passes++; else { failures++; console.error(`  ✗ ${msg}`); } };
const name = (url, opts) => SocialIcons.detect(url, opts).name;

console.log('Recognised services');
const CASES = {
  'https://www.facebook.com/ann': 'Facebook', 'https://m.facebook.com/ann': 'Facebook', 'https://fb.me/ann': 'Facebook',
  'https://instagram.com/ann': 'Instagram', 'https://x.com/ann': 'X', 'https://twitter.com/ann': 'X',
  'https://www.threads.net/@ann': 'Threads', 'https://www.youtube.com/@ann': 'YouTube', 'https://youtu.be/abc': 'YouTube',
  'https://music.youtube.com/channel/UC1': 'YouTube Music', 'https://www.tiktok.com/@ann': 'TikTok',
  'https://open.spotify.com/artist/1': 'Spotify', 'https://music.apple.com/us/artist/ann/1': 'Apple Music',
  'https://itunes.apple.com/us/artist/ann/1': 'Apple Music', 'https://podcasts.apple.com/us/podcast/x/id1': 'Apple Podcasts',
  'https://music.amazon.com/artists/B00': 'Amazon Music', 'https://music.amazon.in/artists/B00': 'Amazon Music', 'https://music.amazon.co.uk/artists/B00': 'Amazon Music',
  'https://www.deezer.com/artist/1': 'Deezer', 'https://tidal.com/browse/artist/1': 'TIDAL', 'https://soundcloud.com/ann': 'SoundCloud',
  'https://ann.bandcamp.com': 'Bandcamp', 'https://audiomack.com/ann': 'Audiomack', 'https://www.shazam.com/artist/x/1': 'Shazam',
  'https://genius.com/artists/Ann': 'Genius', 'https://t.me/ann': 'Telegram', 'https://wa.me/123': 'WhatsApp', 'https://invite.viber.com/?g2=x': 'Viber',
  'https://line.me/ti/p/x': 'LINE', 'https://discord.gg/abc': 'Discord', 'https://www.twitch.tv/ann': 'Twitch', 'https://www.pinterest.com/ann': 'Pinterest',
  'https://www.reddit.com/user/ann': 'Reddit', 'https://www.snapchat.com/add/ann': 'Snapchat', 'https://www.linkedin.com/in/ann': 'LinkedIn',
  'https://www.patreon.com/ann': 'Patreon', 'https://ko-fi.com/ann': 'Ko-fi', 'https://linktr.ee/ann': 'Linktree', 'https://en.wikipedia.org/wiki/Ann': 'Wikipedia',
  'mailto:ann@example.com': 'Email', 'MAILTO:ann@example.com': 'Email',
};
for (const [url, expected] of Object.entries(CASES)) check(name(url) === expected, `${url} → ${expected} (got ${name(url)})`);
check(name('facebook.com/ann') === 'Facebook' && name('  https://youtube.com/@x  ') === 'YouTube', 'bare domain and surrounding spaces are fine');
check(name('HTTPS://WWW.SPOTIFY.COM/artist/1') === 'Spotify', 'case-insensitive');

console.log('Not fooled by look-alikes');
for (const url of [
  'https://example.com/?ref=x.com', 'https://example.com/facebook.com', 'https://dropbox.com/s/x', 'https://notfacebook.com/ann', 'https://facebook.com.evil.example/ann',
  'https://example.com/#youtube.com', 'https://music.apple.com.evil.example/x', 'https://fox.com', 'https://linux.com', 'https://maralyrics.com',
  'https://music.amazon.evil.example.com/x', 'https://amazon.com/dp/1', 'not a url at all', '', null, undefined,
]) check(name(url) === 'Website', `${JSON.stringify(url)} is a plain website (got ${name(url)})`);
check(name('https://example.com', { websiteLabel: 'Webhsait' }) === 'Webhsait', 'the website label can be translated');

console.log('Icons');
const seen = new Set();
for (const url of [...Object.keys(CASES), 'https://example.com']) {
  const { icon, key } = SocialIcons.detect(url, { size: 18 });
  seen.add(key);
  check(/^<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="[^"<>]+"\/><\/svg>$/.test(icon), `icon for ${url} is a well-formed inline svg`);
  check(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s\-+]+$/.test(icon.match(/ d="([^"]+)"/)[1]), `icon path for ${url} has only path characters`);
}
check(SocialIcons.detect('https://x.com/a').icon.includes('width="20"'), 'default size is 20');
check(seen.size >= 30, `many distinct icons in use (${seen.size})`);
const paths = [...code.matchAll(/^    ([a-z]+): '([^']+)',$/gm)].map((m) => m[2]);
check(new Set(paths).size === paths.length, 'no two services share the same artwork');

console.log(`\n${failures ? '✗' : '✓'} ${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
