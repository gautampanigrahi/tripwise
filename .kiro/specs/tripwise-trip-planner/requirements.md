# Requirements Document

## Introduction

TripWise is a private trip planner for friend groups. A Host creates a Trip, invites friends, and every invited Member can read and update the shared plan. The plan is organized into Sections (Lodging, Itinerary, Groceries, Checklist, Transportation, Reservations, Expenses, Scratch pad). The Host records Trip_Constraints (destination, dates, traveler count, budget, preferences, limits), and a deterministic Feasibility_Engine checks the plan against those constraints. Each Check stores its measured value, limit, and pass/fail outcome. Amazon Bedrock then writes a plain-language explanation that uses only the values stored in the Check_Result and the plan.

The project is a four-week build stored in a private GitHub repository shared with the instructor.

### Recorded Assumptions

The user skipped the clarifying questions, so these defaults apply:

1. **Stack**: TypeScript on Node.js AWS Lambda; Terraform for infrastructure; React single-page app built with Vite for the frontend; fast-check for property-based tests. Code and examples are written in TypeScript, not pseudocode.
2. **Section depth**: Lodging, Itinerary, Groceries, and Checklist get section-specific fields and UI. Transportation, Reservations, Expenses, and Scratch pad use the same generic Plan_Item model with basic create, read, update, and delete.
3. **Checks**: Cost, Capacity, and Dates are required. Schedule and Preferences are optional extensions. The Feasibility_Score is the share of executed Checks that passed, shown with a label. Alternatives are produced by re-running the same Checks against a different Catalog stay.
4. **Bedrock scope**: The main Bedrock task is explaining a Check_Result, grounded only in stored check values. The second Bedrock task turns Scratch pad notes into editable Draft_Items (Requirement 22). A Bedrock trip summary is not being built.
5. **Updates**: Members see other Members' changes after reloading. Live push over WebSocket is out of scope for the MVP.
6. **Notifications**: Amazon SNS sends invite and check-result alerts. Amazon EventBridge Scheduler sends one pre-trip reminder; this part may be minimal.
7. **Demo data**: San Diego is the demo city, with a few stays and activities. The Catalog is versioned JSON in S3, and every price in it is labeled as a dated estimate.
8. **Operations**: Single AWS Region, least-privilege IAM role per Lambda function, private S3 prefixes, CloudWatch logs and metrics.

### Out of Scope

Flight booking, payment processing or money transfer, global hotel search, and real-time collaborative editing.

## Glossary

- **TripWise_App**: The React single-page web application served from S3 that Members use in a browser.
- **TripWise_API**: The Amazon API Gateway HTTP API and the TypeScript Lambda functions behind it that handle all trip operations.
- **Auth_Service**: The Amazon Cognito user pool that authenticates users and issues identity tokens.
- **Membership_Guard**: The logic inside each TripWise_API Lambda function that confirms the caller is a Member of the requested Trip before any data is read or written.
- **Plan_Store**: The Amazon DynamoDB table(s) that hold Trips, Memberships, Plan_Items, Trip_Constraints, and Check_Results.
- **File_Store**: The Amazon S3 buckets that hold the web app assets, uploaded confirmation files (private prefix), and the Catalog.
- **Catalog**: A versioned JSON document in the File_Store that lists demo stays, activities, travel-time entries, and per-item estimated prices with an "estimated as of" date.
- **Travel_Time_Table**: The part of the Catalog that lists travel minutes between named places.
- **Feasibility_Engine**: The deterministic TypeScript Lambda code that runs Checks against a Trip's plan and Trip_Constraints.
- **Explanation_Service**: The Lambda function that calls Amazon Bedrock to write a plain-language explanation of a Check_Result.
- **Notification_Service**: The component that publishes invite and check-result alerts through Amazon SNS.
- **Reminder_Scheduler**: The component that creates an Amazon EventBridge Scheduler schedule for a pre-trip reminder.
- **User**: A person with an Auth_Service account.
- **Host**: The User who created a Trip.
- **Member**: A User listed in a Trip's Membership, including the Host.
- **Invitee**: A person the Host has invited who has not yet accepted.
- **Trip**: A named plan with a destination, start date, end date, and a set of Members.
- **Trip_Night**: Each night from the Trip start date up to, but not including, the Trip end date.
- **Section**: A named group of Plan_Items within a Trip. Valid values: Lodging, Itinerary, Transportation, Groceries, Checklist, Reservations, Expenses, ScratchPad.
- **Plan_Item**: One stored record in a Section, holding the Section name, section-specific fields, a lastModifiedBy User ID, and a lastModifiedAt timestamp.
- **Trip_Constraints**: The Trip's destination, start and end dates, traveler count, budget (total or per person), required preferences, planned activities, and limits (accessibility needs, walking-distance limit, travel-time cap).
- **Check**: One named rule evaluated by the Feasibility_Engine. Valid names: Cost, Capacity, Dates, Schedule, Preferences.
- **Check_Outcome**: The stored result of one Check: Check name, measured value, limit, unit, and pass or fail.
- **Check_Result**: A saved record of one Feasibility_Engine run: Trip ID, run timestamp, the stay evaluated, Catalog version, the list of Check_Outcomes, the Feasibility_Score, and the explanation text.
- **Feasibility_Score**: The number of passed Check_Outcomes divided by the number of executed Check_Outcomes in a Check_Result, shown as a percentage with a label.
- **Alternative**: A Check_Result produced by running the same Checks against a different Catalog stay without changing the saved plan.
- **Draft_Notes**: The text a Member submits for drafting: the text of the selected ScratchPad Plan_Items or the text typed into the "Draft from notes" box on the Scratch pad tab.
- **Drafting_Section**: A Section that drafting may produce. Valid values: Itinerary, Groceries, Checklist, Reservations, Transportation.
- **Draft_Item**: An unsaved, editable proposal for one Plan_Item in a Drafting_Section, produced from Draft_Notes by Amazon Bedrock and returned by the TripWise_API with a valid or invalid status and any field errors.
- **Required_Feature**: A stay attribute named in Trip_Constraints preferences (for example, "parking" or "step-free entry") that must be true for the stay.

