# Implementation Plan: TripWise Trip Planner

## Overview

The plan implements the design in TypeScript (npm workspaces, Node.js 20 Lambda, AWS CDK, React + Vite, vitest + fast-check). Work is ordered so the demo path works by the end of week 3: trip, invite, lodging, itinerary, one list (Groceries and Checklist), feasibility check, Bedrock explanation, SNS/EventBridge alerts, and reload.

Suggested schedule for three people (A: backend API, B: web app, C: infrastructure and pure packages):

- Week 1: Tasks 1–7. Scaffold, pure shared/engine/grounding packages, CDK base, web shell.
- Week 2: Tasks 8–11 (A, C) in parallel with Task 12 (B). Guarded API, trips, invites, items, checks, explanation.
- Week 3: Tasks 12–14. Demo screens, seed script, demo scenario test, first deploy.
- Week 4: Tasks 15–16. Expenses and generic sections, optional Schedule/Preferences checks, alarms, optional drafting.

## Tasks

- [x] 1. Scaffold the monorepo and test runner
  - Create root `package.json` with npm workspaces `packages/shared`, `packages/engine`, `packages/grounding`, `services/api`, `infra`, `web`, `scripts`
  - Add `tsconfig.base.json` (strict mode), per-workspace `package.json`/`tsconfig.json`, and `vitest.workspace.ts` so `npx vitest --run` runs every workspace's tests
  - Add dev dependencies: `vitest`, `fast-check`, `zod`, `typescript`, `aws-sdk-client-mock`
  - _Requirements: 28.4_

- [x] 2. Implement the shared domain package (`packages/shared`)
  - [x] 2.1 Create core types and date utilities
    - `src/types.ts`: `IsoDate`, `Trip`, `Membership`, `PlanItem`, `Section`, `CheckName`, `Unit`, `CheckOutcome`, `CheckResult`, `FieldError`, `ValidationResult`
    - `src/dates.ts`: `IsoDateSchema`, `toEpochDay`, `range`, `tripNights` (UTC epoch days, `[start, end)`)
    - _Requirements: 13.4, 14.5, 16.1_

  - [x] 2.2 Implement trip input and Trip_Constraints validation
    - `src/trip.ts`: `validateTripInput` (trimmed non-empty name/destination, end after start, error list names each invalid field)
    - `src/constraints.ts`: strict zod `ConstraintsSchema` (dollar string → `budgetCents`), `totalBudgetLimitCents`
    - _Requirements: 2.2, 2.3, 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 2.3 Write property test for trip input validation
    - **Property 1: Trip input validation**
    - **Validates: Requirements 2.2, 2.3**

  - [x] 2.4 Implement Section parsing and per-Section validators
    - `src/sections.ts`: `SECTIONS`, `parseSection`, strict zod schemas for Lodging, Itinerary, Groceries, Checklist, Expenses, and generic Sections; `validatePlanItem` collects all zod issues plus context rules (trip day range, member set) and maps them to `{ field, message }`
    - Reject client-supplied `claimedBy`, `lastModifiedBy`, `userId`
    - _Requirements: 4.4, 5.5, 5.6, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 8.1, 8.3, 8.4, 9.1, 10.1, 10.2_

  - [ ]* 2.5 Write property test for Section name validation
    - **Property 10: Section name validation**
    - **Validates: Requirements 5.5**

  - [ ]* 2.6 Write property test for Section validators
    - **Property 11: Section validators accept exactly valid items and name every invalid field**
    - **Validates: Requirements 5.6, 6.2, 6.3, 7.2, 7.3, 8.3, 8.4, 10.2**

  - [x] 2.7 Implement the Catalog schema and the San Diego Catalog file
    - `src/catalog.ts`: `CatalogSchema`, `parseCatalog(raw, version)`, `formatEstimate(price)`
    - `catalog/san-diego-v1.json`: at least 3 stays (including `sd-gaslamp-studio` sleeps 2 at $180/night and `sd-northpark-house` sleeps 6 at $450/night), at least 5 activities, a Travel_Time_Table, and an `estimatedAsOf` date on every price
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 27.1_

  - [ ]* 2.8 Write property test for estimate labels
    - **Property 18: Estimated prices are labeled with their date**
    - **Validates: Requirements 12.4**

  - [ ]* 2.9 Write property test for invalid Catalog rejection
    - **Property 19: Invalid catalogs are rejected with their version**
    - **Validates: Requirements 12.5**

  - [ ]* 2.10 Write smoke test for the shipped Catalog
    - Assert `catalog/san-diego-v1.json` passes `CatalogSchema` with ≥ 3 stays, ≥ 5 activities, and `estimatedAsOf` on every price
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 2.11 Implement pure Plan_Item helpers
    - `src/planItems.ts`: `stamp`, `applyUpdate`, `claim`, `confirmationKey` (sanitized, private trip prefix), `lodgingFromCatalogStay`, `groupItinerary`
    - _Requirements: 5.1, 5.2, 6.4, 6.6, 7.4, 8.2, 9.2, 9.3, 9.4, 23.3_

  - [ ]* 2.12 Write property test for write stamping
    - **Property 8: Write stamping**
    - **Validates: Requirements 5.1, 5.2, 8.2, 9.3**

  - [ ]* 2.13 Write property test for optimistic concurrency
    - **Property 33: Optimistic concurrency**
    - **Validates: Requirements 23.3**

  - [ ]* 2.14 Write property test for the Checklist claim transition
    - **Property 15: Checklist claim transition**
    - **Validates: Requirements 9.2, 9.4**

  - [ ]* 2.15 Write property test for confirmation keys
    - **Property 12: Confirmation keys stay under the trip's private prefix**
    - **Validates: Requirements 6.4**

  - [ ]* 2.16 Write property test for Catalog prefill
    - **Property 13: Catalog prefill preserves stay data**
    - **Validates: Requirements 6.6**

  - [ ]* 2.17 Write property test for itinerary grouping
    - **Property 14: Itinerary grouping is an ordered permutation**
    - **Validates: Requirements 7.4**

  - [x] 2.18 Implement message builders, reminder time, and log redaction
    - `src/notify.ts`: `inviteMessage`, `checkResultMessage`, `reminderMessage`, `reminderAt(startDate)` (2 days before, 09:00 America/Los_Angeles), `reminderScheduleName(tripId)`
    - `src/redact.ts`: deep-copy `redact` for door codes, confirmation numbers, check-in details, and tokens (any case, any depth)
    - _Requirements: 3.2, 24.1, 24.2, 24.3, 25.6_

  - [ ]* 2.19 Write property test for notification messages
    - **Property 34: Notification messages carry required fields**
    - **Validates: Requirements 3.2, 24.1, 24.3**

  - [ ]* 2.20 Write property test for reminder time
    - **Property 35: Reminder time is two days before start**
    - **Validates: Requirements 24.2**

  - [ ]* 2.21 Write property test for log redaction
    - **Property 36: Log redaction**
    - **Validates: Requirements 25.6**

