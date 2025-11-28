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

    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    if (!clientEmail || !privateKey || !spreadsheetId) {
      return res.status(500).json({ 
        error: 'Missing environment variables'
      });
    }

    let formattedPrivateKey = privateKey;
    if (privateKey.includes('\\n')) {
      formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: formattedPrivateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

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

    // PROMENA: Koristi Sheet1 umesto BazaVozila
    const sheetName = 'Sheet1';

    // Očisti postojeće podatke
    try {
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A2:E`,
      });
      console.log('Cleared existing data');
    } catch (clearError) {
      console.error('Clear error:', clearError.message);
      return res.status(500).json({
        error: 'Failed to clear sheet',
        details: clearError.message
      });
    }

    // Upiši nove podatke
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A2`,
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
      timestamp,
      sheetUsed: sheetName
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({ 
      error: 'Unexpected error',
      details: error.message
    });
  }
}
