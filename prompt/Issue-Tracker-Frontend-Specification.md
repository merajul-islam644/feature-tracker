# Issue Tracker — Complete Frontend Product, UI/UX & Functional Specification

> **Purpose:** এই document-টি existing SaaS application-এর মধ্যে **Issue Tracker** feature-এর complete **frontend-only implementation** করার জন্য ব্যবহার করা যাবে। Feature-টি application-এর existing Dashboard, Project, Feature এবং Flow functionality-এর সাথে seamlessly integrate করবে।
>
> **Current Scope:** এই phase-এ **শুধু frontend** implement করতে হবে। Real backend, database, AI API, MCP, Playwright execution এবং real credential storage এই phase-এর বাইরে থাকবে। তবে frontend architecture এমনভাবে তৈরি করতে হবে যাতে future phase-এ backend এবং MCP সহজে integrate করা যায়।
>
> **Important:** Existing application-এর design system, routing, authentication, layout, components এবং architecture থাকলে সেগুলো reuse করতে হবে। Existing working functionality ভাঙা যাবে না। Requirements-এর বাইরে implementation-এর সময় reasonable production-grade UX, accessibility, responsive behavior, loading/error/empty states এবং validation যোগ করতে হবে।

---

# 1. Feature Overview

Existing authenticated SaaS application-এর মধ্যে নতুন একটি **Issue Tracker** menu এবং page যোগ করতে হবে।

Issue Tracker হবে একটি **AI-powered Application Verification interface**, যেখানে user:

- AI Assistant-এর সাথে chat করতে পারবে
- একাধিক application URL configure করতে পারবে
- প্রয়োজন অনুযায়ী multiple URL dynamically add/remove করতে পারবে
- verification credentials-এর জন্য Secret UI manage করতে পারবে
- verification scope নির্বাচন করতে পারবে
- verification process শুরু করার UI ব্যবহার করতে পারবে
- per-application verification progress দেখতে পারবে
- detected issues দেখতে পারবে
- application অনুযায়ী issue group দেখতে পারবে
- issue details দেখতে পারবে
- issue-এর evidence দেখতে পারবে
- issue পুনরায় verify করার UI ব্যবহার করতে পারবে

> **Frontend-only phase:** বর্তমানে verification execution mock/service layer দিয়ে simulate করা যেতে পারে। Real browser verification পরে backend + AI Agent + MCP integration-এর মাধ্যমে হবে।

---

# 2. Existing Application Integration

Issue Tracker কোনো standalone application হবে না।

Existing application-এর authenticated layout-এর মধ্যেই এটি নতুন primary menu হিসেবে যুক্ত হবে।

Existing hierarchy:

```text
User
└── Projects
     └── Features
          └── Flows
```

Issue Tracker হবে এই existing hierarchy-এর সাথে connected একটি **cross-project verification layer**।

Future relationship:

```text
Project
└── Feature
     └── Flow
          └── Issue
```

একই সাথে Issue Tracker configured applications এবং verification runs manage করবে।

---

# 3. Sidebar Navigation

Existing sidebar:

```text
Dashboard
Project
```

হয়ে যাবে:

```text
Dashboard
Project
Issue Tracker
```

Issue Tracker-এর জন্য recommended icon:

```text
Bug
```

যদি application Lucide React ব্যবহার করে:

```tsx
import { Bug } from "lucide-react";

{
  to: "/issue-tracker",
  label: "Issue Tracker",
  icon: Bug,
}
```

Sidebar requirements:

- Expanded অবস্থায় icon + label দেখাবে
- Collapsed অবস্থায় icon-only navigation থাকবে
- Issue Tracker active হলে clearly highlighted হবে
- Active route অনুযায়ী state maintain হবে
- Existing sidebar behavior ভাঙা যাবে না

---

# 4. Issue Tracker Route

Required route:

```text
/issue-tracker
```

Page authenticated layout-এর ভিতরে render হবে।

Unauthenticated user protected route access করলে existing application-এর authentication behavior follow করতে হবে।

---

# 5. Issue Tracker Page Layout

Recommended high-level structure:

```text
Issue Tracker
│
├── Header
│
├── AI Assistant
│
├── Verification Targets
│
├── Secrets
│
├── Verification Scope
│
├── Verification Run
│
└── Issues
```

Recommended desktop layout:

```text
┌───────────────────────────────────────────────────────────────┐
│ Issue Tracker                              [Start Verification]│
│ AI-powered application verification                           │
├───────────────────────┬───────────────────────────────────────┤
│ Verification Targets  │ AI Assistant                          │
│                       │                                       │
│ ● MailCraft            │ AI: What would you like to verify?   │
│ ● IAM                  │                                       │
│ ● Data Gateway         │ User: Verify all applications        │
│                       │                                       │
│ + Add URL              │ AI: I found 3 applications...       │
│                       │                                       │
│ Secrets                │ [Start Verification]                 │
│ 🔐 QA Account          │                                       │
│ 🔐 Admin Account       │                                       │
├───────────────────────┴───────────────────────────────────────┤
│ Verification                                                 │
│ ███████████████░░░░ 75%                                     │
├───────────────────────────────────────────────────────────────┤
│ Issues                                                        │
│ Critical 2   High 4   Medium 5   Low 1                       │
└───────────────────────────────────────────────────────────────┘
```

