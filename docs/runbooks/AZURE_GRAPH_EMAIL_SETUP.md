# Azure app registration for Microsoft Graph email

This runbook sets up the app registration Wingcaster uses to send email
through your Microsoft 365 tenant via the Microsoft Graph API — a modern,
supported alternative to `smtp.office365.com`, which Microsoft has deprecated
basic auth on and disables by policy on many tenants.

**Time required:** ~5 minutes in the Azure portal, plus one round-trip if a
different admin needs to grant consent.

**Who can do this:** an account with **Application Administrator** (or higher)
in Entra ID, and **Global Administrator** to grant the consent in step 4.

---

## 1. Create the app registration

1. Open <https://portal.azure.com> and sign in with an admin account.
2. Search for **Microsoft Entra ID** (formerly Azure Active Directory) and open it.
3. In the left sidebar, select **App registrations** → **New registration**.
4. Fill in:
   - **Name:** `Wingcaster Email Sender` (any name; only shown internally)
   - **Supported account types:** *Accounts in this organizational directory only (Single tenant)*
   - **Redirect URI:** leave blank — this is a daemon app, no login flow
5. Click **Register**.

You are now on the app's Overview page. Record two values you will need:

- **Directory (tenant) ID** → this becomes `AZURE_TENANT_ID`
- **Application (client) ID** → this becomes `AZURE_CLIENT_ID`

---

## 2. Grant the Mail.Send permission

1. In the app's left sidebar, select **API permissions**.
2. Click **Add a permission** → **Microsoft Graph** → **Application permissions**.
3. Search for `Mail.Send`, tick it, click **Add permissions**.
4. Verify the row shows **Mail.Send** with type **Application** and status
   *Not granted for \<tenant\>* (an orange warning).

**⚠️ Do NOT pick "Delegated permissions".** Delegated permissions require an
interactive user login every time the app sends. The app is a headless
service; it needs **Application** permission.

---

## 3. Grant admin consent

Still on the **API permissions** page:

1. Click **Grant admin consent for \<tenant\>** (button above the permissions
   list — requires a **Global Administrator**).
2. Confirm in the dialog.
3. The status column changes to a green tick: *Granted for \<tenant\>*.

If you are not a Global Admin, share the app's Overview page with someone who
is, and ask them to click this button. Without consent the token endpoint will
refuse every request with `AADSTS65001: The user or administrator has not
consented to use the application`.

---

## 4. Create a client secret

1. In the app's left sidebar, select **Certificates & secrets** →
   **Client secrets** → **New client secret**.
2. Fill in:
   - **Description:** `Wingcaster email — <year>-<qq>` (rotation-friendly)
   - **Expires:** **6 months** or **12 months** (the shortest sensible interval;
     Azure defaults to 6). Add the rotation date to your calendar now.
3. Click **Add**.

**⚠️ Copy the `Value` column immediately** — Azure only shows the secret once.
If you navigate away, it is unrecoverable and you have to delete it and create
a new one.

This value becomes `AZURE_CLIENT_SECRET`. It is not the *Secret ID* (which is
the identifier, not the credential).

---

## 5. (Strongly recommended) restrict the app to one mailbox

By default the app can technically send as **any** mailbox in the tenant.
Restrict it to your notification mailbox only with an Exchange
Application Access Policy.

Run these in **PowerShell as an admin who has Exchange Administrator role**,
after `Connect-ExchangeOnline`:

```powershell
# 1. Create a mail-enabled security group for the mailboxes the app may send as.
#    Add your notification mailbox to it.
New-DistributionGroup -Name "Wingcaster-App-Senders" `
  -Type "Security" `
  -PrimarySmtpAddress "wingcaster-app-senders@yourdomain.com" `
  -MemberJoinRestriction Closed

Add-DistributionGroupMember -Identity "Wingcaster-App-Senders" `
  -Member "noreply@yourdomain.com"

# 2. Restrict the app registration to only that group.
New-ApplicationAccessPolicy `
  -AppId "<AZURE_CLIENT_ID from step 1>" `
  -PolicyScopeGroupId "wingcaster-app-senders@yourdomain.com" `
  -AccessRight RestrictAccess `
  -Description "Wingcaster may only send as members of this group"

# 3. Verify — should return AccessLocation: Denied for a mailbox NOT in the group.
Test-ApplicationAccessPolicy `
  -Identity "someone-else@yourdomain.com" `
  -AppId "<AZURE_CLIENT_ID>"
```

Without this policy the app is technically permitted to send as, e.g., your
CEO. The transport works fine either way; the policy is defence in depth.

---

## 6. Set the environment variables in Railway

Open the backend service in Railway → **Variables** tab → **New Variable**
for each of these:

| Name                    | Value                                              |
|-------------------------|----------------------------------------------------|
| `AZURE_TENANT_ID`       | The **Directory (tenant) ID** from step 1          |
| `AZURE_CLIENT_ID`       | The **Application (client) ID** from step 1        |
| `AZURE_CLIENT_SECRET`   | The secret **Value** from step 4                   |
| `MAIL_FROM`             | The sending mailbox (e.g. `noreply@yourdomain.com`) |

Optional:

| Name                    | Value                                              |
|-------------------------|----------------------------------------------------|
| `MAIL_FROM_NAME`        | Display name shown next to the sender, e.g. `Wingcaster` |
| `GRAPH_SAVE_TO_SENT`    | `true` to keep a copy in Sent Items (default `false`) |

Railway redeploys automatically when you save a variable. That's the whole
setup — no other config changes needed. The unified email dispatcher
auto-detects Graph when these four values are present and switches to it
without a code change.

---

## 7. Verify

After the redeploy:

- Sign in to Wingcaster and trigger any email-sending action — a signup OTP is
  the quickest.
- Check the sender's **Sent Items** in Outlook (only visible if you set
  `GRAPH_SAVE_TO_SENT=true`, or use the message trace below regardless).
- Alternatively, in the Exchange admin center: **Mail flow** → **Message trace**
  → search for the recipient. A successful send appears within ~30 seconds.

If nothing arrives, in Railway → your backend service → **Logs**, search for
`GRAPH_`. The transport uses stable error codes:

- `GRAPH_MISCONFIGURED` — one of the four env vars is missing or empty
- `GRAPH_TOKEN_FAILED` — token endpoint refused the credentials; usually
  `AADSTS7000215` (wrong secret) or `AADSTS65001` (admin consent not granted)
- `GRAPH_SEND_FAILED` — Graph refused the send; the message includes the
  Graph error code (`MailboxNotFound`, `Forbidden`, etc.)

---

## Rotating the secret

Client secrets expire (6 or 12 months by default). To rotate without a service
gap:

1. In the app → **Certificates & secrets** → create a **new** secret.
2. In Railway, update `AZURE_CLIENT_SECRET` to the new value; Railway
   redeploys.
3. Verify a test send works.
4. Return to Azure and **delete** the old secret.

The transport's token cache invalidates on the redeploy, so the new secret is
in use from the first send after step 2.