## Requirements

### Requirement 1: User Authentication

**User Story:** As a User, I want to sign in with my own account, so that only I can act under my identity.

#### Acceptance Criteria

1. THE TripWise_App SHALL authenticate Users through the Auth_Service before showing any Trip data.
2. WHEN the TripWise_App calls the TripWise_API, THE TripWise_App SHALL send the Auth_Service identity token with the request.
3. IF a TripWise_API request has a missing, expired, or invalid identity token, THEN THE TripWise_API SHALL reject the request with HTTP status 401 and return no Trip data.

### Requirement 2: Trip Creation

**User Story:** As a Host, I want to create a Trip with a name, destination, and dates, so that my group has one shared place to plan.

#### Acceptance Criteria

1. WHEN an authenticated User submits a Trip name, destination, start date, and end date, THE TripWise_API SHALL create the Trip in the Plan_Store and record that User as the Host and first Member.
2. IF the submitted end date is not later than the submitted start date, THEN THE TripWise_API SHALL reject the request with HTTP status 400 and a message naming the invalid date field.
3. IF the submitted Trip name or destination is empty, THEN THE TripWise_API SHALL reject the request with HTTP status 400 and a message naming the empty field.
4. WHEN an authenticated User opens the trip list, THE TripWise_App SHALL list only the Trips where that User is a Member.

### Requirement 3: Invitations and Membership

**User Story:** As a Host, I want to invite friends by email, so that only the people I choose can open the Trip.

#### Acceptance Criteria

1. WHEN the Host submits an invitee email address for a Trip, THE TripWise_API SHALL store a pending invitation for that email and that Trip.
2. WHEN a pending invitation is stored, THE Notification_Service SHALL publish an invite alert through Amazon SNS that contains the Trip name and an accept link.
3. WHEN an authenticated User whose verified email matches a pending invitation accepts the invitation, THE TripWise_API SHALL add that User as a Member of the Trip and mark the invitation accepted.
4. IF a User who is not the Host submits an invitation for a Trip, THEN THE TripWise_API SHALL reject the request with HTTP status 403.
5. IF an authenticated User tries to accept an invitation addressed to a different email, THEN THE TripWise_API SHALL reject the request with HTTP status 403 and leave the Membership unchanged.

### Requirement 4: Membership Enforcement

**User Story:** As a Member, I want Trip data visible only to invited Members, so that door codes and confirmations stay private.

#### Acceptance Criteria

