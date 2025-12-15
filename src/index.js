import { Hono } from 'hono';

const app = new Hono();

// Wrapper funkcija da adaptuje Vercel (req, res) u Hono context
const adaptHandler = (handler) => async (c) => {
  const req = {
    method: c.req.method,
    url: c.req.url,
    headers: c.req.headers,
    query: c.req.query(),
    body: await c.req.arrayBuffer(), // Ako treba body, adaptuj po potrebi (za JSON: await c.req.json())
  };

  let statusCode = 200;
  const headers = new Headers();
  let body = null;

  const res = {
    status: (code) => { statusCode = code; return res; },
    setHeader: (key, value) => headers.set(key, value),
    send: (data) => { body = data; },
    json: (data) => { 
      body = JSON.stringify(data); 
      headers.set('Content-Type', 'application/json'); 
    },
    // Dodaj ako treba redirect ili drugo
  };

  await handler(req, res); // Pozovi original handler

  return new Response(body, { status: statusCode, headers });
};

// Importuj i registruj svaki handler (dodaj sve .js iz api/)
import auth from '../api/auth.js';
app.all('/api/auth', adaptHandler(auth));

import getSheetData from '../api/get-sheet-data.js';
app.get('/api/get-sheet-data', adaptHandler(getSheetData)); // Po method-u iz code-a

import hourlyCheck from '../api/hourly-check.js';
app.all('/api/hourly-check', adaptHandler(hourlyCheck));

import linije from '../api/linije.js';
app.get('/api/linije', adaptHandler(linije));

import resetDepartures from '../api/reset-departures.js';
app.all('/api/reset-departures', adaptHandler(resetDepartures));

import shapes from '../api/shapes.js';
app.all('/api/shapes', adaptHandler(shapes));

import stations from '../api/stations.js';
app.all('/api/stations', adaptHandler(stations));

import sve from '../api/sve.js';
app.get('/api/sve', adaptHandler(sve));

import updateDeparturesSheet from '../api/update-departures-sheet.js';
app.all('/api/update-departures-sheet', adaptHandler(updateDeparturesSheet));

import updateSheet from '../api/update-sheet.js';
app.all('/api/update-sheet', adaptHandler(updateSheet));

import vehicles from '../api/vehicles.js';
app.all('/api/vehicles', adaptHandler(vehicles));

// Za ostale fajlove u api/ (txt, json, html) - ako su static, premesti ih u public/api/ ili handle ovde ako dinamični

export default app;
