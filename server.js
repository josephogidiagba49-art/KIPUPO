const express = require('express');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'state.json');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// AI Templates Pool (Harvard Phish Library)
const AI_TEMPLATES = {
  'bank-alert': { name: '🏦 Bank Alert', successRate: 92 },
  'verification': { name: '✅ Account Verification', successRate: 87 },
  'password-reset': { name: '🔑 Password Reset', successRate: 94 },
  'invoice': { name: '💰 Urgent Invoice', successRate: 89 },
  'hr-update': { name: '📋 HR Payroll Update', successRate: 91 },
  'shipping': { name: '📦 Package Delivery', successRate: 88 }
};

// State Machine
let globalState = {
  step: 0,
  emails: [],
  smtps: [],
  template: 'verification',
  customTemplate: '',
  stats: { sent: 0, success: 0, total: 0, obliterated: 0, bounced: 0 },
  providersActive: 0,
  leadsParsed: 0,
  campaigns: 0,
  abTesting: false
};

// Underground SMTP Harvester
async function harvestSMTPs() {
  const providers = [
    { host: 'smtp.mailinator.com', port: 587 },
    { host: 'smtp.guerrillamail.com', port: 587 },
    { host: 'smtp.yopmail.com', port: 587 },
    { host: 'smtp.10minutemail.com', port: 587 },
    { host: 'smtp.temp-mail.org', port: 587 }
    // Production: Add 100+ from dark pools
  ];

  const validSMTPS = [];
  for (const p of providers) {
    try {
      const transporter = nodemailer.createTransporter({
        host: p.host, port: p.port, secure: false,
        auth: { user: `blast_${uuidv4()}@${p.host}`, pass: '' }
      });
      await transporter.verify();
      validSMTPS.push(p);
    } catch {}
  }
  
  globalState.smtps = validSMTPS;
  globalState.providersActive = validSMTPS.length;
  return validSMTPS;
}

// Template Loader
async function loadTemplate(name) {
  const file = path.join(TEMPLATES_DIR, `${name}.html`);
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '<h1>🚨 URGENT ACTION REQUIRED</h1><a href="http://evil.com/verify">CLICK HERE</a>';
  }
}

// State Persistence
async function saveState() { await fs.writeFile(STATE_FILE, JSON.stringify(globalState, null, 2)); }
async function loadState() { 
  try { globalState = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } 
  catch { await saveState(); }
}

// API Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.post('/api/step1', async (req, res) => {
  globalState.step = 1;
  globalState.emails = req.body.emails.split('\n').map(e => e.trim()).filter(Boolean);
  globalState.leadsParsed = globalState.emails.length;
  globalState.stats.total = globalState.emails.length;
  await saveState();
  res.json({ success: true, leads: globalState.emails.length });
});

app.post('/api/step2', async (req, res) => {
  globalState.step = 2;
  await harvestSMTPs();
  await saveState();
  res.json({ providers: globalState.providersActive });
});

app.post('/api/blast', async (req, res) => {
  globalState.step = 3;
  globalState.template = req.body.template;
  globalState.customTemplate = req.body.custom || '';
  globalState.campaigns++;
  
  // Load template content
  const templateContent = globalState.customTemplate || 
    await loadTemplate(globalState.template);
  
  // BLAST MACHINE (2s intervals)
  const blastJob = cron.schedule('*/2 * * * * *', async () => {
    if (!globalState.smtps.length || !globalState.emails.length) {
      blastJob.stop();
      return;
    }
    
    const smtp = globalState.smtps[0];
    const target = globalState.emails.pop();
    
    try {
      const transporter = nodemailer.createTransporter({
        host: smtp.host, port: smtp.port, secure: false
      });
      
      await transporter.sendMail({
        from: `security@${smtp.host}`,
        to: target,
        subject: `🚨 ${AI_TEMPLATES[globalState.template]?.name || 'URGENT'}`,
        html: templateContent.replace('{{target}}', target)
      });
      
      globalState.stats.success++;
      globalState.stats.sent++;
      globalState.stats.obliterated++;
      
    } catch (e) {
      globalState.stats.bounced++;
      globalState.smtps.shift(); // Rotate
      globalState.providersActive--;
    }
    
    await saveState();
  });
  
  blastJob.start();
  res.json({ success: true, message: '💥 TOTAL OBLITERATION INITIATED' });
});

app.get('/api/stats', async (req, res) => {
  await loadState();
  const rate = globalState.stats.total ? 
    ((globalState.stats.success / globalState.stats.total) * 100).toFixed(1) : 0;
    
  res.json({
    step: globalState.step,
    stats: globalState.stats,
    successRate: rate,
    providersActive: globalState.providersActive,
    leadsParsed: globalState.leadsParsed,
    campaigns: globalState.campaigns,
    emailsRemaining: globalState.emails.length,
    currentTemplate: globalState.template,
    templates: AI_TEMPLATES
  });
});

app.get('/api/templates/:name', async (req, res) => {
  const content = await loadTemplate(req.params.name);
  res.json({ html: content });
});

app.listen(PORT, async () => {
  await loadState();
  console.log(`🎯 MagicSender v5.3 GOD MODE | Port ${PORT} | Campaigns: ${globalState.campaigns}`);
});
