/**
 * Demo seed (Req 27.1). Creates 4 Cognito test users and a 4-night San Diego Trip whose selected
 * Lodging (`sd-gaslamp-studio`, sleeps 2) fails the Capacity check for 4 travelers.
 *
 * Runs against a deployed stack:
 *   npm run seed -w scripts -- --user-pool-id <UserPoolId> --table-name <TableName> [--region us-west-2] [--start YYYY-MM-DD]
 *
 * Config (CLI flag, else env var):
 *   --user-pool-id  USER_POOL_ID    Terraform output `UserPoolId`
 *   --table-name    TABLE_NAME      Terraform output `TableName`
 *   --region        AWS_REGION      defaults to the SDK's normal region resolution
 *   --start         (none)          trip start; defaults to 30 days from today (UTC)
 *   SEED_EMAILS     4 comma-separated emails (default demo1..demo4@example.com)
 *   SEED_PASSWORD   permanent password for every seed user (default below)
 *   REMINDER_FUNCTION_ARN, SCHEDULER_ROLE_ARN  optional; when both are set the pre-trip reminder is scheduled
 *
 * Re-running is safe: existing users, the Trip, Memberships and Plan_Items are left as they are,
 * and the constraints are rewritten with the same values.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  IsoDateSchema,
  lodgingFromCatalogStay,
  parseCatalog,
  type Catalog,
  type GroceriesFields,
  type IsoDate,
  type ItineraryFields,
  type LodgingFields,
  type PlanItem,
  type Trip,
  type TripConstraints,
} from '@tripwise/shared';
import { upsertReminder } from '../services/api/src/adapters/scheduler.js';
import { createDocumentClient, createDynamoRepos } from '../services/api/src/repos/dynamo/index.js';

export const SEED_STAY_ID = 'sd-gaslamp-studio';
export const SEED_NIGHTS = 4;
export const DEFAULT_EMAILS = ['demo1@example.com', 'demo2@example.com', 'demo3@example.com', 'demo4@example.com'];
export const DEFAULT_PASSWORD = 'TripWiseDemo2025';

export interface SeedMember {
  userId: string;
  email: string;
}

export interface SeedData {
  trip: Trip;
  /** The host first, then the 3 invited Members. */
  members: Array<SeedMember & { displayName: string }>;
  constraints: TripConstraints;
  planItems: PlanItem[];
}

/** `YYYY-MM-DD` plus `days` calendar days (UTC). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Default start: 30 days after today's UTC date, so the 2-day reminder is in the future. */
export function defaultStartDate(nowMs: number = Date.now()): IsoDate {
  return addDays(new Date(nowMs).toISOString().slice(0, 10), 30);
}

export function loadCatalog(): Catalog {
  const raw: unknown = JSON.parse(readFileSync(new URL('../catalog/san-diego-v1.json', import.meta.url), 'utf8'));
  const parsed = parseCatalog(raw, 'san-diego-v1');
  if (!parsed.ok) throw new Error(`Catalog is invalid: ${JSON.stringify(parsed.errors)}`);
  return parsed.catalog;
}

/**
 * Builds the demo Trip, constraints and Plan_Items for a start date (pure, no AWS calls).
 * `members[0]` is the host. The Trip ID is derived from the start date so a re-run finds it.
 */
