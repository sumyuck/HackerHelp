import axios from 'axios';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

async function upload() {
  const filePath = path.join(__dirname, '../../rules.txt');
  
  if (!fs.existsSync(filePath)) {
    console.error(`Error: rules.txt file not found at ${filePath}`);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: 'text/markdown' });

  const formData = new FormData();
  formData.append('file', blob, 'rules.txt');
  
  // Get admin actorId
  const superAdminIds = (process.env.SUPER_ADMIN_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
    
  const actorId = superAdminIds[0];
  if (!actorId) throw new Error('Set SUPER_ADMIN_IDS before uploading rules.');
  formData.append('actorId', actorId);

  const port = process.env.PORT || 3000;
  console.log(`Uploading rules.txt to http://localhost:${port}/api/documents/upload using actorId: ${actorId} ...`);

  try {
    const response = await axios.post(`http://localhost:${port}/api/documents/upload`, formData);
    console.log('Upload Response Success:', response.data);
  } catch (error: any) {
    console.error('Upload failed:', error.response?.data || error.message);
    process.exitCode = 1;
  }
}

upload().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
