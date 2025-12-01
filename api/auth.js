import { google } from 'googleapis';
import crypto from 'crypto';

// Funkcija za heširanje lozinke
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Funkcija za verifikaciju lozinke
function verifyPassword(password, hashedPassword) {
  return hashPassword(password) === hashedPassword;
}

// Google Sheets setup
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const USERS_SHEET = 'Users';

// DODATAK: Nova kolona "UserAgentHistory"
const SHEET_COLUMNS = [
  'Username',
  'PasswordHash',
  'Status',
  'RegisteredAt',
  'LastIP',
  'IPHistory',
  'IsAdmin',
  'LastAccess',
  'UserAgentHistory'
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, username, password, token, userIndex, status, captcha } =
    req.method === 'POST' ? req.body : req.query;

  try {
    let users = [];

    // =============================== PROVERI KOLONE I ČITAJ SVE KORISNIKE ===============================
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:I`, // Sada uključuje I kolonu (UserAgentHistory)
      });

      const rows = response.data.values || [];

      // Ako sheet nema header, kreiraj ga
      if (rows.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!A1:I1`,
          valueInputOption: 'RAW',
          resource: {
            values: [SHEET_COLUMNS],
          },
        });
      } else {
        users = rows.slice(1).map(row => ({
          username: row[0] || '',
          passwordHash: row[1] || '',
          status: row[2] || 'pending',
          registeredAt: row[3] || '',
          lastIP: row[4] || '',
          ipHistory: row[5] || '',
          isAdmin: row[6] === 'true' || row[6] === 'TRUE' || false,
          lastAccess: row[7] || '',
          userAgentHistory: row[8] || '',
        }));
      }
    } catch (error) {
      if (error.message && error.message.includes('Unable to parse range')) {
        console.log('Creating Users sheet...');
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: USERS_SHEET,
                  },
                },
              },
            ],
          },
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!A1:I1`,
          valueInputOption: 'RAW',
          resource: {
            values: [SHEET_COLUMNS],
          },
        });
        console.log('Users sheet created successfully');
      } else {
        throw error;
      }
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0] ||
      req.headers['x-real-ip'] ||
      'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // =============================== REGISTRACIJA ===============================
    if (action === 'register') {
      if (!captcha || captcha.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Molimo potvrdite da niste robot'
        });
      }

      const existingUser = users.find(u =>
        u.username.toLowerCase() === username.toLowerCase()
      );

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Korisničko ime već postoji'
        });
      }

      const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });
      const hashedPassword = hashPassword(password);

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:I`,
        valueInputOption: 'RAW',
        resource: {
          values: [[
            username,
            hashedPassword,
            'pending',
            now,
            ip,
            ip,
            'false',
            '',
            userAgent // UserAgentHistory kolona
          ]],
        },
      });

      return res.status(200).json({
        success: true,
        message: 'Zahtev za registraciju poslat! Čekajte odobrenje.'
      });
    }

    // =============================== LOGIN ===============================
    if (action === 'login') {
      const user = users.find(u => u.username === username);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Pogrešno korisničko ime ili lozinka'
        });
      }

      // Proveri lozinku (i podrži migraciju na hash)
      let isPasswordValid = false;
      let needsMigration = false;

      if (verifyPassword(password, user.passwordHash)) {
        isPasswordValid = true;
      } else if (user.passwordHash === password) {
        isPasswordValid = true;
        needsMigration = true;
      }

      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Pogrešno korisničko ime ili lozinka'
        });
      }

      if (user.status !== 'approved') {
        return res.status(403).json({
          success: false,
          message: user.status === 'rejected' ? 'Nalog je odbijen' : 'Nalog još nije odobren'
        });
      }

      // Ažuriraj IP, poslednji pristup i UserAgent istoriju
      const userIndex = users.findIndex(u => u.username === username);
      const ipHistory = user.ipHistory ? `${user.ipHistory}, ${ip}` : ip;
      const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });

      // NOVO: ažuriraj istoriju User-Agent
      let userAgentHistory = user.userAgentHistory ? `${user.userAgentHistory},${userAgent}` : userAgent;

      // Ograniči max dužinu (opciono, npr. poslednjih 20 zapisa)
      let uaArr = userAgentHistory.split(',').map(u => u.trim()).filter(u => u !== '');
      if (uaArr.length > 20) {
        uaArr = uaArr.slice(uaArr.length - 20);
      }
      userAgentHistory = uaArr.join(',');

      // Ako treba migracija, sačuvaj hash
      const passwordToStore = needsMigration ? hashPassword(password) : user.passwordHash;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!B${userIndex + 2}:I${userIndex + 2}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[
            passwordToStore,
            user.status,
            user.registeredAt,
            ip,
            ipHistory,
            user.isAdmin ? 'true' : 'false',
            now,
            userAgentHistory
          ]],
        },
      });

      if (needsMigration) {
        console.log(`✓ Migrated password for user: ${username}`);
      }

      const newToken = Buffer.from(`${username}:${Date.now()}`).toString('base64');

      return res.status(200).json({
        success: true,
        message: 'Uspešna prijava',
        token: newToken,
        username: username,
        isAdmin: user.isAdmin
      });
    }

    // =============================== PROVERA TOKENA ===============================
    if (action === 'verify') {
      if (!token) {
        return res.status(401).json({ success: false, message: 'Nema tokena' });
      }
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const [tokenUsername, timestamp] = decoded.split(':');
        const user = users.find(u => u.username === tokenUsername);

        if (!user || user.status !== 'approved') {
          return res.status(401).json({ success: false, message: 'Nevažeći token' });
        }

        const tokenAge = Date.now() - parseInt(timestamp);
        if (tokenAge > 7 * 24 * 60 * 60 * 1000) { // 7 dana
          return res.status(401).json({ success: false, message: 'Token je istekao' });
        }

        // Ažuriraj poslednji pristup i UserAgentHistory
        const userIndex = users.findIndex(u => u.username === tokenUsername);
        const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });
        
        // NOVO: ažuriraj istoriju User-Agent kao u loginu
        let userAgentHistory = user.userAgentHistory ? `${user.userAgentHistory},${userAgent}` : userAgent;
        let uaArr = userAgentHistory.split(',').map(u => u.trim()).filter(u => u !== '');
        if (uaArr.length > 20) {
          uaArr = uaArr.slice(uaArr.length - 20);
        }
        userAgentHistory = uaArr.join(',');

        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!H${userIndex + 2}:I${userIndex + 2}`,
          valueInputOption: 'RAW',
          resource: {
            values: [[now, userAgentHistory]],
          },
        });

        return res.status(200).json({ success: true, username: tokenUsername, isAdmin: user.isAdmin });
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Nevažeći token' });
      }
    }

    // =============================== LISTA KORISNIKA (za admin) ===============================
    if (action === 'listUsers') {
      if (!token) {
        return res.status(401).json({ success: false, message: 'Neautorizovan pristup' });
      }
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const [tokenUsername] = decoded.split(':');
        const requestUser = users.find(u => u.username === tokenUsername);

        if (!requestUser || !requestUser.isAdmin) {
          return res.status(403).json({ success: false, message: 'Nemate admin privilegije' });
        }
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Nevažeći token' });
      }

      const sanitizedUsers = users.map(u => ({
        username: u.username,
        status: u.status,
        registeredAt: u.registeredAt,
        lastIP: u.lastIP,
        ipHistory: u.ipHistory,
        isAdmin: u.isAdmin,
        lastAccess: u.lastAccess,
        userAgentHistory: u.userAgentHistory // Dodato
      }));

      return res.status(200).json({ success: true, users: sanitizedUsers });
    }

    // =============================== AŽURIRANJE STATUSA (za admin) ===============================
    if (action === 'updateStatus') {
      if (!token) {
        return res.status(401).json({ success: false, message: 'Neautorizovan pristup' });
      }
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const [tokenUsername] = decoded.split(':');
        const requestUser = users.find(u => u.username === tokenUsername);

        if (!requestUser || !requestUser.isAdmin) {
          return res.status(403).json({ success: false, message: 'Nemate admin privilegije' });
        }
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Nevažeći token' });
      }

      if (!userIndex || !status) {
        return res.status(400).json({
          success: false,
          message: 'Nedostaju parametri'
        });
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!C${userIndex}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[status]],
        },
      });

      return res.status(200).json({ success: true, message: 'Status ažuriran' });
    }

    return res.status(400).json({ error: 'Nevažeća akcija' });
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server greška',
      details: error.message
    });
  }
}
