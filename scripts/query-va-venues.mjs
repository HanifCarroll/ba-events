import { db } from '../src/db/index.js';
import { venues } from '../src/db/schema.js';
import { sql, or, like } from 'drizzle-orm';

const results = await db.select({
  name: venues.name,
  address: venues.address,
  created_at: venues.createdAt
}).from(venues).where(
  or(
    like(venues.address, '%VA%'),
    like(venues.address, '%Reston%'),
    like(venues.address, '%Sterling%'),
    like(venues.address, '%McLean%'),
    like(venues.address, '%Oakton%')
  )
).orderBy(sql`${venues.createdAt} DESC`);

console.table(results);
process.exit(0);