- [x] 3. Implement the Feasibility_Engine with the required checks (`packages/engine`)
  - [x] 3.1 Implement Cost, Capacity, and Dates checks and the score
    - `src/checks/cost.ts` (integer cents, `EngineInputError('UNKNOWN_ACTIVITY')`), `src/checks/capacity.ts`, `src/checks/dates.ts`
    - `src/score.ts`: `feasibilityScore`, `scoreLabel`
    - No clock, randomness, I/O, or AWS imports
    - _Requirements: 11.4, 11.5, 13.4, 14.1, 14.2, 14.3, 14.4, 14.5, 15.1, 15.2, 15.3, 16.1, 16.2, 16.3, 19.1, 19.2, 19.3_

  - [x] 3.2 Implement `runChecks`, current-stay selection, and alternative input
    - `src/runChecks.ts`: `EngineInput`/`EngineOutput`, fixed outcome order, normalization of unordered inputs, `tripNights` in output, extension point for optional checks
    - `src/lodging.ts`: `selectCurrentLodging`; `src/alternatives.ts`: `buildAlternativeInput`
    - _Requirements: 13.1, 13.2, 13.4, 13.5, 20.1_

  - [ ]* 3.3 Create shared fast-check arbitraries
    - `test/arbitraries.ts`: `arbIsoDate`, `arbDateRange`, `arbCents`, `arbConstraints`, `arbCatalog`, `arbStay`, `arbItinerary`, `arbEngineInput`, covering the edge cases listed in the design's Testing Strategy
    - _Requirements: 28.1_

  - [ ]* 3.4 Write property test for the Cost check
    - **Property 23: Cost check matches the reference formula**
    - **Validates: Requirements 14.1, 14.3, 14.4, 14.5**

  - [ ]* 3.5 Write property test for the total budget limit
    - **Property 17: Total budget limit**
    - **Validates: Requirements 11.4, 11.5, 14.2**

  - [ ]* 3.6 Write property test for the Capacity check
    - **Property 24: Capacity check**
    - **Validates: Requirements 15.1, 15.2, 15.3**

  - [ ]* 3.7 Write property test for the Dates check
    - **Property 25: Dates check matches night enumeration**
    - **Validates: Requirements 16.1, 16.2, 16.3**

  - [ ]* 3.8 Write property test for score and label
    - **Property 28: Score and label**
    - **Validates: Requirements 19.1, 19.2, 19.3**

  - [ ]* 3.9 Write property test for outcome set and shape
    - **Property 20: Outcome set and shape**
    - **Validates: Requirements 13.1, 13.4**

  - [ ]* 3.10 Write property test for engine determinism
    - **Property 21: Engine determinism**
    - **Validates: Requirements 13.2**

- [x] 4. Implement the grounding package (`packages/grounding`)
  - [x] 4.1 Implement facts projection, prompt, grounding verifier, and template
    - `src/facts.ts`: `toFacts`, `buildPrompt` (system prompt with "use only numbers in FACTS", cents shown as dollars)
    - `src/verify.ts`: `extractNumbers`, `allowedNumbers`, `verifyGrounding`
    - `src/template.ts`: `templateExplanation` (no stay or place names); `src/choose.ts`: `chooseExplanation`
    - _Requirements: 21.1, 21.2, 21.3, 21.4_

  - [ ]* 4.2 Write property test for prompt whitelisting
    - **Property 30: Prompt contains only whitelisted facts**
    - **Validates: Requirements 21.1**

  - [ ]* 4.3 Write property test for grounding verifier soundness
    - **Property 31: Grounding verifier soundness**
    - **Validates: Requirements 21.3**

  - [ ]* 4.4 Write property test for stored explanations
    - **Property 32: Stored explanations are always grounded**
    - **Validates: Requirements 21.4, 21.5, 27.4**

  - [ ]* 4.5 Write unit tests for grounding examples
    - `"$2,850.00"`, `"2850"`, `"75%"`, a template explanation, and `"$350 over"` (rejected)
    - _Requirements: 28.3_

- [x] 5. Build the AWS CDK infrastructure base (`infra`)
  - [x] 5.1 Define data, auth, and web hosting constructs
    - `lib/constructs/data.ts`: DynamoDB table (on-demand, AWS-managed encryption, PITR, GSI1), `DataBucket` (block all public access, S3-managed encryption, enforceSSL, versioning), SNS topic with SSE
    - `lib/constructs/auth.ts`: Cognito user pool (verified email) and PKCE client with Hosted UI domain
    - `lib/constructs/web.ts`: `WebBucket`, CloudFront distribution with OAC, `BucketDeployment` for `web/dist` and `catalog/`
    - _Requirements: 1.1, 12.1, 25.2, 25.4, 25.5_

  - [x] 5.2 Define the API construct and stack
    - `lib/constructs/api.ts`: HTTP API with `HttpUserPoolAuthorizer` default, CORS limited to the CloudFront domain, seven `NodejsFunction`s (`trips`, `invites`, `items`, `catalog`, `checks`, `explain`, `reminder`) pointing at `services/api/src/handlers/*.ts`, one explicit IAM role per function with the design's action/ARN table, scheduler role, env vars (`TABLE_NAME`, `CATALOG_VERSION`, `ENABLED_CHECKS`, `MODEL_ID`, `TOPIC_ARN`), explain-fn 10 s timeout
    - `lib/tripwise-stack.ts` and `bin/app.ts` with a single region from CDK context
    - _Requirements: 1.3, 25.1, 25.2, 25.3_

- [x] 6. Build the web app shell (`web`)
  - [x] 6.1 Scaffold Vite + React with authentication and the API client
    - `src/main.tsx`, `src/auth/amplify.ts` (Hosted UI, PKCE, tokens in memory), `src/auth/RequireAuth.tsx`, `src/api/client.ts` (always sends `Authorization: Bearer <idToken>`)
    - _Requirements: 1.1, 1.2_

  - [ ]* 6.2 Write React Testing Library tests for the auth gate and API client
    - RequireAuth shows sign-in until a session exists; apiClient sets the bearer header
    - _Requirements: 1.1, 1.2_

- [x] 7. Checkpoint - Core packages pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Build the API foundation (`services/api`)
  - [x] 8.1 Implement caller identity, HTTP helpers, and request logging
    - `src/lib/caller.ts`: `getCaller` (claims only), `src/lib/http.ts`: `json`, error mapping table, `parseTripId`
    - `src/lib/logging.ts`: `withRequestLogging` (one JSON line with requestId, route, status, durationMs, all payloads through `redact`), Powertools Metrics in namespace `TripWise`
    - _Requirements: 4.4, 25.6, 26.1_

  - [x] 8.2 Implement repositories with DynamoDB adapters and in-memory fakes
    - `src/repos/interfaces.ts`: trips, memberships, invitations, constraints, planItems, checkResults
    - `src/repos/dynamo/*.ts`: single-table keys, `ConsistentRead: true`, paginated section queries, `TransactWriteItems` for trip creation and invite acceptance, conditional updates for `lastModifiedAt` and `claimedBy`, history with `ScanIndexForward: false`
    - `src/repos/memory/*.ts`: fakes implementing the same interfaces and recording calls
    - _Requirements: 2.1, 2.4, 3.3, 5.4, 9.4, 13.6, 23.2, 23.3_

  - [x] 8.3 Implement the Membership_Guard
    - `src/lib/guard.ts`: pure `decide(membership, action)` and `withTripGuard(action, handler)` doing only the Membership lookup before the guard decision
    - _Requirements: 3.4, 4.1, 4.2, 4.3_

  - [ ]* 8.4 Write property test for the access decision
    - **Property 5: Access decision**
    - **Validates: Requirements 3.4, 4.2, 4.3**

