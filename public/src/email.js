// Sends account emails (password reset, username reminder).
// Works with either free provider, picked by which secret is set:
//   Brevo  — BREVO_API_KEY   (can send from one verified email address; no domain needed)
//   Resend — RESEND_API_KEY  (needs a domain you own, verified in Resend)
// MAIL_FROM is the sender address. With neither set, the email is only written to the logs.

export const emailConfigured = env => !!((env.BREVO_API_KEY || env.RESEND_API_KEY) && env.MAIL_FROM);

export async function sendEmail(env, { to, subject, text, html }) {
  const from = env.MAIL_FROM || '';
  const fromName = env.MAIL_FROM_NAME || 'Next Up';
  try {
    if (env.BREVO_API_KEY && from) {
      const res = await fetch(env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { email: from, name: fromName }, to: [{ email: to }], subject, textContent: text, htmlContent: html })
      });
      if (!res.ok) console.error('Brevo send failed', res.status, await res.text().catch(() => ''));
      return { sent: res.ok, provider: 'brevo' };
    }
    if (env.RESEND_API_KEY && from) {
      const res = await fetch(env.RESEND_API_URL || 'https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, text, html })
      });
      if (!res.ok) console.error('Resend send failed', res.status, await res.text().catch(() => ''));
      return { sent: res.ok, provider: 'resend' };
    }
  } catch (e) {
    console.error('Email failed', e);
    return { sent: false };
  }
  console.log(`[email not set up — not sent]\nTo: ${to}\nSubject: ${subject}\n\n${text}`);
  return { sent: false, provider: null };
}

const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Simple, readable email body (plain text + matching HTML).
export function emailBody(lines, button) {
  const text = lines.join('\n\n') + (button ? `\n\n${button.label}: ${button.url}` : '');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#12201a;max-width:520px">
    <p style="font-weight:800;font-size:20px;letter-spacing:.04em;color:#0d3b2a;margin:0 0 16px">NEXT UP</p>
    ${lines.map(l => `<p style="margin:0 0 14px">${escHtml(l)}</p>`).join('')}
    ${button ? `<p style="margin:22px 0"><a href="${escHtml(button.url)}" style="display:inline-block;background:#1f8a5b;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${escHtml(button.label)}</a></p>
    <p style="margin:0;font-size:13px;color:#4a5a52">Or copy this link: ${escHtml(button.url)}</p>` : ''}
  </div>`;
  return { text, html };
}