1. WHEN the TripWise_API receives a request for a Trip, THE Membership_Guard SHALL confirm that the caller's Auth_Service user ID is a Member of that Trip before any Plan_Store or File_Store access for that Trip.
2. IF the caller is not a Member of the requested Trip, THEN THE TripWise_API SHALL reject the request with HTTP status 403 and return no Trip data.
3. WHILE a User is a Member of a Trip, THE TripWise_API SHALL allow that User to read and update every Section of that Trip.
4. THE TripWise_API SHALL take the caller's user ID only from the verified identity token and ignore any user ID supplied in the request body or query string.

### Requirement 5: Generic Plan Items

**User Story:** As a Member, I want every Section to store items the same way, so that all parts of the plan can be added, edited, and removed consistently.

#### Acceptance Criteria

1. WHEN a Member creates a Plan_Item with a valid Section name, THE TripWise_API SHALL store the Plan_Item in the Plan_Store with the Section name, the submitted fields, lastModifiedBy set to the caller's user ID, and lastModifiedAt set to the server time.
2. WHEN a Member updates a Plan_Item, THE TripWise_API SHALL store the new field values and set lastModifiedBy to the caller's user ID and lastModifiedAt to the server time.
3. WHEN a Member deletes a Plan_Item, THE TripWise_API SHALL remove the Plan_Item from the Plan_Store.
4. WHEN a Member requests the Plan_Items of a Section, THE TripWise_API SHALL return every stored Plan_Item of that Section for that Trip.
5. IF a Plan_Item request names a Section outside the valid Section list, THEN THE TripWise_API SHALL reject the request with HTTP status 400.
6. IF submitted Plan_Item fields fail the validation schema for the named Section, THEN THE TripWise_API SHALL reject the request with HTTP status 400 and list each invalid field.
7. THE TripWise_App SHALL show the lastModifiedBy Member name and lastModifiedAt time on each Plan_Item.
8. THE TripWise_App SHALL provide create, view, edit, and delete screens for the Transportation, Reservations, Expenses, and ScratchPad Sections using the generic Plan_Item fields.

### Requirement 6: Lodging Section

**User Story:** As a Member, I want lodging details in one place, so that everyone knows where we stay and how to get in.

#### Acceptance Criteria

1. THE TripWise_App SHALL let a Member enter, for each Lodging Plan_Item, a listing link, address, check-in date, check-out date, confirmation number, sleeps count, and check-in details including a door code.
2. IF a Lodging Plan_Item has a check-out date that is not later than its check-in date, THEN THE TripWise_API SHALL reject the Plan_Item with HTTP status 400.
3. IF a Lodging Plan_Item has a sleeps count that is not a positive whole number, THEN THE TripWise_API SHALL reject the Plan_Item with HTTP status 400.
4. WHEN a Member uploads a confirmation file to a Lodging Plan_Item, THE TripWise_API SHALL store the file under a private, Trip-specific prefix in the File_Store and record the object key on the Plan_Item.
5. WHEN a Member requests an uploaded confirmation file, THE TripWise_API SHALL return a presigned download URL that expires within 15 minutes.
6. WHEN a Member selects a stay from the Catalog, THE TripWise_App SHALL prefill the Lodging Plan_Item with the Catalog stay's name, address, sleeps count, and estimated nightly price.

### Requirement 7: Itinerary Section

**User Story:** As a Member, I want a day-by-day itinerary, so that the group knows where to be and when.

#### Acceptance Criteria

1. THE TripWise_App SHALL let a Member enter, for each Itinerary Plan_Item, a day, a start time, an optional end time, a stop name, and notes.
2. IF an Itinerary Plan_Item has a day outside the Trip start date to end date range, THEN THE TripWise_API SHALL reject the Plan_Item with HTTP status 400.
3. IF an Itinerary Plan_Item has an end time earlier than its start time, THEN THE TripWise_API SHALL reject the Plan_Item with HTTP status 400.
4. THE TripWise_App SHALL display Itinerary Plan_Items grouped by day and ordered by start time within each day.

### Requirement 8: Groceries Section

**User Story:** As a Member, I want a shared grocery list, so that we buy everything once and know who is buying it.

#### Acceptance Criteria

1. THE TripWise_App SHALL let a Member enter, for each Groceries Plan_Item, an item name, a quantity, a responsible Member, and a purchased checkbox.
2. WHEN a Member toggles the purchased checkbox, THE TripWise_API SHALL store the new purchased value with lastModifiedBy and lastModifiedAt.
3. IF a Groceries Plan_Item names a responsible person who is not a Member of the Trip, THEN THE TripWise_API SHALL reject the Plan_Item with HTTP status 400.
4. IF a Groceries Plan_Item has a quantity that is not a positive number, THEN THE TripWise_API SHALL reject the Plan_Item with HTTP status 400.

