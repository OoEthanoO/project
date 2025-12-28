// Export all user data to JSON (lightweight backup)
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pkgPg from 'pg';
const { Pool } = pkgPg;
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';
import { mkdir } from 'fs/promises';

// Ensure DATABASE_URL is set
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('❌ DATABASE_URL environment variable is required');
  console.error('Usage: DATABASE_URL="..." node export-user-data.js');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function exportData() {
  try {
    console.log('🔄 Exporting user data...');
    
    // Create backups directory
    await mkdir('backups', { recursive: true });
    
    // Export all data
    const users = await prisma.user.findMany({
      include: {
        state: true,
        topups: true,
        usageCharges: true
      }
    });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backups/user_data_${timestamp}.json`;
    
    writeFileSync(filename, JSON.stringify(users, null, 2));
    
    console.log('✅ Export successful!');
    console.log('📁 File:', filename);
    console.log('👥 Users exported:', users.length);
    console.log('📊 States:', users.filter(u => u.state).length);
    
    // Show summary
    users.forEach(user => {
      const taskCount = user.state?.tasks ? JSON.parse(JSON.stringify(user.state.tasks)).length : 0;
      console.log(`  - ${user.email}: ${taskCount} tasks`);
    });
    
  } catch (error) {
    console.error('❌ Export failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

exportData();
