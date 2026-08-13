# UI Concepts for Site-wide Standardization

**Purpose:** give 3 coherent design directions you can review and select from as the default UI standard.

---

## Concept A — Executive Minimal

### Design intent
A premium, elegant, low-noise interface optimized for clarity and trust.

### Layout anatomy
1. Top page header (title + one primary CTA)
2. KPI strip (4 cards max)
3. Main content (single dominant pane)
4. Secondary insights (right rail, collapsible)

### Component style
- Cards: soft border, low contrast shadow
- Buttons: 1 primary + 1 secondary max in each zone
- Typography: higher contrast headings, calmer body text
- Spacing rhythm: 8/16/24/32 scale

### Best-fit pages
- `CrmAnalyticsPage.tsx`
- `AgentDashboardPage.tsx`
- `PropertyDetailPage.tsx`

### Tradeoff
Less dense controls, more clicks for power users if shortcuts are not added.

---

## Concept B — Operator Command Center

### Design intent
Maximize throughput for agents operating inbox/tasks/opportunities all day.

### Layout anatomy
1. Sticky top action bar
2. Left queue/filter rail
3. Center working pane
4. Right context panel (contact + task + opportunity)

### Component style
- Data-rich list rows with compact metadata
- Sticky quick actions: Reply, Assign, Task, Advance, Close
- Context chips for SLA, unread, stage, overdue
- Keyboard shortcut hints in tooltip

### Best-fit pages
- `InboxPage.tsx`
- `TasksPage.tsx`
- `ContactsPage.tsx`
- `OpportunitiesPage.tsx`

### Tradeoff
Can feel dense if visual hierarchy is not tightly controlled.

---

## Concept C — Guided Workflow Studio

### Design intent
Turn automation into a core product experience with no-code builder UX.

### Layout anatomy
1. Left artifact nav (Audiences, Campaigns, Workflows, Templates)
2. Center canvas/builder
3. Right node/properties panel
4. Bottom simulation trace panel

### Component style
- Graph nodes with explicit types and states
- Branch connectors with condition labels
- Draft/publish/version badges
- Simulation mode with “step-by-step playback”

### Best-fit pages
- `CampaignBuilderPage.tsx` (new)
- `WorkflowBuilderPage.tsx` (new)
- `CampaignsPage.tsx` (new)

### Tradeoff
Largest implementation effort and dependency on backend model maturity.

---

## Standardization matrix

| Criteria | A: Executive Minimal | B: Command Center | C: Workflow Studio |
|---|---:|---:|---:|
| Elegance / visual polish | 9 | 7.5 | 8.5 |
| Fewer-click operational speed | 7 | 9.5 | 8 |
| Workflow builder readiness | 5 | 6 | 10 |
| Marketing automation UX fit | 6 | 7 | 10 |
| Time to implement | 8.5 | 8 | 5.5 |
| Strategic differentiation | 7 | 8 | 10 |

---

## Recommendation

If your objective is to **exceed HubSpot on workflow + automation UX**, select:

## **Concept C** as the strategic standard
with a staged rollout:
1. Start with **Concept B patterns** for inbox/tasks/contacts quick wins.
2. Introduce **Concept C** for campaigns/workflows as the differentiator module.
3. Apply **Concept A visual restraint** to analytics/executive pages.

This creates a hybrid standard: operational speed + builder power + premium polish.

---

## Decision checklist for selection

Pick your preferred concept by answering:
1. Is your near-term KPI response speed and team throughput? → choose **B**
2. Is your near-term KPI automation adoption and campaign sophistication? → choose **C**
3. Is your near-term KPI executive polish and brand trust? → choose **A**

If multiple are true, use the hybrid recommendation above.
