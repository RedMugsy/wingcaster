#!/usr/bin/env python3
"""Rebrand Find Iqar -> REB across the entire codebase."""

import os, re, shutil

BASE = r"C:\Users\AliAchkar\Documents\kimi\workspace\souq-ajjar-realestate"

# ------------------------------------------------------------------
# 1. backend/src/seed.js
# ------------------------------------------------------------------
seed_path = os.path.join(BASE, "backend", "src", "seed.js")
with open(seed_path, "r", encoding="utf-8") as f:
    text = f.read()

replacements_seed = [
    ("admin@findiqar.com", "admin@realestatebazaar.com"),
    ("Find Iqar Admin", "REB Admin"),
    ("agency_name: 'Find Iqar'", "agency_name: 'Real Estate Bazaar'"),
    ("'FI-ADMIN'", "'REB-ADMIN'"),
    ("'find-iqar-admin'", "'reb-admin'"),
    ("Platform administrator for Find Iqar channel review.", "Platform administrator for REB channel review."),
    ("karim@findiqar.com", "karim@realestatebazaar.com"),
    ("nadine@findiqar.com", "nadine@realestatebazaar.com"),
    ("marc@findiqar.com", "marc@realestatebazaar.com"),
    ("'Find Iqar WhatsApp'", "'REB WhatsApp'"),
    ("'@findiqar'", "'@realestatebazaar'"),
    ("'Find Iqar Channel'", "'REB Channel'"),
    ("'FI-ACH-3BR-001'", "'REB-ACH-3BR-001'"),
    ("'FI-DT-PH-002'", "'REB-DT-PH-002'"),
    ("'FI-SV-TH-003'", "'REB-SV-TH-003'"),
    ("'FI-HM-OFF-004'", "'REB-HM-OFF-004'"),
    ("'FI-JN-VL-005'", "'REB-JN-VL-005'"),
    ("'FI-ZB-2BR-006'", "'REB-ZB-2BR-006'"),
    ("'FI-GM-ST-007'", "'REB-GM-ST-007'"),
    ("'FI-JN-SH-008'", "'REB-JN-SH-008'"),
    ("'FI-BB-VL-009'", "'REB-BB-VL-009'"),
    ("'FI-MM-2BR-010'", "'REB-MM-2BR-010'"),
]
for old, new in replacements_seed:
    text = text.replace(old, new)
with open(seed_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] backend/src/seed.js")