### Requirement 9: Checklist Section

**User Story:** As a Member, I want to claim and complete checklist tasks, so that the group can see who is doing what.

#### Acceptance Criteria

1. THE TripWise_App SHALL let a Member enter, for each Checklist Plan_Item, a task description, an optional claimed-by Member, and a done flag.
2. WHEN a Member claims an unclaimed Checklist Plan_Item, THE TripWise_API SHALL set claimed-by to the caller's user ID.
3. WHEN a Member marks a Checklist Plan_Item done, THE TripWise_API SHALL set the done flag to true and record lastModifiedBy and lastModifiedAt.
4. IF a Member tries to claim a Checklist Plan_Item already claimed by a different Member, THEN THE TripWise_API SHALL reject the request with HTTP status 409 and leave claimed-by unchanged.

### Requirement 10: Expenses Section

**User Story:** As a Member, I want to log who paid for what, so that the group has a shared record of spending.

#### Acceptance Criteria

1. THE TripWise_App SHALL let a Member enter, for each Expenses Plan_Item, a payer Member, an amount in US dollars, and a purpose.
2. IF an Expenses Plan_Item has an amount that is not a positive number with at most two decimal places, THEN THE TripWise_API SHALL reject the Plan_Item with HTTP status 400.
3. THE TripWise_App SHALL show Expenses as records only, with no payment, transfer, or settlement action.

### Requirement 11: Trip Constraints

**User Story:** As a Host, I want to record the group's limits and preferences, so that the plan can be checked against them.

#### Acceptance Criteria

1. WHEN a Member saves Trip_Constraints, THE TripWise_API SHALL store the destination, start date, end date, traveler count, budget amount, budget type (total or per person), Required_Features, planned activities, accessibility needs, walking-distance limit, and travel-time cap in the Plan_Store.
2. IF the traveler count is not a positive whole number, THEN THE TripWise_API SHALL reject the Trip_Constraints with HTTP status 400.
3. IF the budget amount is not a positive number, THEN THE TripWise_API SHALL reject the Trip_Constraints with HTTP status 400.
4. WHERE the budget type is per person, THE Feasibility_Engine SHALL use the budget amount multiplied by the traveler count as the total budget limit.
5. WHERE the budget type is total, THE Feasibility_Engine SHALL use the budget amount as the total budget limit.

### Requirement 12: Catalog

**User Story:** As a Member, I want demo stays and activities with labeled estimated prices, so that checks run on known data without live hotel search.

#### Acceptance Criteria

1. THE File_Store SHALL hold the Catalog as a versioned JSON document for the demo city of San Diego containing at least 3 stays, at least 5 activities, and a Travel_Time_Table.
2. THE Catalog SHALL record, for each stay, an ID, name, address, sleeps count, estimated nightly price in US dollars, available features, and an "estimated as of" date.
3. THE Catalog SHALL record, for each activity, an ID, name, estimated price per person in US dollars, and an "estimated as of" date.
4. WHEN the TripWise_App displays a Catalog price, THE TripWise_App SHALL label the price as an estimate and show its "estimated as of" date.
5. IF the TripWise_API loads a Catalog document that fails the Catalog validation schema, THEN THE TripWise_API SHALL return HTTP status 500 with an error naming the Catalog version and log the validation errors to CloudWatch.

### Requirement 13: Feasibility Check Execution

**User Story:** As a Member, I want to run a feasibility check on the plan, so that the group knows whether the plan fits our constraints.

#### Acceptance Criteria

1. WHEN a Member requests a feasibility check, THE Feasibility_Engine SHALL run the Cost, Capacity, and Dates Checks against the Trip's current Lodging Plan_Item, Transportation Plan_Items, planned activities, Trip_Constraints, and Catalog.
2. THE Feasibility_Engine SHALL produce identical Check_Outcomes for identical plan, Trip_Constraints, and Catalog version inputs.
3. WHEN the Feasibility_Engine finishes a run, THE TripWise_API SHALL save a Check_Result containing the run timestamp, the evaluated stay, the Catalog version, every Check_Outcome, and the Feasibility_Score.
4. THE Feasibility_Engine SHALL record, in each Check_Outcome, the Check name, measured value, limit, unit, and pass or fail.
5. IF the Trip has no Lodging Plan_Item or no saved Trip_Constraints, THEN THE TripWise_API SHALL reject the feasibility check request with HTTP status 422 and a message naming the missing input.
6. WHEN a Member requests the Check_Result history of a Trip, THE TripWise_API SHALL return the saved Check_Results ordered by run timestamp, newest first.

