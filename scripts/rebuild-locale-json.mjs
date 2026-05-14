/**
 * Rebuilds public/locales/*.json from corrupted merge artifacts.
 * - en.json: English header + extracted tail + English UI overrides
 * - mrh.json: Mara nav/footer + same tail + complete footer fields
 * - my.json: Burmese header + home/song/... prefix + valid body slice from my.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, '..', 'public', 'locales');

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    const bv = out[k];
    if (pv && typeof pv === 'object' && !Array.isArray(pv) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = deepMerge(bv, pv);
    } else {
      out[k] = pv;
    }
  }
  return out;
}

function extractMrhTail(mrhRaw) {
  const parts = mrhRaw.split('=======');
  if (parts.length < 2) throw new Error('mrh.json: missing =======');
  const mid = parts[1].split('>>>>>>>')[0];
  const offlineIdx = mid.indexOf('"offline"');
  if (offlineIdx === -1) throw new Error('mrh.json: no offline in post-merge section');
  return mid.slice(offlineIdx).trim();
}

const englishUI = {
  offline: { badge: 'Offline Mode', badge_text: 'Offline' },
  breadcrumb: { home: 'Home' },
  home: {
    hero_title: 'Mara Song Lyrics',
    hero_subtitle: 'Discover and explore beautiful lyrics from the Mara community',
    search_placeholder: 'Search songs by title or artist...',
    search_results: 'Search Results',
    popular_songs: 'Popular Songs',
    all_songs: 'All Songs',
    no_songs_title: 'No songs found',
    no_songs_text: 'Try a different search term or browse categories above.',
  },
  song: {
    breadcrumb: 'Song',
    feedback_btn: 'Feedback',
    meta_desc: 'Read lyrics of "{title}" by {artist} on Mara Lyrics.',
    error_title: 'Song not found',
    error_text: 'This song may have been removed or the link is incorrect.',
    error_go_home: '← Go Home',
  },
  artist: {
    breadcrumb: 'Artist',
    role: 'Artist',
    songs_title: 'Songs by this artist',
    no_songs: 'No songs found for this artist.',
    error_title: 'Artist not found',
    error_text: 'This artist may have been removed or the link is incorrect.',
    error_go_home: '← Go Home',
  },
  composer: {
    breadcrumb: 'Composer',
    role: 'Composer',
    songs_title: 'Songs by this composer',
    no_songs: 'No songs found for this composer.',
    error_title: 'Composer not found',
    error_text: 'This composer may have been removed or the link is incorrect.',
    error_go_home: '← Go Home',
  },
  feedback: {
    title: 'Feedback',
    subtitle: 'Have feedback about this song? Let us know and we\'ll look into it.',
    about_label: 'Feedback about:',
    name_label: 'Your Name <span class="form-required">*</span>',
    name_placeholder: 'Enter your name',
    email_label: 'Your Email <span class="form-required">*</span>',
    email_placeholder: 'you@example.com',
    body_label: 'Your Feedback <span class="form-required">*</span>',
    body_placeholder:
      'Tell us what you think — corrections, suggestions, or anything else about this song.',
    submit_btn: 'Send Feedback',
    back_btn: '← Back',
    back_to_song: '← Back to song',
    sending: 'Sending...',
    success_title: 'Feedback Sent!',
    success_text:
      'Thank you for helping us improve Mara Lyrics. We\'ll review your feedback as soon as possible.',
    success_back_home: '← Back to Home',
    err_fill_all: 'Please fill in all required fields.',
    err_turnstile: 'Please complete the security verification.',
    err_send_failed: 'Failed to send',
    err_generic: 'Something went wrong. Please try again.',
  },
  error_page: {
    code: '404',
    title: 'Page Not Found',
    text_line1: "The page you're looking for doesn't exist or has been moved.",
    text_line2: "Let's get you back to the music.",
    back_home: '← Back to Home',
    go_back: 'Go Back',
  },
  common: {
    all: 'All',
    unknown: 'Unknown',
    unknown_artist: 'Unknown Artist',
    uncategorized: 'Uncategorized',
    loading: 'Loading...',
    views: 'views',
    prev: '← Prev',
    next: 'Next →',
    found: '({count} found)',
    cached: '({count} cached)',
    website: 'Website',
  },
  about: {
    breadcrumb: 'About Us',
    title: 'About Mara Lyrics',
    mission_heading: 'Our Mission',
    mission_p1:
      'MaraLyrics is dedicated to preserving, documenting, and sharing the rich musical heritage of the Mara people. We believe that music is one of the most powerful expressions of culture, and every lyric tells a story that deserves to be remembered.',
    mission_p2:
      'Our platform serves as a bridge between generations — making it easy for anyone, anywhere, to discover, learn, and enjoy Mara songs in their original language.',
    why_heading: 'Why We Exist',
    why_p1:
      'The Mara language and its musical traditions are an integral part of our cultural identity. As communities modernize and disperse, there is an urgent need to document and preserve these artistic works before they fade from collective memory.',
    why_p2: 'MaraLyrics exists to:',
    why_li1: 'Provide a free, accessible, and centralized collection of Mara song lyrics',
    why_li2: 'Support the preservation of the Mara language through music',
    why_li3: 'Celebrate the work of Mara artists and composers',
    why_li4: 'Create a community-driven cultural archive',
    vision_heading: 'Our Vision',
    vision_p1:
      'We envision MaraLyrics as the definitive digital archive of Mara music — a living, growing repository that future generations can turn to for education, inspiration, and cultural connection.',
    vision_p2: 'Our long-term goals include:',
    vision_li1: 'Building the largest collection of Mara song lyrics online',
    vision_li2: 'Adding song audio and video references where available',
    vision_li3: 'Supporting multilingual translations of lyrics',
    vision_li4: 'Collaborating with cultural organizations and educational institutions',
    vision_li5: 'Empowering community members to contribute and curate content',
    community_heading: 'Community First',
    community_p1:
      'MaraLyrics is built by and for the Mara community. We welcome feedback, song submissions, and corrections from anyone who shares our passion for preserving Mara music. Together, we can ensure that our songs continue to inspire for generations to come.',
    community_p2:
      'Want to get involved? <a href="/contact">Get in touch with us</a> or <a href="/report">send us feedback</a>.',
  },
  contact: {
    breadcrumb: 'Contact Us',
    title: 'Contact Us',
    intro:
      'Have a question, suggestion, or want to contribute to Mara Lyrics? We\'d love to hear from you. Fill out the form below or reach out directly via email.',
    name_label: 'Your Name <span class="form-required">*</span>',
    name_placeholder: 'Enter your name',
    email_label: 'Your Email <span class="form-required">*</span>',
    email_placeholder: 'you@example.com',
    subject_label: 'Subject',
    subject_placeholder: 'What is this about?',
    message_label: 'Message <span class="form-required">*</span>',
    message_placeholder: 'Write your message here...',
    submit_btn: 'Send Message',
    back_btn: '← Back',
    success_title: 'Message Sent!',
    success_text: 'Thank you for reaching out. We\'ll get back to you as soon as possible.',
    success_back_home: '← Back to Home',
  },
  faq: {
    breadcrumb: 'FAQ',
    title: 'Frequently Asked Questions',
    q1: 'How accurate are the song lyrics on Mara Lyrics?',
    a1:
      '<p>We strive for the highest level of accuracy. All lyrics are sourced from original recordings, official publications, or trusted community members. However, some variations may exist between different performances or regional dialects. If you notice an error, please use our <a href="/report">Report Error</a> page to let us know.</p>',
    q2: 'How can I submit a song to Mara Lyrics?',
    a2:
      '<p>We welcome song submissions from the community! To submit lyrics, please <a href="/contact">contact us</a> with the following information:</p><ul><li>Song title</li><li>Artist / composer name</li><li>Complete lyrics text</li><li>Category (Gospel, Love, Traditional, Patriotic, etc.)</li><li>Any additional context or notes</li></ul><p>Our editorial team will review the submission and publish it once verified.</p>',
    q3: 'Is MaraLyrics free to use?',
    a3:
      '<p>Yes! Mara Lyrics is completely free. Our mission is to make Mara song lyrics accessible to everyone. The platform may display advertisements to support operational costs, but access to lyrics will always remain free.</p>',
    q4: 'Who owns the copyright to the lyrics?',
    a4:
      '<p>The copyright of all lyrics belongs to their respective artists, composers, and rights holders. Mara Lyrics displays lyrics for cultural, educational, and personal use only. We do not claim ownership of any song content. If you are a copyright owner and wish to request a removal, please visit our <a href="/copyright">Copyright</a> page.</p>',
    q5: 'How do I report an error in the lyrics?',
    a5:
      '<p>You can report errors directly from the song page by clicking the "Send Feedback" button, or visit our <a href="/report">Report Error</a> page. Please include the song title and a description of the issue. Our team will review and correct it promptly.</p>',
    q6: 'Can I use lyrics from MaraLyrics for my project?',
    a6:
      '<p>Lyrics on Mara Lyrics are shared for cultural and educational purposes. For personal, non-commercial use (such as learning, singing, or study), you are welcome to reference the content. For any commercial use, please contact the original rights holders. Please see our <a href="/terms">Terms &amp; Conditions</a> for full details.</p>',
    q7: 'Does Mara Lyrics collect my personal data?',
    a7:
      '<p>We collect minimal data necessary to operate the platform. This includes basic analytics (page views) and information you voluntarily submit through our forms (name, email). We never sell your data. For full details, please read our <a href="/privacy">Privacy Policy</a>.</p>',
    q8: 'How can I support MaraLyrics?',
    a8:
      '<p>You can support us by:</p><ul><li>Sharing MaraLyrics with friends and family</li><li>Submitting song lyrics or corrections</li><li>Providing feedback through our <a href="/contact">Contact</a> page</li><li>Spreading the word about Mara music and culture</li></ul>',
  },
};

const enHeader = {
  nav: { home: 'Home', popular: 'Popular' },
  footer: {
    made_with: 'Made with <span class="footer__heart">♥</span> for the Mara community',
    tagline: 'Preserving Mara music for future generations.',
    copyright: '© 2026 Mara Lyrics. All rights reserved.',
    cols: {
      information: 'Information',
      legal: 'Legal',
      support: 'Support',
    },
    links: {
      about: 'About Us',
      faq: 'FAQ',
      privacy: 'Privacy Policy',
      terms: 'Terms & Conditions',
      copyright: 'Copyright',
      contact: 'Contact Us',
      report: 'Report Error',
    },
  },
  brand: { name: 'Mara Lyrics' },
};

const mrhHeader = {
  nav: { home: 'Hmiapi', popular: 'Mo Hluhpazy' },
  footer: {
    made_with: 'Marasaw châta <span class="footer__heart">♥</span> ta taopa',
    tagline: 'Preserving Mara music for future generations.',
    copyright: '© 2026 MaraLyrics',
    cols: {
      information: 'Information',
      legal: 'Legal',
      support: 'Support',
    },
    links: {
      about: 'About Us',
      faq: 'FAQ',
      privacy: 'Privacy Policy',
      terms: 'Terms & Conditions',
      copyright: 'Copyright',
      contact: 'Contact Us',
      report: 'Report Error',
    },
  },
  brand: { name: 'Mara Lyrics' },
};

const myHeader = {
  nav: { home: 'ပင်မ', popular: 'ရေပန်းစားသော' },
  footer: {
    made_with:
      'မာရာ အသိုင်းအဝိုင်းအတွက် <span class="footer__heart">♥</span> ဖြင့် ဖန်တီးထားပါသည်',
    tagline: 'မရာဂီတအမွေကို မျိုးဆက်များအတွက် ထိန်းသိမ်းခဲ့ပါသည်',
    copyright: '© ၂၀၂၆ မရာ သီချင်းစာသား',
    cols: {
      information: 'သတင်းအချက်အလက်',
      legal: 'ဥပဒေ',
      support: 'ပံ့ပိုးမှု',
    },
    links: {
      about: 'ကျွန်ုပ်တို့အကြောင်း',
      faq: 'မေးခွန်းများ',
      privacy: 'ကိုယ်ရေးရာဝန်ကြီး',
      terms: 'စည်းမျဉ်းများ',
      copyright: 'မူပိုင်ခွင့်',
      contact: 'ဆက်သွယ်ရန်',
      report: 'အမှားတင်ပြရန်',
    },
  },
  offline: { badge: 'အော့ဖ်လိုင်းစနစ်', badge_text: 'အော့ဖ်လိုင်း' },
  breadcrumb: { home: 'ပင်မ' },
  brand: { name: 'Mara Lyrics' },
  home: {
    hero_title: 'မရာ တေးသီချင်း စာသားများ',
    hero_subtitle: 'မရာအသိုင်းအဝိုင်းမှ လှပသောသီချင်းစာသားများကို ရှာဖွေလေ့လာပါ',
    search_placeholder: 'ခေါင်းစဉ် သို့မဟုတ် တေးဆိုဖြင့် ရှာဖွေရန်...',
    search_results: 'ရှာဖွေမှု ရလဒ်များ',
    popular_songs: 'ရေပန်းစားသော တေးသီချင်းများ',
    all_songs: 'တေးသီချင်းများအားလုံး',
    no_songs_title: 'တေးသီချင်း မတွေ့ပါ',
    no_songs_text: 'အခြားသော့ချက်စကားလုံးဖြင့် ထပ်မံရှာဖွေကြည့်ပါ',
  },
  song: {
    breadcrumb: 'တေးသီချင်း',
    feedback_btn: 'အကြံပြုချက်ပေးရန်',
    meta_desc:
      '{artist} သီဆိုထားသော "{title}" တေးသီချင်းစာသားကို မရာ သီချင်းစာသားတွင် ဖတ်ရှုနိုင်ပါသည်။',
    error_title: 'တေးသီချင်း မတွေ့ပါ',
    error_text:
      'ဤတေးသီချင်းအား ဖယ်ရှားထားနိုင်ပါသည် သို့မဟုတ် လင့်ခ် အမှား ဖြစ်နိုင်ပါသည်',
    error_go_home: '← ပင်မသို့ ပြန်သွားရန်',
  },
  artist: {
    breadcrumb: 'တေးဆို',
    role: 'တေးဆို',
    songs_title: 'ဤတေးဆိုမှ တေးသီချင်းများ',
    no_songs: 'ဤတေးဆိုအတွက် တေးသီချင်း မတွေ့ပါ။',
    error_title: 'တေးဆို မတွေ့ပါ',
    error_text:
      'ဤတေးဆိုကို ဖယ်ရှားထားနိုင်ပါသည် သို့မဟုတ် လင့်ခ် မှားနေနိုင်ပါသည်။',
    error_go_home: '← ပင်မသို့ ပြန်သွားရန်',
  },
  composer: {
    breadcrumb: 'တေးရေး',
    role: 'တေးရေး',
    songs_title: 'ဤတေးရေးမှ တေးသီချင်းများ',
    no_songs: 'ဤတေးရေးအတွက် တေးသီချင်း မတွေ့ပါ။',
    error_title: 'တေးရေး မတွေ့ပါ',
    error_text:
      'ဤတေးရေးကို ဖယ်ရှားထားနိုင်ပါသည် သို့မဟုတ် လင့်ခ် မှားနေနိုင်ပါသည်။',
    error_go_home: '← ပင်မသို့ ပြန်သွားရန်',
  },
};

const mrhRaw = fs.readFileSync(path.join(localesDir, 'mrh.json'), 'utf8');
const tail = extractMrhTail(mrhRaw).trim();
// tail is "offline": { ... }, ... "consent": { } } — already ends with }; prefix one opening {
const tailObj = JSON.parse('{' + tail);

const enObj = deepMerge(deepMerge({ ...enHeader }, tailObj), englishUI);
fs.writeFileSync(path.join(localesDir, 'en.json'), JSON.stringify(enObj, null, 2) + '\n', 'utf8');

const mrhObj = deepMerge({ ...mrhHeader }, tailObj);
fs.writeFileSync(path.join(localesDir, 'mrh.json'), JSON.stringify(mrhObj, null, 2) + '\n', 'utf8');

const myRaw = fs.readFileSync(path.join(localesDir, 'my.json'), 'utf8');
const myLines = myRaw.split(/\r?\n/);
// Exclude final root `}` (line 230) — wrap would produce `}}` at end otherwise
const myBodyLines = myLines.slice(54, 229);
const myBody = myBodyLines.join('\n');
const myRest = JSON.parse(`{\n${myBody}\n}`);
const myObj = deepMerge(deepMerge({ ...myHeader }, myRest), {});
fs.writeFileSync(path.join(localesDir, 'my.json'), JSON.stringify(myObj, null, 2) + '\n', 'utf8');

for (const f of ['en', 'mrh', 'my']) {
  JSON.parse(fs.readFileSync(path.join(localesDir, `${f}.json`), 'utf8'));
}
console.log('OK: en.json, mrh.json, my.json rebuilt and parse as valid JSON.');