- [x] 9. Implement trips, invitations, notifications, and the reminder
  - [x] 9.1 Implement SNS and Scheduler adapters
    - `src/adapters/notify.ts`: `safePublish` (per-recipient `recipient` attribute, logs `SNS_PUBLISH_FAILED`, never throws), `subscribeRecipient`
    - `src/adapters/scheduler.ts`: `upsertReminder` (CreateSchedule, UpdateSchedule on `ConflictException`, skip past times, `ActionAfterCompletion: DELETE`, logs `SCHEDULE_FAILED`)
    - _Requirements: 3.2, 24.2, 24.4_

  - [x] 9.2 Implement the trips handler
    - `src/handlers/trips.ts`: `POST /trips`, `GET /trips`, `GET /trips/{tripId}`, `PUT`/`GET /trips/{tripId}/constraints`; create or update the reminder on trip creation and start-date change; export its route list
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 11.1, 11.2, 11.3, 23.1, 24.2_

  - [ ]* 9.3 Write property test for trip creation
    - **Property 2: Created trip has its creator as Host and Member**
    - **Validates: Requirements 2.1**

  - [ ]* 9.4 Write property test for the trip list
    - **Property 3: Trip list is exactly the caller's memberships**
    - **Validates: Requirements 2.4**

  - [ ]* 9.5 Write property test for constraints validation and round trip
    - **Property 16: Constraints validation and round trip**
    - **Validates: Requirements 11.1, 11.2, 11.3**

  - [x] 9.6 Implement the invitations handler
    - `src/handlers/invites.ts`: `POST /trips/{tripId}/invitations` (guard action `invite`, store pending lowercase email, subscribe and publish invite alert with accept link), `POST /invitations/{inviteId}/accept` (verified matching email, else 403 with no writes); export its route list
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 9.7 Write property test for invitation acceptance
    - **Property 4: Invitation acceptance requires a matching verified email**
    - **Validates: Requirements 3.3, 3.5**

  - [x] 9.8 Implement the reminder handler
    - `src/handlers/reminder.ts`: load Trip and Members and publish `reminderMessage` to every Member
    - _Requirements: 24.3_

  - [ ]* 9.9 Write unit tests for notification failure handling and the reminder
    - SNS publish failure still returns 201 for trip creation and invitation; reminder publishes once per Member
    - _Requirements: 24.3, 24.4_

- [x] 10. Implement the Plan_Item API
  - [x] 10.1 Implement Plan_Item CRUD, claim, and concurrency
    - `src/handlers/items.ts`: list, create, update (requires `expectedLastModifiedAt`, 409 `STALE` with stored item), delete, and Checklist claim (409 `ALREADY_CLAIMED`); stamping from the token caller; validation context built from Trip dates and member set; export its route list
    - _Requirements: 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.2, 9.2, 9.3, 9.4, 23.2, 23.3_

  - [x] 10.2 Implement confirmation file upload and download
    - `src/adapters/s3.ts` plus routes in `src/handlers/items.ts`: presigned POST (5 min, pinned content type, 10 MB max) under `confirmationKey`, record the key on the Lodging item; presigned GET with `expiresIn: 900`
    - _Requirements: 6.4, 6.5_

  - [ ]* 10.3 Write property test for the Plan_Item store round trip
    - **Property 9: Plan item store round trip**
    - **Validates: Requirements 5.3, 5.4**

  - [ ]* 10.4 Write property test for caller identity
    - **Property 7: Caller identity comes only from the token**
    - **Validates: Requirements 4.4**

  - [ ]* 10.5 Write unit tests for presigned URLs and conditional-write mapping
    - Download URL `expiresIn ≤ 900`; key under the trip's private prefix; DynamoDB `ConditionalCheckFailedException` maps to 409
    - _Requirements: 6.5, 9.4, 23.3_

- [x] 11. Implement the catalog, explanation, and checks API, then wire routes
  - [x] 11.1 Implement Catalog loading and the catalog handler
    - `src/adapters/catalog.ts`: S3 `GetObject` for `CATALOG_VERSION`, `parseCatalog`, warm-cache by version, log `CATALOG_INVALID`
    - `src/handlers/catalog.ts`: `GET /catalog`, 500 `{ error: 'CATALOG_INVALID', version }` on schema failure
    - _Requirements: 12.1, 12.5_

  - [x] 11.2 Implement the explanation handler
    - `src/handlers/explain.ts`: read Check_Result, `toFacts`/`buildPrompt`, Bedrock `ConverseCommand` (temperature 0, maxTokens 300, 10 s abort), `chooseExplanation`, store `explanation` and `explanationSource`, log `EXPLANATION_FALLBACK` and emit `TemplateFallbackCount`
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 26.3_

  - [x] 11.3 Implement the checks handler
    - `src/handlers/checks.ts`: `POST /trips/{tripId}/checks` (load lodging, transport, itinerary, constraints, Catalog; 422 `MISSING_INPUT`/`UNKNOWN_ACTIVITY`; `runChecks` with `ENABLED_CHECKS`; save Check_Result; invoke explain-fn with template fallback on failure; SNS check-result alert per Member; `CheckRunDurationMs` and `FailedCheckCount` metrics)
    - `GET /trips/{tripId}/checks` newest first; `POST /trips/{tripId}/checks/alternatives` (422 `NO_BASE_RESULT`, saves `kind: 'alternative'` with `evaluatedStay.stayId`, no Plan_Item writes); export its route list
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 13.6, 20.1, 20.2, 21.6, 24.1, 26.2_

  - [ ]* 11.4 Write property test for alternatives
    - **Property 29: Alternatives reuse checks and leave the plan unchanged**
    - **Validates: Requirements 20.1, 20.2**

  - [ ]* 11.5 Write property test for check history order
    - **Property 22: History is newest first**
    - **Validates: Requirements 13.6**

  - [ ]* 11.6 Write unit tests for the explanation handler
    - Mock Bedrock with `aws-sdk-client-mock` for success, error, and timeout (fake timers); assert the "use only numbers" instruction, stored source, and fallback metric
    - _Requirements: 21.2, 21.5, 21.6, 26.3_

  - [ ]* 11.7 Write unit tests for the checks handler
    - 422 for missing lodging, missing constraints, unknown activity, and no base result; check-result alert per Member; run metrics emitted; Check_Result saved with timestamp, stay, Catalog version, outcomes, score
    - _Requirements: 13.3, 13.5, 24.1, 26.2_

  - [x] 11.8 Aggregate the route table and wire the guard
    - `src/routes.ts`: combine the route lists from every handler; register each `/trips/{tripId}/*` route through `withTripGuard` with the design's guard action; wrap every Lambda export with `withRequestLogging`
    - _Requirements: 4.1, 4.2, 26.1_

  - [ ]* 11.9 Write property test for no data access before the guard
    - **Property 6: No trip data access before a successful guard**
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 11.10 Write unit test for the guard over the route table
    - Iterate every `/trips/{tripId}/*` route with a non-member fake and assert 403 with no trip data
    - _Requirements: 28.2_

  - [ ]* 11.11 Write CDK assertion tests
    - `infra/test/stack.test.ts`: single region, resource inventory, distinct role per function, no wildcard resources except where AWS requires, blocked public access, encryption, OAC origin, authorizer on every route
    - _Requirements: 1.3, 25.1, 25.2, 25.3, 25.4, 25.5_