### Requirement 14: Cost Check

**User Story:** As a Member, I want the total trip cost compared to our budget, so that we know whether we can afford the plan.

#### Acceptance Criteria

1. THE Feasibility_Engine SHALL compute the Cost measured value as the stay nightly price multiplied by the number of Trip_Nights, plus the sum of Transportation Plan_Item costs, plus the sum of planned activity price per person multiplied by the traveler count.
2. THE Feasibility_Engine SHALL set the Cost limit to the total budget limit defined in Requirement 11.
3. WHEN the Cost measured value is less than or equal to the Cost limit, THE Feasibility_Engine SHALL mark the Cost Check passed.
4. WHEN the Cost measured value is greater than the Cost limit, THE Feasibility_Engine SHALL mark the Cost Check failed.
5. THE Feasibility_Engine SHALL compute Cost values in whole US cents to avoid floating-point rounding differences.

### Requirement 15: Capacity Check

**User Story:** As a Member, I want to know whether the stay sleeps everyone, so that nobody is left without a bed.

#### Acceptance Criteria

1. THE Feasibility_Engine SHALL set the Capacity measured value to the stay sleeps count and the Capacity limit to the traveler count.
2. WHEN the stay sleeps count is greater than or equal to the traveler count, THE Feasibility_Engine SHALL mark the Capacity Check passed.
3. WHEN the stay sleeps count is less than the traveler count, THE Feasibility_Engine SHALL mark the Capacity Check failed.

### Requirement 16: Dates Check

**User Story:** As a Member, I want to know whether lodging covers every night of the trip, so that we have a place to stay each night.

#### Acceptance Criteria

1. THE Feasibility_Engine SHALL set the Dates measured value to the number of Trip_Nights covered by the Lodging Plan_Item check-in to check-out range and the Dates limit to the total number of Trip_Nights.
2. WHEN every Trip_Night falls on or after the Lodging check-in date and before the Lodging check-out date, THE Feasibility_Engine SHALL mark the Dates Check passed.
3. WHEN at least one Trip_Night falls outside the Lodging check-in to check-out range, THE Feasibility_Engine SHALL mark the Dates Check failed.

### Requirement 17: Schedule Check (Optional Extension)

**User Story:** As a Member, I want daily travel time compared to our cap, so that we do not spend the trip in transit.

#### Acceptance Criteria

1. WHERE the Schedule Check is enabled and Trip_Constraints include a travel-time cap, THE Feasibility_Engine SHALL compute, for each Trip day, the sum of Travel_Time_Table minutes between consecutive Itinerary stops ordered by start time.
2. WHERE the Schedule Check is enabled, THE Feasibility_Engine SHALL set the Schedule measured value to the largest daily travel total and the Schedule limit to the travel-time cap in minutes.
3. WHERE the Schedule Check is enabled, WHEN the largest daily travel total is less than or equal to the travel-time cap, THE Feasibility_Engine SHALL mark the Schedule Check passed.
4. WHERE the Schedule Check is enabled, WHEN the largest daily travel total is greater than the travel-time cap, THE Feasibility_Engine SHALL mark the Schedule Check failed.
5. WHERE the Schedule Check is enabled, IF a pair of consecutive Itinerary stops has no Travel_Time_Table entry, THEN THE Feasibility_Engine SHALL mark the Schedule Check failed and name the missing pair in the Check_Outcome.

### Requirement 18: Preferences Check (Optional Extension)

**User Story:** As a Member with specific needs, I want the stay checked for required features, so that accessibility and other needs are met.

#### Acceptance Criteria

1. WHERE the Preferences Check is enabled, THE Feasibility_Engine SHALL set the Preferences measured value to the number of Required_Features true for the stay and the Preferences limit to the total number of Required_Features.
2. WHERE the Preferences Check is enabled, WHEN every Required_Feature is true for the stay, THE Feasibility_Engine SHALL mark the Preferences Check passed.
3. WHERE the Preferences Check is enabled, WHEN at least one Required_Feature is false or absent for the stay, THE Feasibility_Engine SHALL mark the Preferences Check failed and list the unmet Required_Features in the Check_Outcome.

