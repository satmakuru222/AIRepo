import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create a test user
  const user = await prisma.user.upsert({
    where: { primaryEmail: 'alice@example.com' },
    update: {},
    create: {
      displayName: 'Alice Johnson',
      primaryEmail: 'alice@example.com',
      whatsappNumber: '15551234567',
      status: 'active',
    },
  });

  // Create preferences
  await prisma.preference.upsert({
    where: { userId: user.userId },
    update: {},
    create: {
      userId: user.userId,
      defaultAction: 'remind_and_draft',
      tone: 'friendly',
      timezone: 'America/New_York',
      fallbackChannel: 'email',
    },
  });

  console.log(`Seeded user: ${user.displayName} (${user.userId})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
