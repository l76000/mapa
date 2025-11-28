import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('=== Google Sheets Update Request ===');
  
  try {
    const { vehicles } = req.body;

    if (!vehicles || !Array.isArray(vehicles)) {
      console.error('Invalid data format');
      return res.status(400).json({ error: 'Invalid data format' });
    }

    console.log(`Received ${vehicles.length} vehicles`);

    // Detaljnija provera environment variables
    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    console.log('Environment variables check:');
    console.log('- CLIENT_EMAIL exists:', !!clientEmail);
    console.log('- PRIVATE_KEY exists:', !!privateKey);
    console.log('- SPREADSHEET_ID exists:', !!spreadsheetId);

    if (!clientEmail) {
      console.error('Missing GOOGLE_SHEETS_CLIENT_EMAIL');
      return res.status(500).json({ 
        error: 'Missing GOOGLE_SHEETS_CLIENT_EMAIL',
        hint: 'Add this in Vercel Environment Variables'
      });
    }

    if (!privateKey) {
      console.error('Missing GOOGLE_SHEETS_PRIVATE_KEY');
      return res.status(500).json({ 
        error: 'Missing GOOGLE_SHEETS_PRIVATE_KEY',
        hint: 'Add this in Vercel Environment Variables'
      });
    }

    if (!spreadsheetId) {
      console.error('Missing GOOGLE_SPREADSHEET_ID');
      return res.status(500).json({ 
        error: 'Missing GOOGLE_SPREADSHEET_ID',
        hint: 'Add this in Vercel Environment Variables'
      });
    }

    console.log('All environment variables present');

    // Pokušaj da parsiraš private key
    let formattedPrivateKey = privateKey;
    
    // Ako ima escaped newlines (\n), zameni ih sa pravim newlines
    if (privateKey.includes('\\n')) {
      console.log('Private key contains \\n, replacing with actual newlines');
      formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
    }

    // Proveri format
    if (!formattedPrivateKey.includes('BEGIN PRIVATE KEY')) {
      console.error('Private key does not contain BEGIN PRIVATE KEY');
      return res.status(500).json({
        error: 'Invalid private key format',
        hint: 'Private key must start with -----BEGIN PRIVATE KEY-----'
      });
    }

    console.log('Private key format looks good');

    // Google Sheets autentifikacija
    let auth;
    try {
      auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: clientEmail,
          private_key: formattedPrivateKey,
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      console.log('Auth object created successfully');
    } catch (authError) {
      console.error('Auth creation error:', authError.message);
      return res.status(500).json({
        error: 'Failed to create auth',
        details: authError.message
      });
    }

    const sheets = google.sheets({ version: 'v4', auth });
    console.log('Sheets API client created');

    // Pripremi podatke
    const timestamp = new Date().toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const rows = vehicles.map(v => [
      v.vehicleLabel || '',
      v.routeDisplayName || '',
      v.startTime || '',
      v.destName || '',
      timestamp
    ]);

    console.log(`Prepared ${rows.length} rows for update`);

    // Pokušaj da očistiš postojeće podatke
    try {
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: 'BazaVozila!A2:E',
      });
      console.log('Cleared existing data');
    } catch (clearError) {
      console.error('Clear error:', clearError.message);
      return res.status(500).json({
        error: 'Failed to clear sheet',
        details: clearError.message,
        hint: 'Check if the sheet "BazaVozila" exists and service account has access'
      });
    }

    // Upiši nove podatke
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'BazaVozila!A2',
        valueInputOption: 'RAW',
        resource: {
          values: rows,
        },
      });
      console.log('Data updated successfully');
    } catch (updateError) {
      console.error('Update error:', updateError.message);
      return res.status(500).json({
        error: 'Failed to update sheet',
        details: updateError.message
      });
    }

    // Pokušaj sortiranje (opcionalno)
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              sortRange: {
                range: {
                  sheetId: 0,
                  startRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 5,
                },
                sortSpecs: [
                  {
                    dimensionIndex: 0,
                    sortOrder: 'ASCENDING',
                  },
                ],
              },
            },
          ],
        },
      });
      console.log('Data sorted successfully');
    } catch (sortError) {
      console.warn('Sort error (non-critical):', sortError.message);
    }

    console.log('=== Update Complete ===');

    res.status(200).json({ 
      success: true, 
      updated: rows.length,
      timestamp 
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({ 
      error: 'Unexpected error',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