### Requirement 19: Feasibility Score

**User Story:** As a Member, I want a single score with a label, so that I can see at a glance how close the plan is to working.

#### Acceptance Criteria

1. THE Feasibility_Engine SHALL compute the Feasibility_Score as the number of passed Check_Outcomes divided by the number of executed Check_Outcomes, rounded to the nearest whole percent.
2. WHEN every executed Check passed, THE TripWise_App SHALL label the Feasibility_Score "Feasible".
3. WHEN at least one executed Check failed, THE TripWise_App SHALL label the Feasibility_Score "Not feasible" and list each failed Check with its measured value and limit.
4. THE TripWise_App SHALL display every Check_Outcome with its Check name, measured value, limit, unit, and pass or fail status.

### Requirement 20: Alternatives

**User Story:** As a Member, I want to try a different stay without changing our plan, so that I can compare options before switching.

#### Acceptance Criteria

1. WHEN a Member requests an Alternative for a Catalog stay, THE Feasibility_Engine SHALL run the same Checks as the latest Check_Result with that Catalog stay in place of the current Lodging Plan_Item.
2. WHEN the Feasibility_Engine produces an Alternative, THE TripWise_API SHALL save the Alternative as a Check_Result marked "alternative" with the evaluated Catalog stay ID and leave every Plan_Item unchanged.
3. WHEN the TripWise_App displays an Alternative, THE TripWise_App SHALL show the Alternative Check_Outcomes next to the Check_Outcomes of the latest non-alternative Check_Result.

### Requirement 21: Grounded Explanation

**User Story:** As a Member, I want a plain-language explanation of the check result, so that everyone understands why the plan passed or failed.

#### Acceptance Criteria

1. WHEN a Check_Result is saved, THE Explanation_Service SHALL send Amazon Bedrock a prompt containing only the Check_Outcomes, the Feasibility_Score, and the evaluated stay name from that Check_Result.
2. THE Explanation_Service SHALL instruct Amazon Bedrock to use only numbers present in the supplied Check_Outcomes.
3. WHEN Amazon Bedrock returns an explanation, THE Explanation_Service SHALL verify that every number in the explanation text appears in the supplied Check_Outcomes, the Feasibility_Score, or the Trip_Night count.
4. IF the explanation text contains a number absent from the supplied values, THEN THE Explanation_Service SHALL discard the Bedrock text and store a template explanation built from the Check_Outcomes.
5. IF the Amazon Bedrock call fails or exceeds 10 seconds, THEN THE Explanation_Service SHALL store a template explanation built from the Check_Outcomes and log the failure to CloudWatch.
6. WHEN an explanation is stored, THE TripWise_API SHALL save the explanation text and its source (Bedrock or template) on the Check_Result.

### Requirement 22: Scratch Pad Drafting with Bedrock

**User Story:** As a Member, I want to turn rough Scratch pad notes into draft Plan_Items that I can review, so that filling in the plan takes less typing without anything being saved behind my back.

#### Acceptance Criteria

