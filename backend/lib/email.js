// Sends transactional email via Resend's HTTP API (https://resend.com) — a single
// fetch call, no SDK needed. If RESEND_API_KEY isn't set, this silently skips
// sending (so the app still works locally without an email provider configured).
async function sendEmail(to, subject, html) {
  if (!to) return;
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email to', to);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'FO Training <onboarding@resend.dev>',
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Resend email failed', res.status, text);
    }
  } catch (err) {
    console.error('Resend email error', err);
  }
}

module.exports = { sendEmail };