Mobile/tablet-এ sections stacked layout-এ থাকবে।

---

# 6. Issue Tracker Header

Header:

```text
Issue Tracker

AI-powered application verification
```

Right side primary action:

```text
[ Start Verification ]
```

যদি verification already running থাকে:

```text
[ Pause ] [ Stop ]
```

Header requirements:

- Clear page title
- Supporting description
- Primary CTA clearly visible
- Running state অনুযায়ী CTA পরিবর্তন
- Responsive behavior
- Accessible button labels

---

# 7. AI Assistant

AI Assistant Issue Tracker-এর primary interaction layer হবে।

## 7.1 Chat UI

Suggested:

```text
┌───────────────────────────────────────────────┐
│ AI Assistant                                  │
│                                               │
│ 🤖 Hello! What would you like to verify?     │
│                                               │
│ You: Verify all configured applications       │
│                                               │
│ 🤖 I found 3 configured applications.        │
│    Ready to start verification.               │
│                                               │
│    [Start Verification]                       │
│                                               │
│ ────────────────────────────────────────────  │
│ [Ask anything about your application...]  ➤  │
└───────────────────────────────────────────────┘
```

## 7.2 Chat Features

Must support:

- User messages
- Assistant messages
- Chat history
- Scrollable message area
- Input field
- Send button
- Enter-to-send where appropriate
- Disabled state while processing
- Loading indicator
- Error state
- Suggested prompts
- Action buttons inside assistant responses

## 7.3 Suggested Prompts

Show useful prompt suggestions when chat is empty:

```text
Verify all applications
Show critical issues
Check MailCraft login flow
Verify ISSUE-001 again
What changed since the last verification?
```

## 7.4 Frontend-only Mock Chat

Current phase-এ predefined/mock responses ব্যবহার করা যাবে।

Example:

User:

```text
Verify all applications
```

Assistant:

```text
I found 3 configured applications:

• MailCraft
• IAM
• Data Gateway

Ready to start verification.

[Start Verification]
```

User:

```text
Show critical issues
```

Assistant:

```text
I found 2 critical issues:

1. Data Gateway API failure
2. IAM authentication failure

[View Critical Issues]
```

User:

```text
Verify ISSUE-001 again
```

Assistant:

```text
Targeted verification started for ISSUE-001.

✓ Application loaded
✓ Login page found
⟳ Checking login interaction...
```

> এগুলো frontend prototype behavior। এগুলোকে real AI/MCP execution হিসেবে present করা যাবে না।

---

# 8. Future Chat Architecture

Frontend এখন থেকেই service abstraction ব্যবহার করবে।

Current:

```text
React
 ↓
issueTrackerApi
 ↓
Mock Service
```

Future:

```text
React
 ↓
issueTrackerApi
 ↓
Backend API
 ↓
AI Agent
 ↓
MCP
```

Chat UI-এর ভিতরে সরাসরি API implementation বা MCP logic রাখা যাবে না।

---

# 9. Verification Targets

User একাধিক application URL configure করতে পারবে।

UI:

```text
Verification Targets

URL
┌─────────────────────────────────────────┐
│ https://mailcraft.example.com          │
└─────────────────────────────────────────┘

URL
┌─────────────────────────────────────────┐
│ https://iam.example.com                │
└─────────────────────────────────────────┘

              + Add URL
```

## 9.1 Add URL

`Add URL` click করলে নতুন URL input dynamically যুক্ত হবে।

Example:

```text
URL
[input]
[Remove]

URL
[input]
[Remove]

URL
[input]
[Remove]

[+ Add URL]
```

User প্রয়োজন অনুযায়ী multiple URL add করতে পারবে।

## 9.2 Remove URL

প্রতিটি URL input-এর পাশে remove action থাকবে।

Requirements:

- Accessible label
- Confirmation শুধুমাত্র প্রয়োজন হলে
- Removing one URL অন্য URL-এর value নষ্ট করবে না
- At least one empty input initially থাকতে পারে

---

# 10. URL Validation

Frontend validation:

### Valid

```text
https://example.com
https://dev.example.com/login
```

### Invalid

```text
example.com
```

Message:

```text
Please enter a valid URL.
```

Empty:

```text
URL is required.
```

Duplicate:

```text
This URL has already been added.
```

Whitespace-only:

```text
URL is required.
```

Validation preferably inline হবে।

---

# 11. Application Metadata

প্রতিটি configured URL-এর সাথে future-ready metadata structure থাকবে।