1. WHEN a Member selects one or more ScratchPad Plan_Items on the Scratch pad tab and requests drafts, THE TripWise_App SHALL send the text of the selected ScratchPad Plan_Items to the TripWise_API as Draft_Notes.
2. WHEN a Member enters text in the "Draft from notes" box on the Scratch pad tab and requests drafts, THE TripWise_App SHALL send the entered text to the TripWise_API as Draft_Notes.
3. WHEN the TripWise_API receives a draft request, THE Membership_Guard SHALL treat the draft request as a write action and confirm, according to Requirement 4, that the caller is a Member of the Trip before the TripWise_API reads Trip data or calls Amazon Bedrock.
4. IF the Draft_Notes are empty or longer than 4,000 characters, THEN THE TripWise_API SHALL reject the draft request with HTTP status 400 and a message naming the Draft_Notes limit, without calling Amazon Bedrock.
5. WHEN the TripWise_API sends a draft request to Amazon Bedrock, THE TripWise_API SHALL include only the Draft_Notes, the Trip start date, the Trip end date, the Trip destination, the traveler count, the display names of the Trip's Members, and the list of Drafting_Sections with their field names.
6. THE TripWise_API SHALL exclude door codes, confirmation numbers, check-in details, identity tokens, email addresses, and user IDs from every Amazon Bedrock draft request.
7. THE TripWise_API SHALL call the Amazon Nova Lite model identified by the existing MODEL_ID environment variable for draft requests.
8. THE TripWise_API SHALL instruct Amazon Bedrock to return Draft_Items as JSON, with each Draft_Item naming one Drafting_Section and that Section's fields.
9. WHEN Amazon Bedrock returns Draft_Items, THE TripWise_API SHALL drop every Draft_Item whose Section is not a Drafting_Section.
10. IF Amazon Bedrock returns more than 20 Draft_Items for one draft request, THEN THE TripWise_API SHALL keep the first 20 Draft_Items and drop the rest.
11. WHEN a Draft_Item names a responsible Member, claimed-by Member, or payer by display name, THE TripWise_API SHALL replace the display name with the user ID of the one Member whose display name matches.
12. IF a person named in a Draft_Item matches no Member display name or more than one Member display name, THEN THE TripWise_API SHALL leave that Draft_Item field unassigned.
13. WHEN a Draft_Item contains a cost or amount field, THE TripWise_API SHALL check that the amount appears among the numbers extracted from the Draft_Notes using the number-extraction method of Requirement 21.3.
14. IF a Draft_Item cost or amount does not appear among the numbers extracted from the Draft_Notes, THEN THE TripWise_API SHALL remove that cost or amount field from the Draft_Item.
15. WHEN the TripWise_API has prepared the Draft_Items, THE TripWise_API SHALL validate each Draft_Item with the same Section validation schema used for manually created Plan_Items in Requirements 5 through 9, including the Itinerary day range against the Trip dates.
16. IF a Draft_Item fails Section validation, THEN THE TripWise_API SHALL return the Draft_Item marked invalid with each invalid field and its error message.
17. WHEN the TripWise_API returns Draft_Items, THE TripWise_API SHALL return the Draft_Items to the TripWise_App without storing any Plan_Item.
18. WHEN the TripWise_App receives Draft_Items, THE TripWise_App SHALL display each Draft_Item with its Section, its fields, its field errors, and edit, accept, and discard controls.
19. WHEN a Member accepts a Draft_Item, THE TripWise_API SHALL store the Draft_Item as a Plan_Item according to Requirement 5.1, with lastModifiedBy set to the accepting Member's user ID.
20. IF an accepted Draft_Item fails Section validation when saved, THEN THE TripWise_API SHALL reject the save with HTTP status 400 and list each invalid field.
21. IF the TripWise_API rejects the save of an accepted Draft_Item, THEN THE TripWise_App SHALL keep the Draft_Item displayed with the returned field errors.
22. WHEN a Member discards a Draft_Item, THE TripWise_App SHALL remove the Draft_Item from the draft list without storing a Plan_Item.
23. WHEN a Member selects "Accept all valid", THE TripWise_App SHALL save every Draft_Item that has no field errors as a Plan_Item and keep every invalid Draft_Item in the draft list.
24. IF the Amazon Bedrock draft call fails, is denied model access (including the Free-plan Marketplace restriction on Amazon Nova Lite documented in the design), takes longer than 8 seconds, or returns output that does not parse as Draft_Item JSON, THEN THE TripWise_API SHALL return HTTP status 502 with an error code and store no Plan_Item.
25. WHEN the TripWise_App receives a draft error, THE TripWise_App SHALL show a message stating that drafts could not be created and keep the Draft_Notes unchanged.
26. IF a draft request fails, THEN THE TripWise_API SHALL write a CloudWatch log entry with event DRAFT_FAILED and the failure reason (Bedrock error, model access denied, timeout, or unparseable output).
27. THE TripWise_API SHALL redact the Draft_Notes, the Bedrock prompt, and the Bedrock response from CloudWatch log entries.
28. WHEN the TripWise_API receives a draft request, THE TripWise_API SHALL add 1 to the CloudWatch DraftRequestCount metric.
29. WHEN the TripWise_API returns Draft_Items, THE TripWise_API SHALL add the number of returned Draft_Items to the CloudWatch DraftItemCount metric.

### Requirement 23: Shared Updates on Reload

**User Story:** As a Member, I want to see changes other Members made when I reload, so that everyone works from the same plan.

#### Acceptance Criteria

