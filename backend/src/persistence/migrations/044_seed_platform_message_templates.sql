-- Seed the three platform message templates that ship with the app.
--
--   signup_otp        the verification code sent at signup
--   welcome           sent after signup verifies successfully
--   whatsapp_welcome  sent when an agent connects a WhatsApp number
--
-- All three are `is_seed=true`, which means the admin can edit them
-- (bumping version and archiving prior state) but not delete them —
-- the send sites always have something to fall back to. All three are
-- global (`territory_id IS NULL`) and English; territorial and
-- per-language variants are the admin's job to add via the UI.
--
-- The copy is deliberately restrained. It replaces `otpCopy()` in
-- lib/otp.js (which was hardcoded prose in JavaScript) with something
-- that has parity of behaviour and can be improved by the platform
-- admin without a code change.
--
-- `editor_mode='raw'` — this is hand-authored HTML. When the admin
-- edits via the Unlayer UI (commit 5), that mode flips to 'unlayer'
-- and `design_json` populates from the builder state.

INSERT INTO platform_message_templates (
  id, code, display_name, description, channel, category,
  language, territory_id,
  subject, html_body, text_body,
  editor_mode, required_variables, optional_variables,
  is_active, is_seed, version,
  created_at, updated_at, data
) VALUES

-- ------------------------------------------------------------------
-- signup_otp
-- ------------------------------------------------------------------
(
  gen_random_uuid()::text,
  'signup_otp',
  'Signup verification code',
  'Sent when a new agent signs up. Contains the 6-digit code they enter to verify their email.',
  'email',
  'auth',
  'en',
  NULL,
  'Your Wingcaster verification code: {{code}}',
  '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:520px;margin:0 auto;padding:24px;">
     <p style="margin:0 0 16px 0;">Use this code to verify your Wingcaster account:</p>
     <p style="font-size:28px;font-weight:600;letter-spacing:6px;margin:24px 0;">{{code}}</p>
     <p style="color:#6b7280;font-size:13px;margin:0;">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
   </div>',
  'Use this code to verify your Wingcaster account:

    {{code}}

This code expires in 10 minutes. If you did not request it, you can ignore this email.',
  'raw',
  '["code"]'::jsonb,
  '["name"]'::jsonb,
  true, true, 1,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{}'::jsonb
),

-- ------------------------------------------------------------------
-- welcome
-- ------------------------------------------------------------------
(
  gen_random_uuid()::text,
  'welcome',
  'Welcome email',
  'Sent to a new agent immediately after their email verifies. Points them at the next thing to do.',
  'email',
  'onboarding',
  'en',
  NULL,
  'Welcome to Wingcaster, {{name}}',
  '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
     <h1 style="margin:0 0 12px 0;font-size:22px;">Welcome, {{name}}.</h1>
     <p style="margin:0 0 16px 0;">Your Wingcaster account is verified and ready.</p>
     <p style="margin:0 0 16px 0;">A few things worth doing next:</p>
     <ul style="margin:0 0 16px 0;padding-left:20px;">
       <li style="margin:6px 0;">Complete your agent profile so leads see your work.</li>
       <li style="margin:6px 0;">Connect WhatsApp to run listings from your phone.</li>
       <li style="margin:6px 0;">Enable two-factor authentication in Settings — it is optional today, likely mandatory soon for admins.</li>
     </ul>
     <p style="margin:24px 0 0 0;color:#6b7280;font-size:13px;">Need a hand getting set up? Just reply to this email.</p>
   </div>',
  'Welcome, {{name}}.

Your Wingcaster account is verified and ready.

A few things worth doing next:
  - Complete your agent profile so leads see your work.
  - Connect WhatsApp to run listings from your phone.
  - Enable two-factor authentication in Settings.

Need a hand getting set up? Just reply to this email.',
  'raw',
  '["name"]'::jsonb,
  '["support_email"]'::jsonb,
  true, true, 1,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{}'::jsonb
),

-- ------------------------------------------------------------------
-- whatsapp_welcome
-- ------------------------------------------------------------------
-- Note: channel is EMAIL, not WhatsApp. This is the message the
-- PLATFORM sends the AGENT after they've connected their WhatsApp — a
-- confirmation + short guide. The actual WhatsApp message sender for
-- outbound tenant→customer copy is a separate system.
(
  gen_random_uuid()::text,
  'whatsapp_welcome',
  'WhatsApp connected — onboarding guide',
  'Sent to an agent right after they successfully connect a WhatsApp number to their account.',
  'email',
  'onboarding',
  'en',
  NULL,
  'Your WhatsApp is connected. Here is how to use it.',
  '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
     <h1 style="margin:0 0 12px 0;font-size:22px;">WhatsApp is live on {{phone_number}}.</h1>
     <p style="margin:0 0 16px 0;">Hi {{name}}, your WhatsApp number is now connected to Wingcaster.</p>
     <h2 style="margin:20px 0 8px 0;font-size:16px;">What happens next</h2>
     <ol style="margin:0 0 16px 0;padding-left:20px;">
       <li style="margin:6px 0;"><b>Send us a photo of any listing.</b> We turn it into a formatted listing draft in your dashboard.</li>
       <li style="margin:6px 0;"><b>Share the listing link from WhatsApp.</b> Every click and reply flows back into your CRM.</li>
       <li style="margin:6px 0;"><b>Reply to a customer once here on Wingcaster</b>, and every future reply from the same number lands in the same conversation thread.</li>
     </ol>
     <p style="margin:16px 0 0 0;color:#6b7280;font-size:13px;">Save this number to your contacts so it does not go to spam.</p>
   </div>',
  'WhatsApp is live on {{phone_number}}.

Hi {{name}}, your WhatsApp number is now connected to Wingcaster.

What happens next:
  1. Send us a photo of any listing — we turn it into a listing draft in your dashboard.
  2. Share the listing link from WhatsApp — every click flows back into your CRM.
  3. Reply once here on Wingcaster, and future replies from the same number land in the same thread.

Save this number to your contacts so it does not go to spam.',
  'raw',
  '["name", "phone_number"]'::jsonb,
  '[]'::jsonb,
  true, true, 1,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{}'::jsonb
);