# ------------------------------------------------------------------
# 2. backend/src/auth.js
# ------------------------------------------------------------------
auth_path = os.path.join(BASE, "backend", "src", "auth.js")
with open(auth_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("'find-iqar-dev-secret-key-2024'", "'reb-dev-secret-key-2024'")
with open(auth_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] backend/src/auth.js")

# ------------------------------------------------------------------
# 3. backend/src/whatsapp.js
# ------------------------------------------------------------------
wa_path = os.path.join(BASE, "backend", "src", "whatsapp.js")
with open(wa_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("WhatsApp Cloud API client for Find Iqar.", "WhatsApp Cloud API client for REB.")
text = text.replace("'findiqar-whatsapp-verify'", "'reb-whatsapp-verify'")
with open(wa_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] backend/src/whatsapp.js")

# ------------------------------------------------------------------
# 4. backend/src/server.js
# ------------------------------------------------------------------
server_path = os.path.join(BASE, "backend", "src", "server.js")
with open(server_path, "r", encoding="utf-8") as f:
    text = f.read()

text = text.replace("admin@findiqar.com", "admin@realestatebazaar.com")
text = text.replace("Available on Find Iqar", "Available on REB")
text = text.replace("Select at least one Find Iqar channel", "Select at least one REB channel")
text = text.replace("owner_type: 'find_iqar'", "owner_type: 'reb'")
text = text.replace("Find Iqar API running on port ", "REB API running on port ")
text = text.replace("https://findiqar.com/", "https://realestatebazaar.com/")
text = text.replace("https://findiqar.com/sitemap.xml", "https://realestatebazaar.com/sitemap.xml")

with open(server_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] backend/src/server.js")

# ------------------------------------------------------------------
# 5. backend/src/whiteLabel.js
# ------------------------------------------------------------------
wl_path = os.path.join(BASE, "backend", "src", "whiteLabel.js")
with open(wl_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("data-findiqar-widget", "data-reb-widget")
text = text.replace("'fi-widget-'", "'reb-widget-'")
with open(wl_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] backend/src/whiteLabel.js")

# ------------------------------------------------------------------
# 6. src/context/AuthContext.tsx
# ------------------------------------------------------------------
authctx_path = os.path.join(BASE, "src", "context", "AuthContext.tsx")
with open(authctx_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("admin@findiqar.com", "admin@realestatebazaar.com")
with open(authctx_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] src/context/AuthContext.tsx")

# ------------------------------------------------------------------
# 7. src/pages/LoginPage.tsx
# ------------------------------------------------------------------
login_path = os.path.join(BASE, "src", "pages", "LoginPage.tsx")
with open(login_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("karim@findiqar.com", "karim@realestatebazaar.com")
text = text.replace("nadine@findiqar.com", "nadine@realestatebazaar.com")
text = text.replace("marc@findiqar.com", "marc@realestatebazaar.com")
text = text.replace("admin@findiqar.com", "admin@realestatebazaar.com")
with open(login_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] src/pages/LoginPage.tsx")

# ------------------------------------------------------------------
# 8. src/pages/AgentRegisterPage.tsx
# ------------------------------------------------------------------
reg_path = os.path.join(BASE, "src", "pages", "AgentRegisterPage.tsx")
with open(reg_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("on Find Iqar", "on REB")
with open(reg_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] src/pages/AgentRegisterPage.tsx")

# ------------------------------------------------------------------
# 9. src/pages/AgentDashboardPage.tsx
# ------------------------------------------------------------------
dash_path = os.path.join(BASE, "src", "pages", "AgentDashboardPage.tsx")
with open(dash_path, "r", encoding="utf-8") as f:
    text = f.read()

text = text.replace("post to these and/or Find Iqar pages.", "post to these and/or REB pages.")
text = text.replace("Find Iqar never posts to your Instagram", "REB never posts to your Instagram")
text = text.replace("Find Iqar pages", "REB pages")
text = text.replace("Official Find Iqar channels", "Official REB channels")
text = text.replace("Submissions to Find Iqar", "Submissions to REB")
text = text.replace("Find Iqar's official channels", "REB's official channels")
text = text.replace('"Find Iqar Channels"', '"REB Channels"')
text = text.replace("Find Iqar Submission Status", "REB Submission Status")
text = text.replace("'Find Iqar'", "'REB'")
text = text.replace("for Find Iqar channels", "for REB channels")
text = text.replace("Not suitable for Find Iqar channels", "Not suitable for REB channels")
text = text.replace("Review and approve agency submissions for Find Iqar channels", "Review and approve agency submissions for REB channels")

with open(dash_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] src/pages/AgentDashboardPage.tsx")

# ------------------------------------------------------------------
# 10. src/pages/AgencyManagementPage.tsx
# ------------------------------------------------------------------
agency_path = os.path.join(BASE, "src", "pages", "AgencyManagementPage.tsx")
with open(agency_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("Set up your agency on Find Iqar to unlock white-label websites", "Set up your agency on REB to unlock white-label websites")
text = text.replace("Register your real estate agency on Find Iqar", "Register your real estate agency on REB")
with open(agency_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] src/pages/AgencyManagementPage.tsx")

# ------------------------------------------------------------------
# 11. src/pages/WhiteLabelBuilderPage.tsx
# ------------------------------------------------------------------
wlbuild_path = os.path.join(BASE, "src", "pages", "WhiteLabelBuilderPage.tsx")
with open(wlbuild_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace(".findiqar.com", ".realestatebazaar.com")
with open(wlbuild_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] src/pages/WhiteLabelBuilderPage.tsx")

# ------------------------------------------------------------------
# 12. src/pages/WidgetBuilderPage.tsx
# ------------------------------------------------------------------
widget_path = os.path.join(BASE, "src", "pages", "WidgetBuilderPage.tsx")
with open(widget_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("https://findiqar.com/widgets/", "https://realestatebazaar.com/widgets/")
with open(widget_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] src/pages/WidgetBuilderPage.tsx")

# ------------------------------------------------------------------
# 13. src/pages/IntegrationSettingsPage.tsx
# ------------------------------------------------------------------
integ_path = os.path.join(BASE, "src", "pages", "IntegrationSettingsPage.tsx")
with open(integ_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("existing system \u2192 Find Iqar", "existing system \u2192 REB")
text = text.replace("Use <code>external_id</code> to upsert on re-import.", "Use <code>external_id</code> to upsert on re-import.")
with open(integ_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] src/pages/IntegrationSettingsPage.tsx")

# ------------------------------------------------------------------
# 14. src/pages/PublicWhiteLabelSitePage.tsx
# ------------------------------------------------------------------
pub_path = os.path.join(BASE, "src", "pages", "PublicWhiteLabelSitePage.tsx")
with open(pub_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("Back to Find Iqar", "Back to REB")
with open(pub_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] src/pages/PublicWhiteLabelSitePage.tsx")

# ------------------------------------------------------------------
# 15. src/components/ListingFormModal.tsx
# ------------------------------------------------------------------
list_path = os.path.join(BASE, "src", "components", "ListingFormModal.tsx")
with open(list_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("Syndicate to Find Iqar marketplace", "Syndicate to REB marketplace")
text = text.replace('`FI-${form.city.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-5)}`', '`REB-${form.city.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-5)}`')
with open(list_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] src/components/ListingFormModal.tsx")

# ------------------------------------------------------------------
# 16. src/components/dashboard/PromoteDistributeModal.tsx
# ------------------------------------------------------------------
promo_path = os.path.join(BASE, "src", "components", "dashboard", "PromoteDistributeModal.tsx")
with open(promo_path, "r", encoding="utf-8") as f:
    text = f.read()

text = text.replace("Available on Find Iqar / Real Estate Bazaar", "Available on REB")
text = text.replace("request placement on Find Iqar pages", "request placement on REB pages")
text = text.replace("submit to Find Iqar for review", "submit to REB for review")
text = text.replace("Select at least one of your platforms or a Find Iqar page.", "Select at least one of your platforms or a REB page.")
text = text.replace("Find Iqar pages", "REB pages")
text = text.replace("for Find Iqar review team", "for REB review team")

with open(promo_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] src/components/dashboard/PromoteDistributeModal.tsx")

# ------------------------------------------------------------------
# 17. .env.example
# ------------------------------------------------------------------
env_path = os.path.join(BASE, ".env.example")
with open(env_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace("findiqar-whatsapp-verify", "reb-whatsapp-verify")
with open(env_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] .env.example")

# ------------------------------------------------------------------
# 18. package.json (root)
# ------------------------------------------------------------------
pkg_path = os.path.join(BASE, "package.json")
with open(pkg_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace('"find-iqar-realestate"', '"reb-realestate"')
with open(pkg_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] package.json")

# ------------------------------------------------------------------
# 19. backend/package.json
# ------------------------------------------------------------------
bepkg_path = os.path.join(BASE, "backend", "package.json")
with open(bepkg_path, "r", encoding="utf-8") as f:
    text = f.read()
text = text.replace('"find-iqar-backend"', '"reb-backend"')
with open(bepkg_path, "w", encoding="utf-8") as f:
    f.write(text)
print("[DONE] backend/package.json")

# ------------------------------------------------------------------
# 20. Delete db.json
# ------------------------------------------------------------------
db_path = os.path.join(BASE, "backend", "data", "db.json")
if os.path.exists(db_path):
    os.remove(db_path)
    print("[DONE] Deleted backend/data/db.json")
else:
    print("[SKIP] backend/data/db.json not found")

print("\nAll rebranding replacements complete.")
PYEOF