- [x] 12. Build the demo-path web screens (`web`)
  - [x] 12.1 Implement trip list, trip creation, invitations, and trip page loading
    - `src/api/trips.ts`, `src/pages/TripsPage.tsx`, `src/pages/AcceptInvite.tsx`, `src/pages/TripPage.tsx` (fetch Plan_Items, constraints, and latest Check_Result on every load or reload)
    - _Requirements: 2.4, 3.1, 3.3, 23.1_

  - [x] 12.2 Implement the Lodging section
    - `src/sections/Lodging.tsx` with Catalog stay picker (prefill via `lodgingFromCatalogStay`, `formatEstimate` labels), confirmation upload and download
    - `src/components/LastModified.tsx` and `src/components/StaleConflict.tsx` (shows the stored item on 409)
    - _Requirements: 5.7, 6.1, 6.4, 6.5, 6.6, 12.4, 23.3_

  - [x] 12.3 Implement the Itinerary, Groceries, and Checklist sections
    - `src/sections/Itinerary.tsx` (grouped via `groupItinerary`), `src/sections/Groceries.tsx` (purchased toggle), `src/sections/Checklist.tsx` (claim and done)
    - _Requirements: 7.1, 7.4, 8.1, 8.2, 9.1, 9.2, 9.3_

  - [x] 12.4 Implement the constraints form and checks panel
    - `src/sections/Constraints.tsx`; `src/checks/ChecksPanel.tsx` (run check, outcome table with name/measured/limit/unit/status, label, failed list, explanation and source, history); `src/checks/AlternativeView.tsx` (side by side with latest non-alternative result)
    - _Requirements: 11.1, 13.6, 19.2, 19.3, 19.4, 20.3, 21.6_

  - [x] 12.5 Wire sections and checks into the trip page
    - Update `src/pages/TripPage.tsx` with tabs for Lodging, Itinerary, Groceries, Checklist, Constraints, and Checks
    - _Requirements: 4.3, 23.1_

  - [ ]* 12.6 Write React Testing Library tests for trip page and section forms
    - Fetch on load; lastModified display; Lodging, Itinerary, Groceries, and Checklist form fields
    - _Requirements: 5.7, 6.1, 7.1, 8.1, 9.1, 23.1_

  - [ ]* 12.7 Write React Testing Library tests for the checks panel
    - Outcome table, "Feasible"/"Not feasible" label with failed list, alternative side-by-side view
    - _Requirements: 19.3, 19.4, 20.3_

- [x] 13. Implement the demo seed and scenario test
  - [x] 13.1 Write the seed script
    - `scripts/seed.ts`: 4 Cognito test users, Trip 2025-06-12 to 2025-06-16, constraints (4 travelers, $2,500 total), selected Lodging `sd-gaslamp-studio`, sample itinerary and groceries
    - _Requirements: 27.1_

  - [ ]* 13.2 Write the demo scenario integration test
    - Engine on seed input: Capacity fails with measured 2, limit 4; switching to `sd-northpark-house` passes every check; `chooseExplanation` output passes `verifyGrounding`
    - _Requirements: 27.2, 27.3, 27.4_

- [x] 14. Checkpoint - Demo path works end to end
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Complete remaining sections and extensions
  - [x] 15.1 Implement Expenses and generic Section screens
    - `src/sections/Expenses.tsx` (payer, amount, purpose, no payment actions), `src/sections/GenericSection.tsx` for Transportation, Reservations, and ScratchPad; add tabs in `src/pages/TripPage.tsx`
    - _Requirements: 5.8, 10.1, 10.3_

  - [ ]* 15.2 Write React Testing Library tests for Expenses and generic sections
    - Create/view/edit/delete for generic Sections; no payment, transfer, or settlement controls in Expenses
    - _Requirements: 5.8, 10.3_

  - [x] 15.3 Implement the Schedule check (optional extension)
    - `packages/engine/src/checks/schedule.ts` and registration in `src/runChecks.ts` behind `ENABLED_CHECKS`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 15.4 Implement the Preferences check (optional extension)
    - `packages/engine/src/checks/preferences.ts` and registration in `src/runChecks.ts`
    - _Requirements: 18.1, 18.2, 18.3_

  - [ ]* 15.5 Write property test for the Schedule check
    - **Property 26: Schedule check matches a reference model**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5**

  - [ ]* 15.6 Write property test for the Preferences check
    - **Property 27: Preferences check**
    - **Validates: Requirements 18.1, 18.2, 18.3**

  - [ ] 15.7 Add CloudWatch alarms
    - `infra/lib/constructs/observability.ts` (Lambda `Errors > 0` per function, API 5xx rate, `TemplateFallbackCount > 3` per hour) wired in `lib/tripwise-stack.ts`
    - _Requirements: 25.2, 26.2, 26.3_

  - [ ] 15.8 Superseded by task 21
    - Do not implement. Scratch pad drafting (Requirement 22, design section 8a) is now covered by task 21; the trip summary and `ENABLE_DRAFTING` flag were dropped from the design. Leave this item unchecked.

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Replace the CDK stack with Terraform
  - [x] 17.1 Write the Lambda build script
    - `scripts/build-lambdas.ts` (or `.mjs`): bundle the 7 handlers in `services/api/src/handlers/*.ts` (`trips`, `invites`, `items`, `catalog`, `checks`, `explain`, `reminder`) with esbuild (platform node, target `node20`, arm64-compatible, AWS SDK bundled) and zip each into `dist/lambda/<name>.zip`
    - Add npm script `build:lambdas` to the root `package.json`; ignore `dist/` in `.gitignore`
    - _Requirements: 25.2, 25.3_

  - [x] 17.2 Define Terraform data, auth, and web hosting resources
    - `terraform/` root module with AWS provider and a single `region` variable (default `us-west-2`)
    - DynamoDB table with `GSI1` (on-demand, PITR, SSE); `DataBucket` (all public access blocked, SSE-S3, TLS-only bucket policy, versioning); SNS topic with SSE (`alias/aws/sns`)
    - `WebBucket` and CloudFront distribution with OAC (bucket policy limited to the distribution) and SPA error responses (403/404 → `/index.html`)
    - Cognito user pool (verified email), PKCE user pool client, and Hosted UI domain
    - _Requirements: 1.1, 1.3, 12.1, 25.1, 25.2, 25.4, 25.5_

  - [x] 17.3 Define the Terraform API and functions
    - HTTP API with Cognito JWT authorizer on every route, CORS limited to the CloudFront domain, and routes matching `services/api/src/routes.ts`
    - 7 Lambda functions from `dist/lambda/*.zip` (Node.js 20, arm64, `source_code_hash`), each with its own IAM role per the design's action/ARN table and its own log group; env vars `TABLE_NAME`, `CATALOG_VERSION`, `ENABLED_CHECKS`, `MODEL_ID`, `TOPIC_ARN`; explain-fn 10 s timeout, checks-fn 20 s
    - Scheduler role (`lambda:InvokeFunction` on reminder-fn only); `aws_lambda_permission` for API Gateway and for the scheduler
    - Outputs: `AppUrl`, `ApiUrl`, `UserPoolId`, `UserPoolClientId`, `CognitoDomain`, `DataBucketName`, `TableName`, `ReminderFunctionArn`, `SchedulerRoleArn`
    - _Requirements: 1.3, 4.1, 24.2, 25.1, 25.2, 25.3, 26.1_

  - [x] 17.4 Write the deploy script and remove the CDK app
    - `scripts/deploy.sh`: run `build:lambdas`, `terraform apply`, write `web/.env.local` from Terraform outputs, build the web app, `aws s3 sync` `web/dist` to `WebBucket` and `catalog/` to `DataBucket` under `catalog/`, then create a CloudFront invalidation
    - Delete `infra/` (including its CDK tests) and remove its entry from the root `package.json` workspaces and `vitest.workspace.ts`
    - Update `services/api/src/routes.test.ts` so the route check compares `routes.ts` against the routes declared in `terraform/` instead of `infra/lib/constructs/api.ts`
    - _Requirements: 1.3, 12.1, 25.2, 26.1, 28.2_

  - [x] 17.5 Checkpoint - Terraform validates and all tests pass
    - Run `terraform fmt -check`, `terraform init -backend=false`, and `terraform validate` in `terraform/`; run all vitest tests and typechecks
    - Run `terraform plan` only if AWS credentials exist; never run `terraform apply`
    - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Add a basic stylesheet for the web app
  - `web/src/styles.css` imported once in `web/src/main.tsx`: plain CSS, no new dependencies; page layout and header, tab bar for TripPage, forms and inline field errors, buttons, tables (checks outcome table with pass/fail colors), the `stale-conflict` alert and `last-modified` text, AlternativeView side-by-side layout, responsive for narrow screens
  - Add `className`s to existing components only where needed for the styles; no behavior changes
  - _Requirements: 5.7, 19.2, 19.3, 19.4, 20.3, 23.3_

