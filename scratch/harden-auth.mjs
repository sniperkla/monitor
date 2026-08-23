import fs from 'fs';
const NL = String.fromCharCode(10);
let s = fs.readFileSync('src/lib/auth.js', 'utf8');

if (!s.includes('loginRateLimit')) {
  s = s.replace(
    "import { logger } from '@/lib/logger';",
    "import { logger } from '@/lib/logger';" + NL +
    "import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from '@/lib/loginRateLimit';"
  );
}

const oldAuth = [
  '      async authorize(credentials) {',
  '        if (!credentials?.email || !credentials?.password) {',
  '          throw new Error("Email and password are required");',
  '        }',
  '',
  '        const cleanEmail = String(credentials.email).trim().toLowerCase();',
].join(NL);

const newAuth = [
  '      async authorize(credentials, req) {',
  '        if (!credentials?.email || !credentials?.password) {',
  '          throw new Error("Email and password are required");',
  '        }',
  '',
  '        const cleanEmail = String(credentials.email).trim().toLowerCase();',
  "        const ip =",
  "          req?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ||",
  "          req?.headers?.get('x-real-ip') ||",
  "          'unknown';",
  '        const gate = checkLoginAllowed({ email: cleanEmail, ip });',
  '        if (!gate.allowed) {',
  '          throw new Error(',
  '            `Too many failed login attempts. Try again in ${Math.ceil(gate.retryAfterSec / 60)} minutes.`',
  '          );',
  '        }',
].join(NL);
if (!s.includes(oldAuth)) { console.error('authorize anchor miss'); process.exit(1); }
s = s.replace(oldAuth, newAuth);

const oldInvalid = [
  '        if (!dbUser || !dbUser.password) {',
  '          throw new Error("Invalid email or password");',
  '        }',
  '',
  '        const isValid = await bcrypt.compare(credentials.password, dbUser.password);',
  '        if (!isValid) {',
  '          throw new Error("Invalid email or password");',
  '        }',
].join(NL);

const newInvalid = [
  '        if (!dbUser || !dbUser.password) {',
  '          recordLoginFailure({ email: cleanEmail, ip });',
  '          throw new Error("Invalid email or password");',
  '        }',
  '',
  '        const isValid = await bcrypt.compare(credentials.password, dbUser.password);',
  '        if (!isValid) {',
  '          recordLoginFailure({ email: cleanEmail, ip });',
  '          throw new Error("Invalid email or password");',
  '        }',
  '        recordLoginSuccess({ email: cleanEmail });',
].join(NL);
if (!s.includes(oldInvalid)) { console.error('invalid anchor miss'); process.exit(1); }
s = s.replace(oldInvalid, newInvalid);

const oldSecret = "secret: process.env.NEXTAUTH_SECRET || process.env.ENCRYPTION_KEY || 'b5caf31cfa8c03a8ac8350f76e35eee30ed4e1d57f25596f900a558e6c98c04e',";
const newSecret = [
  '// No hardcoded fallback: a predictable secret would let attackers forge session JWTs.',
  '  // Fail fast at startup if NEXTAUTH_SECRET is not configured.',
  '  secret: process.env.NEXTAUTH_SECRET || process.env.ENCRYPTION_KEY,',
].join(NL);
if (!s.includes(oldSecret)) { console.error('secret anchor miss'); process.exit(1); }
s = s.replace(oldSecret, newSecret);

fs.writeFileSync('src/lib/auth.js', s);
console.log('auth.js hardened');
