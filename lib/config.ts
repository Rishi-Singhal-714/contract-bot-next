// Central configuration. Everything secret comes from environment variables —
// never hardcode API keys, email passwords, or credentials in source files.
// Set these in Vercel Project Settings -> Environment Variables (and .env.local for dev).

export const config = {
  // --- Supabase (STORAGE ONLY — file buckets, not the database) ---
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  templatesBucket: process.env.SUPABASE_TEMPLATES_BUCKET || 'contract-templates',
  attachmentsBucket: process.env.SUPABASE_ATTACHMENTS_BUCKET || 'attachments',
  exportsBucket: process.env.SUPABASE_EXPORTS_BUCKET || 'exports',

  // --- MySQL (the database — separate from Supabase) ---
  mysqlHost: process.env.MYSQL_HOST || 'localhost',
  mysqlPort: parseInt(process.env.MYSQL_PORT || '3306', 10),
  mysqlUser: process.env.MYSQL_USER || 'root',
  mysqlPassword: process.env.MYSQL_PASSWORD || '',
  mysqlDatabase: process.env.MYSQL_DATABASE || 'contract_bot',

  // --- AI (NVIDIA / DeepSeek endpoint) ---
  nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
  nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  aiModel: process.env.AI_MODEL || 'deepseek-ai/deepseek-v4-pro',

  // --- Email ---
  imapHost: process.env.IMAP_HOST || 'imap.gmail.com',
  imapPort: parseInt(process.env.IMAP_PORT || '993', 10),
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  emailAddress: process.env.EMAIL_ADDRESS || '',
  emailPassword: process.env.EMAIL_PASSWORD || '',

  // --- Employees who receive escalations / summaries ---
  employeeEmails: (process.env.EMPLOYEE_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean),

  // --- Business rules ---
  expiryWarningDays: parseInt(process.env.EXPIRY_WARNING_DAYS || '14', 10),
  contractMatchThreshold: parseFloat(process.env.CONTRACT_MATCH_THRESHOLD || '0.90'),

  // --- Cron auth ---
  cronSecret: process.env.CRON_SECRET || '',
};
