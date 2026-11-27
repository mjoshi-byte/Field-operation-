// Seeds the 5-day OJT checklist from Appendix A of the blueprint, plus a few
// sample accounts so you can log in immediately. Safe to re-run (idempotent-ish:
// it skips seeding days if they already exist).
const { db } = require('./db');

const CHECKLIST = [
  {
    day_number: 1,
    title: 'Day 1: Rig handling',
    items: [
      { title: 'Pre-check the rig', subchecks: ['All camera and lens shown properly (zoomed)', 'Working of the rig shown in the mobile', 'Device id or ic number visible'] },
      { title: 'Pack the rig correctly', subchecks: ['Camera cables not bent', 'Chest camera clipped properly'] },
      { title: 'Install and remove the rig safely', subchecks: ['Step by step procedure followed', 'Head camera angle', 'No cables entangled with each other', 'Installation video done'] },
      { title: 'Repack after use', subchecks: ['Camera cables not bent', 'Chest camera clipped properly'] },
    ],
  },
  {
    day_number: 2,
    title: 'Day 2: Rig handling and apps',
    items: [
      { title: 'Repeat the Day 1 workflow', subchecks: ['Pre-check, rig tag, and camera lens inspection completed', 'Step-by-step rig installation on the worker followed', 'Head, chest, and wrist camera cables routed straight without entanglement', 'Installation video completed and shared'] },
      { title: 'Use IW Lens correctly', subchecks: ['Worker signup initiated via Outside US & Canada? Log in here', 'Worker first name, last name, email, and phone number entered', 'OTP verified and worker logged in successfully', 'Camera preview checked for Head, Chest, and Wrist feeds (framing and positioning verified)'] },
      { title: 'Use Prism correctly', subchecks: ['Scheduled visit opened and Start visit initiated at the site', 'Site photo captured and confirmed via GPS foreground sampling', 'Collector screen photographed showing legible Instacore unit ID and worker details', 'Evidence rounds uploaded with required site and collector screen photos'] },
      { title: 'Complete required status checks', subchecks: ['First 30-minute status check completed and validated', 'Camera indicator verified (solid red status confirmed)', 'Rig removal, post-check, and repacking done properly'] },
    ],
  },
  {
    day_number: 3,
    title: 'Day 3: Reporting and cadence',
    items: [
      { title: 'Complete the field workflow', subchecks: ['Pre-check, setup, and safe rig mounting completed on time', 'Live recording initiated without cable tension or FOV obstructions', 'Post-session rig removal and safe repacking executed'] },
      { title: 'Submit required reports', subchecks: ['SOD sent with Date, FO/DC names, Business ID, Devices count, Worker contact, and Instacore ID', 'MOD status shared reflecting active progress and interim milestones', 'EOD report submitted with total hours achieved, device status, and task description'] },
      { title: 'Send cadence updates on time', subchecks: ['Rig setup proof photo transmitted immediately after mounting', '30-minute status dispatches sent with green rig tag and screen metadata visible', '2-hour formal progress updates sent to IC without delay'] },
      { title: 'Ensure reports match evidence', subchecks: ['Logged recording time strictly aligns with Prism session duration', 'Device ID and OS version in photos match SOD/EOD details', 'Prism visit ended at the business location before departing for the office'] },
    ],
  },
  {
    day_number: 4,
    title: 'Day 4: Observation and field quality',
    items: [
      { title: 'Complete the field workflow', subchecks: ['Rig setup verified with worker performing assigned task', 'Prism visit started and start evidence uploaded on-site', 'Regular evidence rounds captured at required intervals', 'Clean EOD pack-up and return to office completed'] },
      { title: 'Observe rig use and recording during the session', subchecks: ['Workspace and assigned task clearly visible within viewfinder', 'Both hands and fingers clearly visible during task execution (no blocking)', 'Camera stability maintained (no excessive swinging, shaking, or wrong angles)', 'No PII captured in camera view during operations'] },
      { title: 'Report actual errors or SOP deviations', subchecks: ['Hardware or connection issues (Ethernet, SD card, Power Bank) resolved via SOP', 'Clear proof captured and IC informed immediately of persistent errors or business issues', 'Zero partial or fake recordings created'] },
      { title: 'Escalate potential NSFW concerns through the correct process', subchecks: ['Signals actively monitored: Child labour, any child present, pornography, drugs, nudity', 'Recording stopped immediately if minor under 18 or NSFW content appears', 'IC notified instantly regarding the incident and reason', 'SD card secured if content was recorded; email escalation triggered only if recorded', 'Strict protocol followed: No sharing, downloading, or forwarding of footage'] },
    ],
  },
  {
    day_number: 5,
    title: 'Day 5: Independent rig handling',
    items: [
      { title: 'Complete the full workflow without assistance', subchecks: ['Handled daily plan confirmation and gear collection independently', 'Traveled to site and coordinated directly with business owner and worker', 'Completed all Prism and IW Lens operations end-to-end'] },
      { title: 'Perform pre-check, packing and installation', subchecks: ['Rig condition, 100% battery, and camera lens integrity independently verified', 'Rig mounted and centered on worker with clean shoulder cable routing', 'Lens angles and unobstructed field of view confirmed', 'Rig setup verification photo shared with IC'] },
      { title: 'Check recording during the session', subchecks: ['30-minute status photos captured with sharp tag and screen visibility', '2-hour milestone updates transmitted to IC', 'Troubleshooting executed independently for any software/hardware warnings'] },
      { title: 'Remove, post-check and repack the rig', subchecks: ['Rig carefully unstrapped and detached from the data collector', 'Head and wrist cameras placed safely in rig pouch; cables kept straight', 'No cameras left inside the main storage bag', 'Equipment returned in fully functional order without damage'] },
      { title: 'Submit required evidence and reports', subchecks: ['Accurate SOD, cadence updates, and EOD report delivered on time', 'Prism visit closed on-site before leaving the business location', 'SD card, power bank, and rig handed over to IM/office with logs intact'] },
    ],
  },
];

