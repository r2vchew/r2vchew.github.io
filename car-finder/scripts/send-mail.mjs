#!/usr/bin/env node
// Minimal SMTP client, enough to send one HTML email.
//
// Deliberately not a third-party Action: this step handles the mailbox
// password, and a small amount of code we control is a better trade than a
// dependency we would have to keep auditing.
//
// Supports implicit TLS (port 465) and STARTTLS (587 and friends).
//
//   MAIL_SERVER=smtp.gmail.com MAIL_PORT=465 MAIL_USERNAME=... \
//   MAIL_PASSWORD=... MAIL_TO=a@b.com node scripts/send-mail.mjs \
//     --html build/digest.html --subject "..."

import { readFile } from 'node:fs/promises';
import { connect as tlsConnect } from 'node:tls';
import { createConnection } from 'node:net';

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const HOST = process.env.MAIL_SERVER;
const PORT = Number(process.env.MAIL_PORT || 465);
const USER = process.env.MAIL_USERNAME;
const PASS = process.env.MAIL_PASSWORD;
const TO = (process.env.MAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
const FROM = process.env.MAIL_FROM || USER;
const FROM_NAME = process.env.MAIL_FROM_NAME || 'Car finder';

// Implicit TLS is the norm on 465 and STARTTLS elsewhere, but that is a
// convention rather than a rule, so it stays overridable.
const SECURE = process.env.MAIL_SECURE
  ? /^(1|true|yes)$/i.test(process.env.MAIL_SECURE)
  : PORT === 465;

const TIMEOUT_MS = Number(process.env.MAIL_TIMEOUT_MS || 30000);

/** Wrap a socket in a tiny line-oriented SMTP conversation. */
function smtpSession(socket) {
  let buffer = '';
  let pending = null;

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    // A reply ends with "NNN <text>\r\n"; continuation lines use "NNN-".
    const match = buffer.match(/^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\r?\n$/);
    if (match && pending) {
      const { resolve } = pending;
      const code = Number(match[1]);
      const text = buffer.trim();
      buffer = '';
      pending = null;
      resolve({ code, text });
    }
  });

  // One error handler for the whole session. Attaching one per read leaks
  // listeners across a long conversation.
  socket.on('error', (err) => {
    if (pending) {
      const { reject } = pending;
      pending = null;
      reject(err);
    }
  });

  // A server that accepts the connection and then says nothing must not be
  // able to hang the whole workflow.
  const read = () => new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending = null;
        reject(new Error(`timed out after ${TIMEOUT_MS}ms waiting for the server`));
      },
      TIMEOUT_MS,
    );
    const settle = (fn) => (value) => { clearTimeout(timer); fn(value); };
    pending = { resolve: settle(resolve), reject: settle(reject) };
  });

  const send = async (line, expect) => {
    if (line !== null) socket.write(`${line}\r\n`);
    const reply = await read();
    if (expect && !expect.includes(reply.code)) {
      throw new Error(`SMTP expected ${expect.join('/')} but got: ${reply.text}`);
    }
    return reply;
  };

  return { send, socket };
}

function encodeHeader(value) {
  // RFC 2047 for anything outside plain ASCII.
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage({ subject, html }) {
  const boundaryless = Buffer.from(html, 'utf8').toString('base64')
    .replace(/(.{76})/g, '$1\r\n');

  return [
    `From: ${encodeHeader(FROM_NAME)} <${FROM}>`,
    `To: ${TO.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@car-finder>`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    boundaryless,
  ].join('\r\n');
}

async function openSocket() {
  if (SECURE) {
    return new Promise((resolve, reject) => {
      const s = tlsConnect({ host: HOST, port: PORT, servername: HOST }, () => resolve(s));
      s.once('error', reject);
    });
  }
  return new Promise((resolve, reject) => {
    const s = createConnection({ host: HOST, port: PORT }, () => resolve(s));
    s.once('error', reject);
  });
}

async function main() {
  const subject = arg('subject') || 'Car shortlist update';
  const htmlPath = arg('html', 'build/digest.html');

  const missing = ['MAIL_SERVER', 'MAIL_USERNAME', 'MAIL_PASSWORD', 'MAIL_TO']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.log(`Email not configured (missing ${missing.join(', ')}); skipping send.`);
    return;
  }

  const html = await readFile(htmlPath, 'utf8');
  let socket = await openSocket();
  let session = smtpSession(socket);

  await session.send(null, [220]);
  let ehlo = await session.send(`EHLO ${(FROM || 'localhost').split('@')[1] || 'localhost'}`, [250]);

  if (!SECURE) {
    if (!/STARTTLS/i.test(ehlo.text)) throw new Error('Server does not offer STARTTLS on this port');
    await session.send('STARTTLS', [220]);
    socket = await new Promise((resolve, reject) => {
      const s = tlsConnect({ socket: session.socket, servername: HOST }, () => resolve(s));
      s.once('error', reject);
    });
    session = smtpSession(socket);
    ehlo = await session.send(`EHLO ${(FROM || 'localhost').split('@')[1] || 'localhost'}`, [250]);
  }

  await session.send('AUTH LOGIN', [334]);
  await session.send(Buffer.from(USER, 'utf8').toString('base64'), [334]);
  await session.send(Buffer.from(PASS, 'utf8').toString('base64'), [235]);

  await session.send(`MAIL FROM:<${FROM}>`, [250]);
  for (const rcpt of TO) await session.send(`RCPT TO:<${rcpt}>`, [250, 251]);
  await session.send('DATA', [354]);

  // Dot-stuffing, per RFC 5321: a line consisting of a single "." ends DATA.
  const body = buildMessage({ subject, html })
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');

  await session.send(`${body}\r\n.`, [250]);
  await session.send('QUIT', [221]).catch(() => { /* some servers just hang up */ });
  socket.end();

  console.log(`Digest sent to ${TO.join(', ')}`);
}

main().catch((err) => {
  // A failed send must not lose the scan that already succeeded and committed.
  console.error(`Could not send the digest: ${err.message}`);
  process.exit(1);
});