- [x] 19. Switch the Bedrock model to Amazon Nova Lite
  - Set the `model_id` default in `terraform/variables.tf` to `amazon.nova-lite-v1:0` (the explain-fn IAM permission in `terraform/iam.tf` is derived from it)
  - Confirm `services/api/src/handlers/explain.ts` Converse request works with Nova (system prompt, temperature 0, maxTokens 300) and update test fixtures/defaults that still reference the Claude model ID
  - Replace remaining Claude model references in code and scripts (not spec docs) with the Nova Lite ID
  - _Requirements: 21.1, 21.2, 25.3_

- [x] 20. Rework the web UI into a polished app (plain CSS)
  - Follow design section "12. Web UI design". Plain CSS only, no new UI or CSS libraries; React 18 + Vite as present. Reuse the API modules in `web/src/api/*.ts`; no backend or API changes.
  - [x] 20.1 Design tokens, UI primitives, and app shell
    - Rewrite `web/src/styles.css` around CSS custom properties for color (light theme, one accent; pass green, fail red, warning amber), spacing, radius, shadow, and typography; global `:focus-visible` ring and a `prefers-reduced-motion` block
    - Create `web/src/ui/` primitives: `Button`, `IconButton`, `Card`, `Badge`, `Avatar`/`AvatarStack` (from Member display names), `ProgressBar`, `ScoreRing`, `Dialog`, `ConfirmDialog`, `Drawer`, `ToastProvider` + `useToast`, `Skeleton`, `EmptyState`, `Tabs`, `Field`/`TextInput`/`Select`/`Checkbox`, plus an `index.ts` barrel; include the ARIA roles, focus trap, and Escape handling from the design
    - Mount `ToastProvider` in `web/src/main.tsx`; add the top bar (logo, current user name or email, Sign out) and breadcrumbs in `web/src/main.tsx`/`web/src/router.tsx`
    - Preserve existing behavior, props used by other components, routing, auth gating, and API calls
    - _Requirements: 1.1, 19.2, 19.3, 19.4, 23.3_

  - [x] 20.2 Trips home and invite acceptance
    - Rework `web/src/pages/TripsPage.tsx`: trip cards (destination, dates, Role, member avatars and latest check status when available), "New trip" Dialog that still runs `validateTripInput` before create, EmptyState, Skeleton cards while loading, friendly error state
    - Rework `web/src/pages/AcceptInvite.tsx` with clear success (link to the trip) and error states
    - Preserve existing behavior, props used by other components, and API calls
    - _Requirements: 2.1, 2.4, 3.1_

  - [x] 20.3 Trip page shell and Overview tab
    - Rework `web/src/pages/TripPage.tsx`: header with name, destination, dates, days-until countdown, member avatars, Invite button opening a Dialog with the existing invitation form; `Tabs` with Overview first, then the existing section, Constraints, and Checks tabs
    - Create `web/src/pages/TripOverview.tsx`: selected stay card, budget used vs limit from the latest Check_Result Cost outcome, ScoreRing with label, checklist done/total, groceries purchased/total, next itinerary stops, quick actions; uses data `TripPage` already loads (no new endpoints)
    - Preserve existing behavior, load-time fetches, props passed to section components, and API calls
    - _Requirements: 3.1, 7.4, 13.6, 19.2, 19.3, 23.1_

  - [x] 20.4 Lodging and Itinerary sections
    - Rework `web/src/sections/Lodging.tsx`: stay cards, catalog picker as cards with "Estimated as of <date>" labels, Selected badge, confirmation upload/download, Drawer add/edit form, ConfirmDialog on delete, toasts on save/delete/conflict
    - Rework `web/src/sections/Itinerary.tsx` as a day-by-day timeline ordered by start time, with Drawer form and EmptyState
    - Preserve existing behavior, validators, props used by other components, and API calls
    - _Requirements: 5.7, 6.1, 7.4, 23.3_

  - [x] 20.5 Lists and simple sections
    - Rework `web/src/sections/Groceries.tsx`, `Checklist.tsx`, `Expenses.tsx`, `GenericSection.tsx`, and `planSectionHelpers.tsx`: item cards, "Add" opens a Drawer form, inline checkbox toggles (purchased, done), Member names instead of IDs, EmptyStates, ConfirmDialog before delete, toasts on save/delete/conflict, `lastModified` on each card; Expenses keeps no payment controls
    - Preserve existing behavior, validators, props used by other components, and API calls
    - _Requirements: 5.7, 8.1, 9.1, 10.1, 10.3, 23.3_

  - [x] 20.6 Constraints and Checks
    - Rework `web/src/sections/Constraints.tsx` as grouped form cards with inline errors and a save toast
    - Rework `web/src/checks/ChecksPanel.tsx`: Feasible / Not feasible banner with ScoreRing, one card per check with a measured-vs-limit bar and unit-aware formatting, failed checks first, Bedrock explanation in a highlighted box with a source Badge, history as a compact newest-first list
    - Rework `web/src/checks/AlternativeView.tsx` as side-by-side cards; extend `web/src/checks/format.ts` helpers as needed
    - Preserve existing behavior, props used by other components, and API calls
    - _Requirements: 11.1, 13.6, 19.2, 19.3, 19.4, 20.3, 21.6_

  - [x] 20.7 Responsive, accessibility, and consistency pass
    - Review every screen at widths down to 360px (stacked cards, horizontally scrolling tabs, full-width Drawer); keyboard focus order and visible focus; ARIA on dialogs, tabs, and toasts; `prefers-reduced-motion`
    - Use shared Skeleton loading and error-with-Retry states everywhere; update `web/src/components/LastModified.tsx` and `StaleConflict.tsx` styling to match; remove leftover unused CSS from `web/src/styles.css`
    - Preserve existing behavior, props used by other components, and API calls
    - _Requirements: 5.7, 19.4, 23.1, 23.3_

  - [ ]* 20.8 Write React Testing Library smoke tests for UI primitives and TripsPage
    - Dialog traps focus and closes on Escape; Toast appears in the live region; Tabs arrow-key navigation and `aria-selected`; TripsPage shows the EmptyState with no trips
    - Add jsdom and React Testing Library dev dependencies to `web/package.json` only in this task
    - Preserve existing behavior, props used by other components, and API calls
    - _Requirements: 2.4, 19.4_

  - [x] 20.9 Checkpoint - Web UI builds and all tests pass
    - Run the web typecheck, `npm run build -w web`, and all vitest tests
    - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Implement scratch pad drafting with Bedrock
  - Follow design section "8a. Scratch Pad Drafting (Req 22)", the drafting rows in sections 10 and 11, and the Scratch pad drafting paragraph in section 12. No feature flag, no trip summary, and the drafts route never writes Plan_Items.
  - [x] 21.1 Implement the pure drafting helpers in `packages/grounding`
    - `packages/grounding/src/drafting.ts`: `DRAFTING_SECTIONS`, `DraftingSection`, `MAX_DRAFT_NOTES` (4,000), `MAX_DRAFT_ITEMS` (20), `DRAFT_FIELDS`, `DraftPromptInput`, `DraftItem`, `DraftResponse`, `DraftRequestSchema` (strict zod), and the functions `buildDraftPrompt`, `parseDraftResponse`, `filterDraftSections`, `resolveMemberName`, `groundDraftCosts` as specified in the design
    - `buildDraftPrompt` takes only `DraftPromptInput` (notes, trip dates, destination, optional traveler count, Member display names) and puts the JSON-only instruction, field list, schema example, and `<notes>` delimiters in the prompt
    - `parseDraftResponse` strips code fences, takes the first JSON array or object (accepting `items`/`drafts` arrays), skips malformed entries, and returns `ok: false` only when nothing parses
    - `resolveMemberName` trims and matches case-insensitively, returning a userId only for exactly one match; `groundDraftCosts` keeps `costCents` (as cents or cents/100) and `amount` only when found by the existing `extractNumbers` on the notes
    - Export everything from `packages/grounding/src/index.ts`
    - Unit tests in `packages/grounding/src/drafting.test.ts`: prompt contents and exclusions, fenced and prose-wrapped JSON, non-JSON output, section filtering before the 20-item cap, ambiguous and unknown names, grounded and ungrounded costs
    - _Requirements: 22.5, 22.6, 22.8, 22.9, 22.10, 22.11, 22.12, 22.13, 22.14_

  - [ ]* 21.2 Write property tests for drafting
    - **Property 37: Draft prompt contains only whitelisted data**
    - **Property 38: Draft parsing keeps the first 20 items in Drafting_Sections**
    - **Property 39: Prepared drafts keep only resolved people and grounded costs**
    - **Property 40: Draft validity matches the Section validator and nothing is stored** (runs the drafts handler from 21.3 against the in-memory repository fakes)
    - **Validates: Requirements 22.5, 22.6, 22.8, 22.9, 22.10, 22.11, 22.12, 22.13, 22.14, 22.15, 22.16, 22.17**

  - [x] 21.3 Implement the drafts handler and wire its route
    - `services/api/src/handlers/drafts.ts`: `routes` with one entry `{ routeKey: 'POST /trips/{tripId}/drafts', guard: 'write', run }` and `handler = dispatch(routes, getDeps)`, so the Membership lookup is the only read before the guard
    - Validate the body with `DraftRequestSchema`; emit `DraftRequestCount = 1`; load Trip `META`, `CONSTRAINTS` (traveler count optional), Memberships, and the selected ScratchPad items with `ConsistentRead`; return 400 `VALIDATION` for an unknown itemId or Draft_Notes empty or over 4,000 characters, without calling Bedrock
    - Call Bedrock `ConverseCommand` with `MODEL_ID`, temperature 0, maxTokens 1500, and an 8 s `AbortSignal.timeout`; then parse, filter, cap at 20, resolve names (`responsibleMember` → `responsibleMemberId`; Checklist `claimedBy` → `suggestedClaimedBy`, removed from `fields`), ground costs, and set `valid`/`errors` with `validatePlanItem` (including the Itinerary day range)
    - Map failures to `502 { error: 'DRAFT_FAILED', reason }` with `MODEL_ACCESS_DENIED`, `TIMEOUT`, `BEDROCK_ERROR`, or `UNPARSEABLE`; log only `{ event: 'DRAFT_FAILED', tripId, reason }`; never log notes, prompt, or response; emit `DraftItemCount` and return `200 { drafts }` with no writes
    - Widen the key pattern in `packages/shared/src/redact.ts` to the design's list (adding `notes`, `draftnotes`, `prompt`, `system`, `messages`, `output`) and update its tests
    - `services/api/src/routes.ts`: add `'drafts'` to the `RouteEntry['fn']` union and `...entries('drafts', draftsRoutes)` to `allRoutes`
    - Unit tests in `services/api/src/handlers/drafts.test.ts` with `aws-sdk-client-mock` and the in-memory repos: model ID, temperature, and JSON instruction; empty, 4,000-, and 4,001-character notes and unknown itemId (400, Bedrock not called); access denied, generic error, 8 s timeout with fake timers, and non-JSON output (502 with matching `reason`, `DRAFT_FAILED` log, no writes); logs never contain the notes; both metrics emitted
    - _Requirements: 22.3, 22.4, 22.5, 22.6, 22.7, 22.9, 22.10, 22.11, 22.12, 22.13, 22.14, 22.15, 22.16, 22.17, 22.24, 22.26, 22.27, 22.28, 22.29_

  - [x] 21.4 Add drafts-fn to Terraform and the Lambda build
    - `terraform/api.tf`: add `"drafts"` to `local.function_keys`; add `drafts = { timeout = 10, env = merge(local.base_env, { MODEL_ID = var.model_id }) }` to `local.functions` (`base_env` holds `TABLE_NAME` and `GSI1_NAME`); add `"POST /trips/{tripId}/drafts" = "drafts"` to `local.routes` so the integration, JWT-authorized route, and Lambda permission are created
    - `terraform/iam.tf`: add a `drafts` role policy with `dynamodb:GetItem, Query` on the table (the design's IAM table lists the table only; add the GSI1 ARN only if the handler's reads need it), `bedrock:InvokeModel` on `local.model_arn`, and `logs:CreateLogStream, PutLogEvents` on its own log group; no write actions
    - `scripts/build-lambdas.mjs`: add `'drafts'` to `FUNCTIONS` so `dist/lambda/drafts.zip` is built
    - `services/api/src/routes.test.ts` must stay green (routes in `routes.ts` match `terraform/api.tf`)
    - _Requirements: 22.3, 22.7, 22.24, 25.1, 25.3_

  - [x] 21.5 Implement the "Draft with AI" UI on the Scratch pad tab
    - `web/src/api/drafts.ts`: `createDrafts(tripId, { itemIds?, notes? })` returning `DraftResponse` through the existing API client
    - `web/src/sections/GenericSection.tsx` (only when `section === 'ScratchPad'`): "Draft with AI" card with a "Use for drafting" `Checkbox` on each item card, a "Draft from notes" textarea with a live count against 4,000, and a "Create drafts" `Button`
    - Results `Drawer` with draft cards grouped by Section showing fields, field errors, and "Suggested: <name>" for Checklist; Edit (prefilled Section form updating the local draft and re-running `validatePlanItem`), Accept (existing `createItem`; on 201 remove the card and toast "Added to <Section>", on 400 keep the card with returned errors), Discard (local only), and "Accept all valid" (saves valid drafts one at a time, toast "N added, M need fixes")
    - After a Checklist create, call the existing claim route only when `suggestedClaimedBy` equals the accepting Member
    - On 502 or network error: no Drawer, error toast and inline "Drafts could not be created. Try again in a moment.", selection and textarea unchanged; on 400 show the message under the textarea
    - Use the `web/src/ui` primitives; no new dependencies
    - _Requirements: 22.1, 22.2, 22.18, 22.19, 22.20, 22.21, 22.22, 22.23, 22.25_

  - [x] 21.6 Checkpoint - Drafting builds, validates, and all tests pass
    - Run the typechecks, all vitest tests, `npm run build:lambdas`, `npm run build -w web`, and `terraform fmt -check` and `terraform validate` in `terraform/`
    - Ensure all tests pass, ask the user if questions arise.