function seedChecklist() {
  const existing = db.prepare('SELECT COUNT(*) c FROM ojt_days').get().c;
  if (existing > 0) {
    console.log('OJT checklist already seeded, skipping.');
    return;
  }
  CHECKLIST.forEach((day) => {
    const dayInfo = db.prepare('INSERT INTO ojt_days (day_number, title) VALUES (?,?)').run(day.day_number, day.title);
    day.items.forEach((item, idx) => {
      const itemInfo = db
        .prepare('INSERT INTO ojt_items (day_id, position, title) VALUES (?,?,?)')
        .run(dayInfo.lastInsertRowid, idx, item.title);
      item.subchecks.forEach((label, subIdx) => {
        db.prepare('INSERT INTO ojt_subchecks (item_id, position, label) VALUES (?,?,?)').run(
          itemInfo.lastInsertRowid,
          subIdx,
          label
        );
      });
    });
  });
  console.log('Seeded 5-day OJT checklist from Appendix A.');
}

function seedUsers() {
  const existing = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (existing > 0) {
    console.log('Users already exist, skipping sample accounts.');
    return;
  }
  const insert = db.prepare(
    `INSERT INTO users (name, mobile_number, city, preferred_language, role, stage) VALUES (?,?,?,?,?,?)`
  );
  const admin = insert.run('Khalid (Admin)', '9000000001', 'Bengaluru', 'en', 'admin', null);
  insert.run('Asha (Trainer)', '9000000002', 'Bengaluru', 'en', 'trainer', null);
  insert.run('Rahul (Supervisor)', '9000000003', 'Bengaluru', 'en', 'supervisor', null);
  const fo = insert.run('Priya (FO)', '9000000004', 'Bengaluru', 'hi', 'fo', 'ojt');

  // Give the sample FO Day 1 unlocked
  const days = db.prepare('SELECT * FROM ojt_days ORDER BY day_number').all();
  days.forEach((day, idx) => {
    db.prepare('INSERT INTO ojt_fo_days (fo_id, day_id, status) VALUES (?,?,?)').run(
      fo.lastInsertRowid,
      day.id,
      idx === 0 ? 'in_progress' : 'locked'
    );
  });

  console.log('Seeded sample accounts (sign in with the mobile numbers below, OTP is logged to console):');
  console.log('  Admin:      9000000001');
  console.log('  Trainer:    9000000002');
  console.log('  Supervisor: 9000000003');
  console.log('  FO:         9000000004');
}

seedChecklist();
seedUsers();
console.log('Seed complete.');
