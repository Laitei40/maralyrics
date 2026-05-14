import { serveInfoPage } from './serveInfoPageUtil.js';

export async function onRequest(context) {
  return serveInfoPage(context, '/contact/page');
}