Suggested fields:

```text
id
applicationName
url
environment
credentialId
enabled
lastVerifiedAt
lastStatus
createdAt
updatedAt
```

UI-তে optional metadata:

```text
Application Name
Environment
Authentication Required
Credential
Enabled
Last Verified
Status
```

Application name automatically detect করার capability future phase-এ থাকতে পারে।

যদি detect না করা যায়:

```text
applicationName = hostname
```

User application name override করতে পারবে।

---

# 12. Secrets

Secrets section user-কে verification credentials manage করার UI দেবে।

Suggested UI:

```text
Secrets

┌─────────────────────────────────────────────┐
│ Credential Name                             │
│ [ QA Account                           ]    │
│                                             │
│ Email                                       │
│ [ qa@example.com                        ]   │
│                                             │
│ Password                                    │
│ [ •••••••••••••••••                  ] 👁   │
│                                             │
│              [ Add Secret ]                 │
└─────────────────────────────────────────────┘
```

Saved credentials:

```text
┌─────────────────────────────────────────────┐
│ 🔐 QA Account                               │
│ qa@example.com                              │
│                                             │
│ [Edit]                         [Delete]     │
└─────────────────────────────────────────────┘
```

## 12.1 Secret Fields

- Credential Name
- Email
- Password

Optional future field:

```text
Description
```

## 12.2 Password UX

- Password masked by default
- Show/hide button
- Accessible label
- Never display password in plain text unless user explicitly chooses reveal

## 12.3 Frontend-only Security Rule

এই phase-এ:

- Real password persist করা যাবে না
- localStorage/sessionStorage-এ password রাখা যাবে না
- Source code-এ credential hardcode করা যাবে না
- Console log-এ password print করা যাবে না
- Mock credential শুধুমাত্র UI interaction-এর জন্য in-memory state-এ থাকতে পারে

Future:

```text
Frontend
 ↓
Backend
 ↓
Encrypted Secret Store
 ↓
Verification Job
 ↓
Temporary Credential Access
 ↓
MCP
```

---

# 13. Credential Management

Multiple credential sets support করতে হবে।

Example:

```text
QA Account
Staging Account
Admin Account
Read-only Account
```

URL-এর সাথে credential assign করার future-ready UI:

```text
MailCraft
Credential: QA Account
```

অন্য application:

```text
IAM
Credential: Admin Account
```

---

# 14. Test Connection

Full verification শুরু করার আগে lightweight credential test-এর জন্য UI থাকবে।

Button:

```text
[ Test Connection ]
```

Expected states:

```text
Checking URL...
Checking authentication...
```

Success:

```text
✓ URL reachable
✓ Login successful
```

Failure:

```text
✕ Unable to reach URL
```

অথবা:

```text
✕ Authentication failed
```

Current frontend-only phase-এ result mock করা যাবে।

---

# 15. Verification Scope

User verification-এর scope নির্বাচন করতে পারবে।

```text
Verification Scope

☑ Page Load
☑ Navigation
☑ Buttons
☑ Forms
☑ Broken Links
☑ Console Errors
☑ Network Errors
☑ Authentication

☐ Accessibility
☐ Performance
```

Recommended initial checks:

- Page loading
- Navigation
- Buttons
- Forms
- Broken links
- Console errors
- Network errors
- Authentication

Future optional checks:

- Accessibility
- Performance
- Visual regression

---

# 16. Verification Run

Verification process একটি long-running operation হিসেবে UI-তে represent করতে হবে।

Frontend-only phase-এ mock progress ব্যবহার করা যাবে।

Example:

```text
Verification in progress

Applications: 5

████████████░░░░░░░░ 60%

3 / 5 applications verified

✓ MailCraft
✓ IAM
⟳ Data Gateway
○ Localization
○ Blocks Utilities

[Pause] [Stop]
```

---

# 17. Per-Application Verification Status

Possible statuses:

```text
Not Verified
Queued
Verifying
Healthy
Issues Found
Verification Failed
Authentication Failed
Unreachable
Completed
```

Example:

```text
✓ MailCraft
  Healthy

⚠ IAM
  3 Issues

✕ Data Gateway
  Verification Failed

○ Localization
  Waiting
```

Status indicator visually clear হতে হবে।

---

# 18. Verification Progress Details

Current activity দেখাতে হবে:

```text
Current activity

✓ Open application
✓ Check page load
✓ Authenticate
⟳ Inspect navigation
○ Detect UI issues
○ Generate report
```

এটি user-কে verification process-এর progress বুঝতে সাহায্য করবে।

---

# 19. Pause and Stop

Running verification অবস্থায়:

```text
[ Pause ]
[ Stop ]
```

Pause:

```text
Verification Paused
[ Resume ]
```

Stop:

```text
Verification Cancelled
```

Current phase-এ state mock করা যাবে।

---

# 20. Verification Summary

Run complete হলে summary:

```text
Verification Complete

5 Applications
42 Checks
38 Passed
4 Issues Found

Duration
03m 24s
```

Summary cards:

```text
┌───────────┐
│ 5         │
│ Apps      │
└───────────┘

┌───────────┐
│ 42        │
│ Checks    │
└───────────┘

┌───────────┐
│ 38        │
│ Passed    │
└───────────┘

┌───────────┐
│ 4         │
│ Issues    │
└───────────┘
```

---

# 21. Issues Section

Issue Tracker-এর নিচে detected issues display করতে হবে।

Top summary:

```text
Issues

All (12)   Critical (2)   High (4)   Medium (5)   Low (1)
```

Issue card:

```text
┌────────────────────────────────────────────────────────┐
│ 🔴 Login button not working                            │
│ MailCraft · Authentication                             │
│                                                        │
│ High · Open                              ISSUE-001     │
└────────────────────────────────────────────────────────┘
```

---

# 22. Issue Classification

Each issue should have:

```text
Severity
Category
Status
```

Severity:

```text
Critical
High
Medium
Low
```

Categories:

```text
Authentication
Authorization
Navigation
UI
Functional
Forms
API
Performance
Accessibility
Other
```

Current frontend-only phase-এ mock classification ব্যবহার করা যাবে।

---

# 23. Issue Status

Recommended statuses:

```text
Open
Investigating
Confirmed
Fixed
Resolved
Won't Fix
Ignored
Reopened
```

Status change UI future-ready হতে হবে।

---

# 24. Application-based Issue Grouping

Issues application অনুযায়ী group করা হবে।

Example:

```text
Applications

▾ MailCraft
   ├── Authentication
   │   ├── ISSUE-001
   │   └── ISSUE-004
   │
   ├── Navigation
   │   └── ISSUE-007
   │
   └── UI
       └── ISSUE-009

▸ IAM

▸ Data Gateway
```

এটি frontend-এ folder-like UI হিসেবে render হবে।

Actual persistence future backend-এর দায়িত্ব হবে।

---

# 25. Issue Details Drawer

Issue click করলে right-side drawer open করা recommended।

```text
┌─────────────────────────────────────┐
│ Issue Details                 ×     │
├─────────────────────────────────────┤
│ ISSUE-001                           │
│                                     │
│ Login button not working            │
│                                     │
│ Application                         │
│ MailCraft                           │
│                                     │
│ Severity                            │
│ 🔴 High                             │
│                                     │
│ Status                              │
│ Open                                │
│                                     │
│ URL                                 │
│ /login                              │
│                                     │
│ Expected                            │
│ User should be logged in.           │
│                                     │
│ Actual                              │
│ Nothing happens after clicking.     │
│                                     │
│ Evidence                            │
│ [ Screenshot ]                      │
│                                     │
│ [ Verify Again ]                    │
└─────────────────────────────────────┘
```

Drawer requirements:

- Accessible title
- Close button
- Keyboard accessible
- Escape-to-close
- Visible focus
- Responsive mobile behavior

---

# 26. Issue Data Structure

Frontend TypeScript type:

```ts
type IssueSeverity = "critical" | "high" | "medium" | "low";

type IssueStatus =
  | "open"
  | "investigating"
  | "confirmed"
  | "fixed"
  | "resolved"
  | "wont_fix"
  | "ignored"
  | "reopened";

type IssueCategory =
  | "authentication"
  | "authorization"
  | "navigation"
  | "ui"
  | "functional"
  | "forms"
  | "api"
  | "performance"
  | "accessibility"
  | "other";

interface Issue {
  id: string;
  title: string;
  applicationName: string;
  url: string;
  category: IssueCategory;
  severity: IssueSeverity;
  status: IssueStatus;
  description: string;
  expected?: string;
  actual?: string;
  reproductionSteps?: string[];
  screenshotUrl?: string;
  consoleLogs?: string[];
  networkErrors?: string[];
  detectedAt: string;
  verificationRunId?: string;
}
```

---

# 27. Evidence

Issue-এর সাথে evidence section থাকবে।

Possible evidence:

```text
Screenshot
Video
Console logs
Network errors
URL
Timestamp
Agent observation
```

UI:

```text
Evidence

┌──────────────────────┐
│ Screenshot Preview   │
│                      │
│       Image          │
│                      │
└──────────────────────┘

Console
TypeError: ...

Network
GET /api/projects → 500

URL
/projects/123/features
```

Current phase-এ placeholder/mock evidence ব্যবহার করা যাবে।

---

# 28. Re-Verification

Issue details-এর মধ্যে:

```text
[ Verify Again ]
```

থাকবে।

Example:

```text
ISSUE-014
Password reset link broken

[ Verify Again ]
```

Mock flow:

```text
Opening password reset page...
Submitting email...
Checking reset link...

✓ Issue no longer detected

Issue marked as Resolved.
```

Future:

```text
Frontend
 ↓
Backend
 ↓
Targeted Verification Job
 ↓
AI Agent
 ↓
MCP
 ↓
Browser
```

---

# 29. Duplicate Issue Detection

Future-ready UI এবং data structure duplicate issue detection support করবে।

Example:

```text
Existing Issue Found

ISSUE-001
Login button not working

This issue was previously detected.

[Update Existing]
[Create New]
```

Frontend-only phase-এ mock behavior ব্যবহার করা যাবে।

---

# 30. Issue Summary Dashboard

Issue Tracker page-এর top বা Issues section-এর আগে summary cards রাখা recommended।

```text
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│Applications│ │ Open Issues│ │ Critical   │ │ Last Run   │
│     12     │ │     28     │ │      3     │ │ 2m ago     │
└────────────┘ └────────────┘ └────────────┘ └────────────┘
```

Possible metrics:

- Total Applications
- Open Issues
- Critical Issues
- Last Verification
- Total Verification Runs
- Resolved Issues

---

# 31. Issue Filters

Issue list-এর জন্য filters:

```text
Application
Severity
Status
Category
Date
```

Search:

```text
[ Search issues... ]
```

Sorting:

```text
Newest
Oldest
Severity
Application
```

Filter state clear করার option:

```text
[Clear Filters]
```

---

# 32. Future MCP Architecture

> **Important:** MCP এই frontend-only phase-এ implement করা হবে না।

Future architecture:

```text
Existing SaaS
      │
      ↓
Issue Tracker Frontend
      │
      ↓
Backend API
      │
      ↓
AI Agent / Orchestrator
      │
      ├─────────────────────┐
      ↓                     ↓
Application Tools      Browser Tools
      │                     │
      │               Playwright MCP
      │                     │
      │                  Browser
      │                     │
      └──────────┬──────────┘
                 ↓
        Target Application
                 │
                 ↓
          Verification
                 │
        ┌────────┼────────┐
        ↓        ↓        ↓
      Issues   Evidence  Run History
        │        │        │
        └────────┴────────┘
                 ↓
              Database
```

---

# 33. MCP Responsibilities — Future

MCP should provide browser/tool capabilities.

Possible browser tools:

```text
navigate_to_url
get_page_content
click_element
fill_input
select_option
take_screenshot
get_console_messages
get_network_errors
go_back
wait_for_navigation
```

MCP should NOT own application business logic.

MCP should NOT be the primary issue database.

MCP should NOT permanently store user credentials.

---

# 34. AI Agent Responsibilities — Future

AI Agent will decide:

```text
What should be verified?
Which URL should be opened?
Which credential should be used?
Which browser action is required?
Is an observed behavior actually an issue?
Is this issue a duplicate?
What severity should be assigned?
Should an existing issue be updated?
```

Flow:

```text
User request
 ↓
AI Agent
 ↓
Get verification targets
 ↓
Select target
 ↓
Use browser tools
 ↓
Observe application
 ↓
Analyze result
 ↓
Search existing issues
 ↓
Create/update issue
```

---

# 35. Backend Responsibilities — Future

Backend will own:

```text
Authentication
Authorization
User ownership
Verification targets
Secrets
Verification jobs
AI orchestration
MCP connection
Issues
Evidence
Verification history
```

Frontend should not directly own these business rules.

---

# 36. Verification Job Architecture — Future

Long-running verification should not depend on one synchronous HTTP request.

Future:

```text
POST /verification-runs
        ↓
Create Verification Job
        ↓
Queue
        ↓
Worker
        ↓
Process URL 1
        ↓
Process URL 2
        ↓
Process URL 3
        ↓
Complete
```

Possible statuses:

```text
QUEUED
RUNNING
PAUSED
COMPLETED
FAILED
CANCELLED
```

---

# 37. Frontend Service Abstraction

Frontend এখন থেকেই API abstraction ব্যবহার করবে।

Example:

```ts
export const issueTrackerApi = {
  getTargets: async () => {
    // temporary mock
  },

  addTarget: async () => {
    // temporary mock
  },

  removeTarget: async () => {
    // temporary mock
  },

  getIssues: async () => {
    // temporary mock
  },

  startVerification: async () => {
    // temporary mock
  },

  stopVerification: async () => {
    // temporary mock
  },

  sendChatMessage: async () => {
    // temporary mock
  },

  testConnection: async () => {
    // temporary mock
  },
};
```

Later only service implementation should change:

```text
NOW

React
 ↓
issueTrackerApi
 ↓
Mock Data


LATER

React
 ↓
issueTrackerApi
 ↓
Backend API
 ↓
AI Agent / MCP
```

Components-এর ভিতরে backend/mock implementation hardcode করা যাবে না।

---

# 38. Component Architecture

Recommended:

```text
src/
├── pages/
│   └── IssueTracker/
│       └── IssueTrackerPage.tsx
│
├── components/
│   └── issue-tracker/
│       ├── IssueTrackerHeader.tsx
│       │
│       ├── ChatPanel.tsx
│       ├── ChatMessage.tsx
│       ├── ChatInput.tsx
│       ├── SuggestedPrompts.tsx
│       │
│       ├── VerificationTargets.tsx
│       ├── UrlInput.tsx
│       │
│       ├── SecretsPanel.tsx
│       ├── SecretForm.tsx
│       ├── SecretCard.tsx
│       │
│       ├── VerificationScope.tsx
│       ├── VerificationPanel.tsx
│       ├── VerificationProgress.tsx
│       ├── VerificationSummary.tsx
│       │
│       ├── IssueSummary.tsx
│       ├── IssueFilters.tsx
│       ├── IssueList.tsx
│       ├── IssueCard.tsx
│       ├── IssueGroup.tsx
│       ├── IssueDetailsDrawer.tsx
│       └── EvidenceViewer.tsx
│
├── services/
│   └── issueTrackerApi.ts
│
├── types/
│   └── issue-tracker.ts
│
├── data/
│   └── mockIssueTrackerData.ts
│
└── hooks/
    └── useIssueTracker.ts
```

Existing repository architecture different হলে existing convention follow করতে হবে।

---

# 39. State Management

Frontend state আলাদা responsibility অনুযায়ী manage করতে হবে।

Required state:

```text
Chat state
URL targets
Secrets UI state
Verification scope
Verification state
Issue state
Filters
Selected issue
Drawer state
Loading state
Error state
```

Server state এবং UI state আলাদা রাখা preferable।

---

# 40. Mock Data

Frontend-only phase-এর জন্য centralized mock data রাখা যাবে।

Example:

```text
data/
└── mockIssueTrackerData.ts
```

Mock data-এর মধ্যে:

```text
Applications
Credentials
Issues
Verification Runs
Chat responses
Evidence
```

থাকতে পারে।

**Components-এর ভিতরে scattered hardcoded business data রাখা যাবে না।**

---

# 41. Loading States

Required loading states:

```text
Loading targets...
Loading issues...
Testing connection...
Starting verification...
Sending message...
Loading issue details...
```

Buttons:

```text
[Saving...]
[Checking...]
[Starting...]
[Sending...]
```

Duplicate submission prevent করতে হবে।

---

# 42. Empty States

No URLs:

```text
No verification targets yet

Add an application URL to start verification.

[+ Add URL]
```

No secrets:

```text
No credentials configured

Add a credential to verify authenticated applications.

[Add Secret]
```

No issues:

```text
No issues found

Run a verification to detect application issues.
```

No chat history:

```text
Start a conversation

Ask the AI assistant to verify an application
or review existing issues.
```

---

# 43. Error States

Examples:

```text
Unable to load verification targets.
[Retry]
```

```text
Unable to load issues.
[Retry]
```

```text
Unable to start verification.
Please try again.
```

```text
Unable to send message.
[Retry]
```

Technical stack traces user-এর সামনে expose করা যাবে না।

---

# 44. Success Feedback

Examples:

```text
URL added successfully.
Credential added successfully.
Verification started.
Verification stopped.
Issue updated.
```

Toast বা inline feedback ব্যবহার করা যেতে পারে।

---

# 45. Responsive Design

### Desktop

```text
Sidebar + Main Content
```

AI Assistant এবং configuration sections side-by-side হতে পারে।

### Tablet

Sections compact হবে।

### Mobile

Sections vertically stacked হবে:

```text
Header
 ↓
AI Assistant
 ↓
Targets
 ↓
Secrets
 ↓
Scope
 ↓
Verification
 ↓
Issues
```

Requirements:

- No unnecessary horizontal scrolling
- Inputs screen-এর মধ্যে fit হবে
- Drawer full-screen বা near-full-screen হতে পারবে
- Chat usable থাকবে
- Buttons touch-friendly হবে

---

# 46. UI/UX Design Direction

Existing application-এর design specification-এর মতো Issue Tracker-ও হবে:

- Modern SaaS
- Clean
- Professional
- Minimal
- Consistent
- Accessible
- Production-ready

Visual hierarchy:

```text
Primary actions → prominent
Secondary actions → subtle
Danger actions → clearly distinguishable
Empty states → helpful
Loading states → clear
Errors → actionable
```

Avoid:

- Excessive gradients
- Excessive shadows
- Cluttered cards
- Tiny clickable targets
- Inconsistent spacing
- Unnecessary animations

Existing design system থাকলে সেটিই source of truth হবে।

---

# 47. Accessibility

সব interactive element:

- Keyboard accessible
- Semantic HTML ব্যবহার করবে
- Meaningful accessible names থাকবে
- Inputs-এর labels থাকবে
- Dialog/drawer-এর accessible title থাকবে
- Icon-only buttons-এর aria-label থাকবে
- Visible focus state থাকবে
- Keyboard navigation support করবে
- Color alone দিয়ে status communicate করবে না

