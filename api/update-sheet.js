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

    const now = new Date();
    const timestamp = now.toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // Kreiraj ime sheet-a po datumu: "2025-11-29"
    const dateStr = now.toLocaleDateString('sr-RS', {
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).split('.').reverse().join('-').replace(/\.$/, '');

    const sheetName = dateStr;
    console.log(`Target sheet: ${sheetName}`);

    // Proveri da li sheet postoji, ako ne - kreiraj ga
    let sheetId = null;
    try {
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const existingSheet = spreadsheet.data.sheets.find(
        s => s.properties.title === sheetName
      );
      
      if (existingSheet) {
        sheetId = existingSheet.properties.sheetId;
        console.log(`✓ Sheet "${sheetName}" already exists (ID: ${sheetId})`);
      } else {
        // Kreiraj novi sheet
        const addSheetResponse = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          resource: {
            requests: [{
              addSheet: {
                properties: {
                  title: sheetName,
                  gridProperties: {
                    rowCount: 5000,
                    columnCount: 6,
                    frozenRowCount: 1
                  }
                }
              }
            }]
          }
        });
        
        sheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
        console.log(`✓ Created new sheet "${sheetName}" (ID: ${sheetId})`);
        
        // Dodaj header red
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1:F1`,
          valueInputOption: 'RAW',
          resource: {
            values: [['Vozilo', 'Linija', 'Polazak', 'Smer', 'Vreme upisa', 'Datum']]
          }
        });
        
        // Formatiraj header
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          resource: {
            requests: [{
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 6
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.12, green: 0.24, blue: 0.45 },
                    textFormat: {
                      foregroundColor: { red: 1, green: 1, blue: 1 },
                      fontSize: 11,
                      bold: true
                    }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
              }
            }]
          }
        });
      }
    } catch (error) {
      console.error('Error checking/creating sheet:', error.message);
      throw error;
    }

    // Pročitaj postojeće podatke iz današnjeg sheet-a
    let existingData = [];
    try {
      const readResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A2:F`,
      });
      existingData = readResponse.data.values || [];
      console.log(`Found ${existingData.length} existing rows in ${sheetName}`);
    } catch (readError) {
      console.log('No existing data:', readError.message);
    }

    // Kreiraj mapu postojećih vozila
    const existingVehicles = new Map();
    existingData.forEach((row, index) => {
      if (row[0]) {
        existingVehicles.set(row[0], {
          rowIndex: index + 2,
          data: row
        });
      }
    });

    // OPTIMIZACIJA: Grupiši vozila u batch-eve od 500
    const BATCH_SIZE = 500;
    const batches = [];
    
    for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
      batches.push(vehicles.slice(i, i + BATCH_SIZE));
    }

    console.log(`Processing ${batches.length} batches of max ${BATCH_SIZE} vehicles each`);

    let totalNewCount = 0;
    let totalUpdateCount = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} vehicles)`);

      // Pripremi podatke za ovaj batch
      const finalData = [...existingData];
      let newCount = 0;
      let updateCount = 0;

      batch.forEach(v => {
        const vehicleLabel = v.vehicleLabel || '';
        const rowData = [
          vehicleLabel,
          v.routeDisplayName || '',
          v.startTime || '',
          v.destName || '',
          timestamp,
          timestamp.split(',')[0].trim()
        ];

        if (existingVehicles.has(vehicleLabel)) {
          // Ažuriraj postojeći red
          const existingRow = existingVehicles.get(vehicleLabel);
          const arrayIndex = existingRow.rowIndex - 2;
          finalData[arrayIndex] = rowData;
          updateCount++;
        } else {
          // Dodaj novi red
          finalData.push(rowData);
          newCount++;
          existingVehicles.set(vehicleLabel, { 
            rowIndex: finalData.length + 1, 
            data: rowData 
          });
        }
      });

      // Ažuriraj sheet sa ovim batch-em
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A2:F${finalData.length + 1}`,
          valueInputOption: 'RAW',
          resource: {
            values: finalData
          }
        });
        console.log(`✓ Batch ${batchIndex + 1}: ${updateCount} updated, ${newCount} new`);
        
        totalNewCount += newCount;
        totalUpdateCount += updateCount;
        
        // Ažuriraj existingData za sledeći batch
        existingData = finalData;
        
      } catch (updateError) {
        console.error(`Failed to update batch ${batchIndex + 1}:`, updateError.message);
        throw updateError;
      }

      // Pauza između batch-eva da izbegnemo rate limiting
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Sortiranje na kraju
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            sortRange: {
              range: {
                sheetId: sheetId,
                startRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 6,
              },
              sortSpecs: [{
                dimensionIndex: 0,
                sortOrder: 'ASCENDING',
              }],
            },
          }],
        },
      });
      console.log('✓ Data sorted successfully');
    } catch (sortError) {
      console.warn('Sort error (non-critical):', sortError.message);
    }

    console.log('=== Update Complete ===');

    res.status(200).json({ 
      success: true, 
      newVehicles: totalNewCount,
      updatedVehicles: totalUpdateCount,
      totalProcessed: vehicles.length,
      timestamp,
      sheetUsed: sheetName,
      batchesProcessed: batches.length
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({ 
      error: 'Unexpected error',
      details: error.message
    });
  }
}
