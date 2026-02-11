function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function generateVisitsCsv(visits) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const headers = [
    'Visit ID', 'Timestamp', 'Sales Rep Name', 'Sales Rep Email',
    'Manager Name', 'Manager Email', 'Client Name', 'Client Status',
    'Client Location', 'Visit Location',
    'Visit Latitude', 'Visit Longitude', 'Accuracy (m)',
    'Distance from Client (m)', 'Within Geo-fence', 'Visit Purpose',
    'Notes', 'Selfie URL', 'Device ID', 'System Flag'
  ];

  const rows = visits.map(v => [
    v.id,
    v.created_at,
    v.rep_name,
    v.rep_email,
    v.manager_name || '',
    v.manager_email || '',
    v.client_name,
    v.client_status,
    v.client_location || '',
    v.visit_location_name || '',
    v.latitude,
    v.longitude,
    v.accuracy,
    v.distance_from_client,
    v.within_geofence ? 'Yes' : 'No',
    v.visit_purpose,
    v.notes,
    v.selfie_path ? baseUrl + v.selfie_path : '',
    v.device_fingerprint,
    v.system_flag
  ]);

  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = generateVisitsCsv;