1. WHEN a Member loads or reloads a Trip page, THE TripWise_App SHALL fetch the current Plan_Items, Trip_Constraints, and latest Check_Result from the TripWise_API.
2. WHEN a Member saves a change, THE TripWise_API SHALL make the change readable by every other Member on their next request.
3. IF a Member submits an update for a Plan_Item whose stored lastModifiedAt differs from the lastModifiedAt the Member last read, THEN THE TripWise_API SHALL reject the update with HTTP status 409 and return the stored Plan_Item.

### Requirement 24: Notifications and Reminders

**User Story:** As a Member, I want alerts for invitations, check results, and the upcoming trip, so that I do not miss important updates.

#### Acceptance Criteria

1. WHEN a Check_Result is saved, THE Notification_Service SHALL publish a check-result alert through Amazon SNS to every Member containing the Trip name, Feasibility_Score, and label.
2. WHEN a Trip is created or its start date changes, THE Reminder_Scheduler SHALL create or update one Amazon EventBridge Scheduler schedule that fires 2 days before the Trip start date.
3. WHEN the pre-trip reminder schedule fires, THE Notification_Service SHALL publish a reminder through Amazon SNS to every Member containing the Trip name and start date.
4. IF an Amazon SNS publish fails, THEN THE Notification_Service SHALL log the failure to CloudWatch and leave the originating Trip operation successful.

### Requirement 25: Security and Infrastructure

**User Story:** As the project owner, I want least-privilege, private infrastructure defined in code, so that the app is secure and reproducible.

#### Acceptance Criteria

1. THE TripWise_API SHALL run in a single AWS Region defined in the Terraform configuration.
2. THE Terraform configuration SHALL define every AWS resource used by TripWise, including Cognito, API Gateway, Lambda, DynamoDB, S3, SNS, EventBridge Scheduler, IAM roles, and CloudWatch alarms.
3. THE Terraform configuration SHALL assign each Lambda function its own IAM role granting only the actions and resource ARNs that function uses.
4. THE File_Store SHALL block all public access on the confirmation-file and Catalog prefixes and serve the web app through Amazon CloudFront with origin access control.
5. THE File_Store and Plan_Store SHALL encrypt stored data at rest.
6. THE TripWise_API SHALL omit door codes, confirmation numbers, and identity tokens from CloudWatch log entries.

### Requirement 26: Observability

**User Story:** As the project owner, I want logs and metrics, so that I can diagnose failures during the build and the demo.

#### Acceptance Criteria

1. THE TripWise_API SHALL write a structured JSON log entry to CloudWatch for each request containing the request ID, route, HTTP status, and duration in milliseconds.
2. THE Feasibility_Engine SHALL publish a CloudWatch metric for each run recording the run duration and the count of failed Checks.
3. THE Explanation_Service SHALL publish a CloudWatch metric counting template-explanation fallbacks.

### Requirement 27: Demo Scenario

**User Story:** As the presenter, I want a repeatable demo, so that the instructor can see the full check-change-recheck flow.

#### Acceptance Criteria

1. THE TripWise project SHALL include a seed script that creates a Trip with 4 Members, a 4-night San Diego stay plan, a $2,500 total budget, and a selected Catalog stay that either sleeps 2 or brings the Cost measured value to $2,850.
2. WHEN the seeded feasibility check runs, THE Feasibility_Engine SHALL mark the Capacity Check or the Cost Check failed with the seeded values as measured value and limit.
3. WHEN a Member changes the Lodging Plan_Item to a Catalog stay that sleeps at least 4 and keeps the Cost measured value at or below $2,500 and reruns the check, THE Feasibility_Engine SHALL mark every Check passed.
4. WHEN the second Check_Result is saved, THE Explanation_Service SHALL store an explanation whose numbers match the stored Check_Outcomes.
5. WHEN a second Member reloads the Trip page after the change, THE TripWise_App SHALL display the changed Lodging Plan_Item and the passing Check_Result.

### Requirement 28: Testing

**User Story:** As the developer, I want automated tests for the check logic, so that the deterministic checks stay correct as the code changes.

#### Acceptance Criteria

1. THE TripWise project SHALL include fast-check property-based tests for the Cost, Capacity, Dates, Schedule, and Preferences Checks and the Feasibility_Score calculation.
2. THE TripWise project SHALL include unit tests confirming that the Membership_Guard rejects non-Members for every Trip route.
3. THE TripWise project SHALL include unit tests for the explanation number-grounding verification in Requirement 21.
4. THE TripWise project SHALL run all tests in a single non-watch command (for example, `vitest --run`).