Chat input এবং issue drawer বিশেষভাবে keyboard accessible হতে হবে।

---

# 48. Security Requirements — Frontend Phase

Even though backend এখন নেই:

- Production secrets hardcode করা যাবে না
- Real password localStorage/sessionStorage-এ রাখা যাবে না
- Console log-এ credentials রাখা যাবে না
- Password masked থাকবে
- Mock credentials clearly isolated থাকবে
- MCP credentials এখন implement করা হবে না
- Frontend-only security-কে final security boundary হিসেবে treat করা যাবে না

Future backend অবশ্যই authorization এবং secure secret storage enforce করবে।

---

# 49. Future Data Model

Future backend-এর জন্য suggested entities:

```text
VerificationTarget

id
userId
applicationName
url
environment
credentialId
enabled
lastVerifiedAt
lastStatus
createdAt
updatedAt
```

```text
Credential

id
userId
name
email
encryptedPassword
createdAt
updatedAt
```

```text
VerificationRun

id
userId
status
totalTargets
completedTargets
failedTargets
startedAt
completedAt
```

```text
Issue

id
userId
applicationName
projectId
featureId
flowId
verificationRunId
title
description
category
severity
status
url
expected
actual
reproductionSteps
evidence
detectedAt
createdAt
updatedAt
```

---

# 50. Existing Project/Feature/Flow Integration

Issue Tracker future-এ existing application hierarchy-এর সাথে issue associate করতে পারবে।

Example:

```text
Project: MailCraft

Feature:
Authentication

Flow:
Login

Issue:
Login button does not work
```

Issue:

```text
Project → MailCraft
Feature → Authentication
Flow → Login
```

এতে Issue Tracker শুধু URL scanner হবে না; existing SaaS-এর functional hierarchy-এর সাথে connected QA layer হবে।

---

# 51. Future Verification Lifecycle

Final system:

```text
Configure URL
      ↓
Assign Credential
      ↓
Test Connection
      ↓
Start Verification
      ↓
AI Agent
      ↓
MCP / Browser
      ↓
Visit Application
      ↓
Run Verification Scope
      ↓
Collect Evidence
      ↓
Analyze Behavior
      ↓
Detect Issue
      ↓
Search Duplicate
      ↓
Create / Update Issue
      ↓
Generate Report
      ↓
Re-verify
      ↓
Resolve / Reopen
```

---

# 52. Recommended Frontend User Journey

```text
Login
  ↓
Dashboard
  ↓
Issue Tracker
  ↓
Add Application URL
  ↓
Add another URL
  ↓
Add Credential
  ↓
Assign Credential
  ↓
Test Connection
  ↓
Select Verification Scope
  ↓
Start Verification
  ↓
View Progress
  ↓
View Issues
  ↓
Open Issue Details
  ↓
Review Evidence
  ↓
Verify Again
```

---

# 53. Frontend-only Scope

## Must Implement Now

- [ ] Issue Tracker menu
- [ ] Issue Tracker route
- [ ] Modern SaaS layout
- [ ] Header
- [ ] AI Assistant UI
- [ ] Chat history
- [ ] Chat input
- [ ] Suggested prompts
- [ ] Mock AI responses
- [ ] Dynamic URL inputs
- [ ] Add URL
- [ ] Remove URL
- [ ] URL validation
- [ ] Duplicate URL validation
- [ ] Secret UI
- [ ] Password visibility
- [ ] Credential cards
- [ ] Credential assignment UI
- [ ] Test Connection UI
- [ ] Verification scope
- [ ] Start Verification UI
- [ ] Mock verification progress
- [ ] Per-application status
- [ ] Pause/Stop UI
- [ ] Verification summary
- [ ] Issue list
- [ ] Issue filters
- [ ] Issue search
- [ ] Issue severity
- [ ] Issue status
- [ ] Issue category
- [ ] Application grouping
- [ ] Issue details drawer
- [ ] Evidence UI
- [ ] Verify Again UI
- [ ] Empty states
- [ ] Loading states
- [ ] Error states
- [ ] Success feedback
- [ ] Responsive design
- [ ] Accessibility
- [ ] TypeScript types
- [ ] Mock data layer
- [ ] Service abstraction

---

# 54. Explicitly Out of Scope for Current Phase

Do NOT implement now:

- [ ] Real backend
- [ ] Real database
- [ ] Real AI API
- [ ] Real AI Agent
- [ ] Real MCP connection
- [ ] Real Playwright execution
- [ ] Real browser automation
- [ ] Real credential storage
- [ ] Real verification queue
- [ ] Real issue persistence
- [ ] Real evidence upload
- [ ] Real duplicate detection
- [ ] Real background workers

These belong to future implementation phases.

---

# 55. Future Phase Plan

## Phase 1 — Current