- [x] 22. Add CI/CD with GitHub Actions
  - Follow the "CI/CD (GitHub Actions)" subsection of design section 11. Repo `github.com/gautampanigrahi/tripwise`, AWS account `651532007957`, region `us-west-2`. Never run `terraform apply` or migrate state in these tasks; the live stack (suffix `82e81a8a`) uses local state at `terraform/terraform.tfstate`.
  - [x] 22.1 Write the CI workflow
    - `.github/workflows/ci.yml` on `push` and `pull_request`; top-level `permissions: contents: read`; pinned action major versions (for example `actions/checkout@v4`, `actions/setup-node@v4`, `hashicorp/setup-terraform@v3`)
    - Node 20 with npm cache; `npm ci`; `npm run typecheck`; `npx vitest --run`; `npm run build:lambdas`; `npm run build -w web`
    - Terraform (>= 1.10): `terraform fmt -check -recursive`; `terraform init -backend=false` and `terraform validate` in `terraform/` and in `terraform/bootstrap/`
    - Make the workflow callable (`workflow_call`) so the deploy workflow can reuse it
    - _Requirements: 25.2, 28.4_

  - [x] 22.2 Write the bootstrap Terraform config
    - `terraform/bootstrap/versions.tf` (Terraform >= 1.10, AWS provider, region `us-west-2`, local state); `variables.tf` with `github_repo` (default `gautampanigrahi/tripwise`) and `state_bucket_name` (default derived from the account, for example `tripwise-tfstate-651532007957`)
    - `main.tf`: state bucket (versioning, SSE-S3, all public access blocks, TLS-only bucket policy); OIDC provider for `token.actions.githubusercontent.com` with client ID `sts.amazonaws.com`; deploy role whose trust policy allows only `repo:<github_repo>:environment:production` with `aud` `sts.amazonaws.com`; deploy policy covering the main Terraform config, state bucket access (including the lock file), S3 sync, and CloudFront invalidation, scoped to tripwise resources and the state bucket where practical
    - `outputs.tf`: state bucket name and deploy role ARN
    - Do NOT apply
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5_

  - [x] 22.3 Move the main config to remote state
    - `terraform/backend.tf`: `backend "s3"` with the bootstrap bucket, key `tripwise/terraform.tfstate`, region `us-west-2`, `encrypt = true`, `use_lockfile = true` (no DynamoDB lock table)
    - `scripts/migrate-state.sh`: `set -euo pipefail`; copy `terraform/terraform.tfstate` to a timestamped backup; run `terraform -chdir=terraform init -migrate-state`; run `terraform plan -detailed-exitcode` and fail unless it reports no changes
    - Update `scripts/deploy.sh` only as needed to work with the remote backend
    - Do NOT run the migration
    - _Requirements: 25.1, 25.2_

  - [x] 22.4 Write the deploy workflow
    - `.github/workflows/deploy.yml` on `push` to `main` and `workflow_dispatch`; a first job calls the CI workflow, and the deploy job `needs` it
    - Deploy job: `environment: production`; `permissions: id-token: write, contents: read`; `concurrency: { group: deploy-production, cancel-in-progress: false }`; `aws-actions/configure-aws-credentials@v4` with `role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}` and region `us-west-2`
    - Steps: `npm ci`, `npm run build:lambdas`, `terraform init`, `terraform plan -out=tfplan`, `terraform apply tfplan`; then write `web/.env.local` from outputs, `npm run build -w web`, `aws s3 sync web/dist` with `--delete`, `aws s3 sync catalog` to `catalog/` without `--delete`, and a CloudFront invalidation, reusing `scripts/deploy.sh` logic where sensible
    - No secrets, tokens, or `.env.local` contents in logs
    - _Requirements: 25.1, 25.2, 28.4_

  - [x] 22.5 Document the one-time CI/CD setup
    - `docs/ci-cd.md` (or a README section): apply `terraform/bootstrap/`, run `scripts/migrate-state.sh`, set the repository variable `AWS_DEPLOY_ROLE_ARN` from the bootstrap output, and create the `production` environment with a required reviewer
    - Note that required reviewers on private repositories need a paid GitHub plan
    - _Requirements: 25.2_

  - [x] 22.6 Checkpoint - Workflows lint, Terraform validates, and all tests pass
    - Run `actionlint` if available (otherwise a YAML lint) on `.github/workflows/`; `terraform fmt -check -recursive`; `terraform init -backend=false` and `terraform validate` in `terraform/` and `terraform/bootstrap/`; the typechecks and `npx vitest --run`
    - Never run `terraform apply` and never migrate state
    - Ensure all tests pass, ask the user if questions arise.