export function buildSeedData(input: {
  startDate: IsoDate;
  members: SeedMember[];
  catalog: Catalog;
  now: string;
}): SeedData {
  const { startDate, catalog, now } = input;
  if (!IsoDateSchema.safeParse(startDate).success) throw new Error(`Invalid start date: ${startDate}`);
  if (input.members.length !== 4) throw new Error('The demo needs exactly 4 members');
  const endDate = addDays(startDate, SEED_NIGHTS);
  const stay = catalog.stays.find((s) => s.id === SEED_STAY_ID);
  if (!stay) throw new Error(`Catalog has no stay ${SEED_STAY_ID}`);

  const members = input.members.map((m) => ({ ...m, displayName: m.email.split('@')[0] || m.email }));
  const host = members[0]!;
  const tripId = `seed-san-diego-${startDate}`;
  const trip: Trip = {
    tripId,
    name: 'San Diego Getaway',
    destination: 'San Diego',
    startDate,
    endDate,
    hostId: host.userId,
    createdAt: now,
  };

  const constraints: TripConstraints = {
    destination: 'San Diego',
    startDate,
    endDate,
    travelerCount: 4,
    budgetCents: 250_000,
    budgetType: 'total',
    requiredFeatures: [],
    plannedActivityIds: ['sd-balboa-park', 'sd-uss-midway', 'sd-la-jolla-kayak', 'sd-sunset-cliffs'],
    accessibilityNeeds: [],
  };

  const item = <F>(section: PlanItem['section'], itemId: string, fields: F): PlanItem =>
    ({ tripId, itemId, section, fields, lastModifiedBy: host.userId, lastModifiedAt: now, createdAt: now }) as PlanItem;

  const lodging: LodgingFields = {
    ...lodgingFromCatalogStay(stay),
    checkIn: startDate,
    checkOut: endDate,
    selected: true,
  };

  const itinerary: Array<[string, ItineraryFields]> = [
    ['seed-itin-1', { day: addDays(startDate, 1), startTime: '09:00', endTime: '12:00', stopName: 'Balboa Park' }],
    ['seed-itin-2', { day: addDays(startDate, 1), startTime: '13:30', endTime: '16:00', stopName: 'USS Midway Museum' }],
    ['seed-itin-3', { day: addDays(startDate, 2), startTime: '10:00', endTime: '13:00', stopName: 'La Jolla Cove' }],
    ['seed-itin-4', { day: addDays(startDate, 3), startTime: '18:30', stopName: 'Sunset Cliffs', notes: 'Sunset picnic' }],
  ];

  const groceries: Array<[string, GroceriesFields]> = [
    ['seed-groc-1', { name: 'Coffee', quantity: 1, responsibleMemberId: members[0]!.userId, purchased: false }],
    ['seed-groc-2', { name: 'Bagels', quantity: 12, responsibleMemberId: members[1]!.userId, purchased: false }],
    ['seed-groc-3', { name: 'Sparkling water', quantity: 8, responsibleMemberId: members[2]!.userId, purchased: false }],
    ['seed-groc-4', { name: 'Picnic snacks', quantity: 4, responsibleMemberId: members[3]!.userId, purchased: false }],
  ];

  const planItems: PlanItem[] = [
    item('Lodging', 'seed-lodging-1', lodging),
    ...itinerary.map(([id, f]) => item('Itinerary', id, f)),
    ...groceries.map(([id, f]) => item('Groceries', id, f)),
  ];

  return { trip, members, constraints, planItems };
}

// ---------- AWS side ----------

interface Config {
  userPoolId: string;
  tableName: string;
  region?: string;
  startDate: IsoDate;
  emails: string[];
  password: string;
}

function readConfig(argv: string[], env: NodeJS.ProcessEnv): Config {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const userPoolId = flag('user-pool-id') ?? env.USER_POOL_ID;
  const tableName = flag('table-name') ?? env.TABLE_NAME;
  if (!userPoolId || !tableName) {
    throw new Error('Set --user-pool-id/USER_POOL_ID and --table-name/TABLE_NAME (stack outputs UserPoolId, TableName)');
  }
  const startDate = flag('start') ?? defaultStartDate();
  if (!IsoDateSchema.safeParse(startDate).success) throw new Error(`--start must be YYYY-MM-DD, got ${startDate}`);
  const emails = env.SEED_EMAILS
    ? env.SEED_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_EMAILS;
  if (emails.length !== 4) throw new Error(`SEED_EMAILS must list exactly 4 emails, got ${emails.length}`);
  return {
    userPoolId,
    tableName,
    region: flag('region') ?? env.AWS_REGION,
    startDate,
    emails,
    password: env.SEED_PASSWORD ?? DEFAULT_PASSWORD,
  };
}

const errorName = (err: unknown): string | undefined => (err instanceof Error ? err.name : undefined);