```text
Frontend
+
Mock Services
+
Mock Verification
```

## Phase 2

```text
Frontend
 ↓
Backend API
 ↓
Database
```

Implement:

- URL persistence
- Credential persistence
- Issues
- Verification runs
- User ownership
- Authorization

## Phase 3

```text
Backend
 ↓
AI Agent
```

Implement:

- Natural language commands
- Verification orchestration
- Issue analysis
- Duplicate detection

## Phase 4

```text
AI Agent
 ↓
Playwright MCP
 ↓
Browser
```

Implement:

- Real URL navigation
- Login
- Browser interactions
- Screenshots
- Console errors
- Network errors
- Evidence collection

## Phase 5

```text
Complete Verification Platform
```

Implement:

- Background jobs
- Real-time progress
- Re-verification
- Issue lifecycle
- Reports
- History
- Analytics

---

# 56. Important Implementation Rules for AI Coding Agent

AI coding agent অবশ্যই:

1. প্রথমে existing repository structure inspect করবে।
2. Existing framework এবং dependencies identify করবে।
3. Existing authentication mechanism inspect করবে।
4. Existing routing inspect করবে।
5. Existing design system/components reuse করবে।
6. Existing sidebar/topbar reuse করবে।
7. Existing backend architecture থাকলেও এই phase-এ backend modification করবে না unless absolutely required for existing frontend compilation.
8. Existing working functionality ভাঙবে না।
9. Issue Tracker-এর জন্য unnecessary dependencies add করবে না।
10. Existing TypeScript conventions follow করবে।
11. Components reusable করবে।
12. Mock data centralized রাখবে।
13. Mock API/service abstraction ব্যবহার করবে।
14. Component-এর ভিতরে backend/MCP logic hardcode করবে না।
15. Password বা credential hardcode করবে না।
16. Real MCP integration implement করবে না।
17. Real Playwright execution implement করবে না।
18. Loading/empty/error/success states বাদ দেবে না।
19. Accessibility requirements follow করবে।
20. Responsive design implement করবে।
21. No unnecessary `any` ব্যবহার করবে।
22. Existing application styling conventions follow করবে।
23. No console errors রাখবে।
24. Existing routes ভাঙবে না।
25. Final implementation-এর পরে lint/typecheck/build চালাবে।
26. Existing tests থাকলে relevant tests run করবে।
27. Frontend-only mock behavior clearly separated রাখবে।
28. Future backend/MCP integration সহজ করার জন্য clean service boundaries রাখবে।

---

# 57. Definition of Done

Feature complete ধরা হবে যখন:

- [ ] Issue Tracker sidebar menu works
- [ ] `/issue-tracker` route works
- [ ] Existing authenticated layout preserved
- [ ] AI Assistant renders correctly
- [ ] Chat input works
- [ ] Chat history works
- [ ] Suggested prompts work
- [ ] Mock assistant responses work
- [ ] Dynamic URL inputs work
- [ ] Add URL works
- [ ] Remove URL works
- [ ] URL validation works
- [ ] Duplicate URL validation works
- [ ] Secrets UI works
- [ ] Password show/hide works
- [ ] Credential cards work
- [ ] Credential assignment UI works
- [ ] Test Connection UI works
- [ ] Verification scope works
- [ ] Start Verification works
- [ ] Mock verification progress works
- [ ] Per-application status works
- [ ] Pause/Stop UI works
- [ ] Verification summary works
- [ ] Issues render correctly
- [ ] Issue filtering works
- [ ] Issue search works
- [ ] Issue grouping works
- [ ] Issue details drawer works
- [ ] Evidence section works
- [ ] Verify Again UI works
- [ ] Loading states work
- [ ] Empty states work
- [ ] Error states work
- [ ] Success feedback works
- [ ] Responsive design works
- [ ] Accessibility basics work
- [ ] TypeScript/static validation passes
- [ ] No console errors
- [ ] Existing application functionality remains intact
- [ ] No real credentials are persisted
- [ ] No MCP integration is required in this phase
- [ ] No real backend is required in this phase

---

# 58. Final Goal

The Issue Tracker should feel like a native part of the existing SaaS application—not a separate demo page.

The frontend experience should communicate the future product clearly:

```text
Existing SaaS
     ↓
Issue Tracker
     ↓
Configure Applications
     ↓
Configure Credentials
     ↓
Ask AI
     ↓
Start Verification
     ↓
Track Progress
     ↓
Detect Issues
     ↓
Review Evidence
     ↓
Verify Again
```

The current implementation is frontend-only, but its architecture must be ready for:

```text
Frontend
   ↓
Backend
   ↓
AI Agent
   ↓
Playwright MCP
   ↓
Browser
   ↓
Target Applications
```

**The goal of this phase is to build the complete, polished frontend experience now while keeping the service boundaries clean enough that backend, AI Agent, and MCP can be added later without redesigning the Issue Tracker UI.**