- [x] 23. Fix the CI test failure on GitHub runners
  - `services/api/src/handlers/drafts.test.ts`: the log-capture helper (`failedLines`, around line 99–100) parses every captured stderr line as JSON; on GitHub's Node 20 runner the AWS SDK prints a non-JSON `(node:NNNN) Warning: NodeVersionSupportWarning` line, which breaks the "gives up after 8 seconds with TIMEOUT" test. Make the helper skip lines that are not JSON objects (and check other tests for the same pattern)
  - `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`: use Node 22 in `actions/setup-node` (keep the Lambda runtime unchanged)
  - Verify locally: `npm run typecheck`, `npx vitest --run`, and the same test with a simulated non-JSON stderr line
  - _Requirements: 28.4_

- [x] 24. Fix the GitHub OIDC trust policy for immutable subject claims
  - Root cause (verified): the Deploy job fails with "Not authorized to perform sts:AssumeRoleWithWebIdentity". The repo's OIDC sub-claim setting is `{"use_default":true,"use_immutable_subject":true,"sub_claim_prefix":"repo:gautampanigrahi@82938959/tripwise@1471106933"}`, so GitHub sends `sub = repo:gautampanigrahi@82938959/tripwise@1471106933:environment:production`, but the role trust policy in `terraform/bootstrap/main.tf` requires `repo:gautampanigrahi/tripwise:environment:production`
  - In `terraform/bootstrap/`: build the allowed subject from new variables (github owner ID 82938959, repo ID 1471106933) and allow both the immutable form and the legacy name form for environment `production` only (StringEquals with a list), keeping `aud = sts.amazonaws.com`
  - Update `docs/ci-cd.md` troubleshooting with how to read the repo's sub-claim setting (`gh api repos/<owner>/<repo>/actions/oidc/customization/sub`)
  - Validate with `terraform -chdir=terraform/bootstrap fmt -check` and `validate`, then `terraform -chdir=terraform/bootstrap plan` (the bootstrap has local state on this Mac): it must show only an in-place update to the deploy role's trust policy. Never apply
  - _Requirements: 25.3_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability. Requirements 23.2 and 27.5 (second Member sees changes after reload) are covered by `ConsistentRead` reads (8.2) and load-time fetches (12.1); confirm them manually after deployment.