/** Returns the user's `sub`, creating the user (verified email, permanent password) if missing. */
async function ensureUser(cognito: CognitoIdentityProviderClient, cfg: Config, email: string): Promise<string> {
  const subOf = (attrs: Array<{ Name?: string; Value?: string }> | undefined): string => {
    const sub = attrs?.find((a) => a.Name === 'sub')?.Value;
    if (!sub) throw new Error(`No sub for ${email}`);
    return sub;
  };
  try {
    const existing = await cognito.send(new AdminGetUserCommand({ UserPoolId: cfg.userPoolId, Username: email }));
    console.log(`  user ${email} exists, skipping`);
    return subOf(existing.UserAttributes);
  } catch (err) {
    if (errorName(err) !== 'UserNotFoundException') throw err;
  }
  const created = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: cfg.userPoolId,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
    }),
  );
  await cognito.send(
    new AdminSetUserPasswordCommand({ UserPoolId: cfg.userPoolId, Username: email, Password: cfg.password, Permanent: true }),
  );
  console.log(`  user ${email} created`);
  return subOf(created.User?.Attributes);
}

async function main(): Promise<void> {
  const cfg = readConfig(process.argv.slice(2), process.env);
  // The scheduler adapter builds its own client, which reads the region from the environment.
  if (cfg.region) process.env.AWS_REGION = cfg.region;
  const cognito = new CognitoIdentityProviderClient({ region: cfg.region });
  const repos = createDynamoRepos({
    doc: createDocumentClient(new DynamoDBClient({ region: cfg.region })),
    tableName: cfg.tableName,
    gsi1Name: 'GSI1',
  });

  console.log('Cognito users:');
  const members: SeedMember[] = [];
  for (const email of cfg.emails) members.push({ userId: await ensureUser(cognito, cfg, email), email });

  const now = new Date().toISOString();
  const seed = buildSeedData({ startDate: cfg.startDate, members, catalog: loadCatalog(), now });
  const { trip, constraints, planItems } = seed;
  const [host, ...guests] = seed.members;

  console.log(`Trip ${trip.tripId} (${trip.startDate} to ${trip.endDate}):`);
  if (await repos.trips.get(trip.tripId)) {
    console.log('  trip exists, skipping create');
  } else {
    await repos.trips.create(trip, { displayName: host!.displayName, email: host!.email });
    console.log('  trip created');
  }

  // Non-host Memberships go through the same invite + accept transaction as the API.
  for (const m of guests) {
    if (await repos.memberships.get(trip.tripId, m.userId)) continue;
    const inviteId = `seed-${trip.tripId}-${m.userId}`;
    await repos.invitations.create({ tripId: trip.tripId, inviteId, email: m.email, invitedBy: host!.userId, createdAt: now });
    const res = await repos.invitations.accept({
      tripId: trip.tripId,
      inviteId,
      tripName: trip.name,
      member: { userId: m.userId, displayName: m.displayName, email: m.email },
      acceptedAt: now,
    });
    if (!res.ok) throw new Error(`Could not add ${m.email}: ${res.reason}`);
    console.log(`  member ${m.email} added`);
  }

  await repos.constraints.put(trip.tripId, constraints, { lastModifiedBy: host!.userId, lastModifiedAt: now });
  console.log('  constraints saved (4 travelers, $2,500 total)');

  for (const item of planItems) {
    if (await repos.planItems.get(item.tripId, item.section, item.itemId)) continue;
    await repos.planItems.create(item);
    console.log(`  ${item.section} ${item.itemId} created`);
  }

  if (process.env.REMINDER_FUNCTION_ARN && process.env.SCHEDULER_ROLE_ARN) {
    console.log(`  reminder: ${await upsertReminder({ tripId: trip.tripId, startDate: trip.startDate })}`);
  } else {
    console.log('  reminder not scheduled (set REMINDER_FUNCTION_ARN and SCHEDULER_ROLE_ARN, or save the constraints once in the app)');
  }

  console.log(`\nDone. Sign in with any of: ${cfg.emails.join(', ')}`);
  if (!process.env.SEED_PASSWORD) console.log(`Password: ${DEFAULT_PASSWORD} (set SEED_PASSWORD to change it)`);
  if (!process.env.SEED_EMAILS) {
    console.log('Note: example.com addresses cannot receive SNS email. Set SEED_EMAILS to 4 real addresses to get notifications.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