- Property tests use fast-check with at least 100 runs and a tag comment: `// Feature: tripwise-trip-planner, Property N: <title>`.
- Property 16, 22, 29, 2, 3, 6, 7, and 9 run handlers against the in-memory repository fakes from task 8.2.
- Tasks 15.3 and 15.4 implement optional extensions and can be dropped if week 4 runs short. Task 15.8 is superseded by task 21 and must not be implemented; it stays in wave 21 of the graph only because every unchecked leaf task must appear in a wave.
- Task 17 replaces the CDK app in `infra/` (tasks 5.1, 5.2, 11.11) with Terraform in `terraform/`. `cdk bootstrap` is no longer needed. Deploy with `scripts/deploy.sh`, which needs the AWS CLI, Terraform, and credentials for the target account. References to `infra/` in tasks 15.7 and 15.8 now mean the equivalent files in `terraform/`.
- Task 17 does not depend on tasks 15.x or 16. In the dependency graph its waves (15–18) run right after checkpoint 14 and before the remaining 15.x tasks and checkpoint 16.
- Task 18 is listed after task 17 but runs in wave 20, after task 15.1 (both touch `web/src/pages/TripPage.tsx` and section components) and before checkpoint 16. Task 15.8 also edits `web/src/sections/GenericSection.tsx`, so it stays in wave 21, after task 18.
- Task 19 switches the Bedrock model from Anthropic Claude to Amazon Nova Lite (`amazon.nova-lite-v1:0`, on-demand in us-west-2) because the AWS Free plan cannot create the AWS Marketplace agreements Claude models require. It depends only on task 18. It sits alone in final wave 23 for ordering; it does not need tasks 15.7, 15.8, or checkpoint 16 to be done.
- Task 20 reworks the web UI with plain CSS (design section 12) and replaces the basic stylesheet from task 18. It runs in waves 24–27 after task 19. Task 20.1 runs alone because every later sub-task uses its primitives. Tasks 20.2–20.6 touch different files and run in parallel; 20.3 owns `web/src/pages/TripPage.tsx`. Task 20.7 touches all screens, so it runs after them, together with optional tests 20.8.
- Task 21 implements Requirement 22 (design section 8a) in waves 28–31 after checkpoint 20.9. Task 21.1 runs alone because the handler uses its helpers and types. Tasks 21.3 (API, `routes.ts`, `redact.ts`), 21.4 (Terraform and build script), and 21.5 (web) touch different files and run in parallel; 21.5 needs only the API shape from the design. Optional property tests 21.2 run in their own wave after 21.3 because Property 40 exercises the drafts handler. Checkpoint 21.6 runs last.
- Task 22 adds CI/CD with GitHub Actions (design section 11, "CI/CD") in waves 32–35. Tasks 22.1 (CI workflow) and 22.2 (bootstrap config) touch different files and run together. Tasks 22.3 (backend and migration script) and 22.4 (deploy workflow) run together after them, because the backend needs the bootstrap bucket name and the deploy workflow reuses the CI workflow. Documentation 22.5 and checkpoint 22.6 follow. No task applies Terraform or migrates state; the user does both by hand after reviewing.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.7", "2.18", "5.2", "6.2"] },
    { "id": 3, "tasks": ["2.3", "2.5", "2.6", "2.8", "2.9", "2.10", "2.11", "2.19", "2.20", "2.21", "3.1", "4.1"] },
    { "id": 4, "tasks": ["2.12", "2.13", "2.14", "2.15", "2.16", "2.17", "3.2", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 5, "tasks": ["3.3"] },
    { "id": 6, "tasks": ["3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10"] },
    { "id": 7, "tasks": ["7"] },
    { "id": 8, "tasks": ["8.1", "8.2", "12.1", "12.2"] },
    { "id": 9, "tasks": ["8.3", "9.1", "11.1", "11.2", "12.3", "12.4"] },
    { "id": 10, "tasks": ["8.4", "9.2", "9.6", "9.8", "10.1", "11.6", "12.5"] },
    { "id": 11, "tasks": ["9.3", "9.4", "9.5", "9.7", "9.9", "10.2", "11.3", "12.6", "12.7"] },
    { "id": 12, "tasks": ["10.3", "10.4", "10.5", "11.4", "11.5", "11.7", "11.8", "13.1"] },
    { "id": 13, "tasks": ["11.9", "11.10", "11.11", "13.2"] },
    { "id": 14, "tasks": ["14"] },
    { "id": 15, "tasks": ["17.1", "17.2"] },
    { "id": 16, "tasks": ["17.3"] },
    { "id": 17, "tasks": ["17.4"] },
    { "id": 18, "tasks": ["17.5"] },
    { "id": 19, "tasks": ["15.1", "15.3", "15.7"] },
    { "id": 20, "tasks": ["15.2", "15.4", "15.5", "18"] },
    { "id": 21, "tasks": ["15.6", "15.8"] },
    { "id": 22, "tasks": ["16"] },
    { "id": 23, "tasks": ["19"] },
    { "id": 24, "tasks": ["20.1"] },
    { "id": 25, "tasks": ["20.2", "20.3", "20.4", "20.5", "20.6"] },
    { "id": 26, "tasks": ["20.7", "20.8"] },
    { "id": 27, "tasks": ["20.9"] },
    { "id": 28, "tasks": ["21.1"] },
    { "id": 29, "tasks": ["21.3", "21.4", "21.5"] },
    { "id": 30, "tasks": ["21.2"] },
    { "id": 31, "tasks": ["21.6"] },
    { "id": 32, "tasks": ["22.1", "22.2"] },
    { "id": 33, "tasks": ["22.3", "22.4"] },
    { "id": 34, "tasks": ["22.5"] },
    { "id": 35, "tasks": ["22.6"] },
    { "id": 36, "tasks": ["23"] },
    { "id": 37, "tasks": ["24"] }
  ]
}
```
