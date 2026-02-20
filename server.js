import express from 'express';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ FIXED: createTransport (not createTransporter)
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});


/* =========================================================
   BULK MAIL LOGIC (DATE RANGE → ALL INVIGILATORS)
========================================================= */
async function sendBulkInvigilationMails(fromDate, toDate) {
  console.log(`📩 Bulk mail started | ${fromDate} → ${toDate}`);

  try {
    const { data: invigilations, error } = await supabase
      .from('invigilation')
      .select(`
        invigilation_id,
        date,
        start_time,
        end_time,
        qids,
        hall_id,
        venue_id,
        mail_sent,
        force_resend
      `)
      .gte('date', fromDate)
      .lte('date', toDate)
      .or('mail_sent.eq.false,force_resend.eq.true');

    if (error) {
      console.error('❌ Invigilation fetch error:', error.message);
      return;
    }

    if (!invigilations?.length) {
      console.log('ℹ️ No invigilation records found');
      return;
    }

    const personMap = {};
    const invigilationIds = new Set();
    let anyFailure = false;

    for (const inv of invigilations) {
      const { data: hall } = await supabase
        .from('halls')
        .select('hall_name, floor')
        .eq('hall_id', inv.hall_id)
        .single();

      const { data: venue } = await supabase
        .from('venues')
        .select('venue_name')
        .eq('venue_id', inv.venue_id)
        .single();

      for (const qid of inv.qids) {
        if (!personMap[qid]) {
          const { data: user } = await supabase
            .from('users')
            .select('name, mail_id, type')
            .eq('qid', qid)
            .single();

          if (!user?.mail_id) {
            console.error(`❌ Mail missing for QID: ${qid}`);
            anyFailure = true;
            continue;
          }

          let idLabel = 'QID';
          let idValue = qid;

          if (user.type === 'Staff') {
            const { data: staff } = await supabase
              .from('staff_details')
              .select('eid')
              .eq('qid', qid)
              .single();
            if (staff?.eid) {
              idLabel = 'EID';
              idValue = staff.eid;
            }
          } else if (user.type === 'Student') {
            const { data: student } = await supabase
              .from('student_details')
              .select('htno')
              .eq('qid', qid)
              .single();
            if (student?.htno) {
              idLabel = 'HTNO';
              idValue = student.htno;
            }
          }

          personMap[qid] = {
            name: user.name,
            mail: user.mail_id,
            idLabel,
            idValue,
            duties: []
          };
        }

        personMap[qid].duties.push({
          date: inv.date,
          time: `${new Date(inv.start_time).toLocaleTimeString()} – ${new Date(inv.end_time).toLocaleTimeString()}`,
          venue: venue?.venue_name,
          hall: hall?.hall_name,
          floor: hall?.floor
        });

        invigilationIds.add(inv.invigilation_id);
      }
    }

    // SEND ONE MAIL PER PERSON
    for (const qid in personMap) {
      const p = personMap[qid];

      const rows = p.duties.map(d => `
        <tr>
          <td>${d.date}</td>
          <td>${d.time}</td>
          <td>${d.venue}</td>
          <td>${d.hall}</td>
          <td>${d.floor}</td>
        </tr>
      `).join('');

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <p>Dear <strong>${p.name}</strong> (${p.idLabel}: ${p.idValue}),</p>
          <p>You are assigned the following invigilation duties for <strong>Spring Semester Minor-1 2025-26</strong>:</p>

          <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%; margin: 20px 0;">
            <thead style="background:#4CAF50; color: white;">
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Venue</th>
                <th>Hall</th>
                <th>Floor</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p><strong>Instructions:</strong></p>
          <p><strong>1. All invigilators are expected to report to the allotted exam room at least 20 minutes before start of the exam for smooth operation of the QP collection/distribution.</strong></p>
          <p><strong>2. Request all faculty/Non-faculty colleagues to please observe the “NO CELL PHONE/LAPTOP” usage during the duty period.</strong></p>
          <p><strong>3. The question papers will be distributed exactly at 10:00 AM. Please ensure that all students are expected to be seated in their designated places by 9:50 AM – however, we estimate that few students will enter post this time – and hence NO students will be allowed to enter the exam room after 10:00 AM under any circumstances.</strong></p>
          <p><strong>4. The students are required to report to the examination centers at Mahindra University with their MU identity card (ID) at 9.30 AM onward. In the event of a lost ID card or if a student is not carrying their ID card, they will be liable for a penalty of Rs. 5000/-, which can only be paid through the QR code (using PhonePe, G Pay, Paytm, etc.) available at the check-in desk for obtaining a new or temporary ID card.</strong></p>
          <p><strong>5. Cell phones, smartwatches, notes, papers, and bags are strictly prohibited in the examination hall. Students need to bring their own pens, pencils, scientific (non-programmable) calculator, ruler, and erasers; borrowing from other students will not be allowed. If any student is found carrying any banned item during the examination, their exam paper will be immediately confiscated and awarded ‘ZERO MARK’. There will be random physical frisking in each exam room.</strong></p>
          <p><strong>6. Students will be permitted to leave the exam room only after completing the first one hour.</strong></p>
          <p><strong>7. No wash room break for Minors and supplementary exams!</strong></p>
          
          
          <p><em>This is a noreply email. For any queries please contact: <a href="murtaza.bohra@mahindrauniversity.edu.in">murtaza.bohra@mahindrauniversity.edu.in</a></em></p>
          <p>Thank you for your cooperation.</p>
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p><strong>Warm Regards,</strong></p>
            <p><strong>Prof. Murtaza Bohra</strong><br>
            Controller of Examinations<br>
            <strong>Mahindra University, Hyderabad</strong></p>
          </div>
        </div>
      `;

      try {
        await transporter.sendMail({
          from: `"Examination Cell" <${process.env.MAIL_USER}>`,
          to: p.mail,
          subject: 'Invigilation Duties - End Sem Minor 1 2025-26',
          html,
          text: 'Please view this email in HTML format.'
        });
        console.log(`✅ Bulk mail sent to ${p.mail}`);
      } catch (err) {
        console.error(`❌ Mail failed for ${p.mail}:`, err.message);
        anyFailure = true;
      }
    }

    if (!anyFailure) {
      await supabase
        .from('invigilation')
        .update({
          mail_sent: true,
          mail_sent_at: new Date(),
          force_resend: false
        })
        .in('invigilation_id', Array.from(invigilationIds));
      console.log('🎉 Bulk mails completed & flags updated');
    } else {
      console.warn('⚠️ Some mails failed. Flags NOT updated.');
    }

  } catch (err) {
    console.error('🔥 Bulk mail error:', err.message);
  }
}

/* =========================================================
   SINGLE PERSON MAIL (BY EID OR HTNO)
========================================================= */
app.post('/send-mails/by-id', async (req, res) => {
  const { idValue, fromDate, toDate } = req.body;

  if (!idValue || !fromDate || !toDate) {
    return res.status(400).json({
      message: 'idValue, fromDate and toDate are required'
    });
  }

  try {
    let qid = null;
    let idLabel = '';

    // Try STAFF (EID)
    const { data: staff } = await supabase
      .from('staff_details')
      .select('qid, eid')
      .eq('eid', idValue)
      .single();

    if (staff?.qid) {
      qid = staff.qid;
      idLabel = 'EID';
    }

    // Try STUDENT (HTNO)
    if (!qid) {
      const { data: student } = await supabase
        .from('student_details')
        .select('qid, htno')
        .eq('htno', idValue)
        .single();

      if (student?.qid) {
        qid = student.qid;
        idLabel = 'HTNO';
      }
    }

    if (!qid) {
      return res.status(404).json({ message: 'Invalid EID / HTNO' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('name, mail_id')
      .eq('qid', qid)
      .single();

    if (!user?.mail_id) {
      return res.status(400).json({ message: 'Mail ID not found' });
    }

    const { data: invigilations } = await supabase
      .from('invigilation')
      .select(`
        date,
        start_time,
        end_time,
        hall_id,
        venue_id,
        qids
      `)
      .gte('date', fromDate)
      .lte('date', toDate)
      .contains('qids', [qid]);

    if (!invigilations?.length) {
      return res.json({ message: 'No invigilation duties found' });
    }

    const duties = [];

    for (const inv of invigilations) {
      const { data: hall } = await supabase
        .from('halls')
        .select('hall_name, floor')
        .eq('hall_id', inv.hall_id)
        .single();

      const { data: venue } = await supabase
        .from('venues')
        .select('venue_name')
        .eq('venue_id', inv.venue_id)
        .single();

      duties.push({
        date: inv.date,
        time: `${new Date(inv.start_time).toLocaleTimeString()} – ${new Date(inv.end_time).toLocaleTimeString()}`,
        venue: venue?.venue_name,
        hall: hall?.hall_name,
        floor: hall?.floor
      });
    }

    const rows = duties.map(d => `
      <tr>
        <td>${d.date}</td>
        <td>${d.time}</td>
        <td>${d.venue}</td>
        <td>${d.hall}</td>
        <td>${d.floor}</td>
      </tr>
    `).join('');

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>Dear <strong>${user.name}</strong> (${idLabel}: ${idValue}),</p>
        <p>Your invigilation duties for <strong>Spring Semester Minor-1 2025-26</strong> are as follows:</p>

        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%; margin: 20px 0;">
          <thead style="background:#4CAF50; color: white;">
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Venue</th>
            <th>Hall</th>
            <th>Floor</th>
          </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p><strong>Instructions:</strong></p>
        <p><strong>1. All invigilators are expected to report to the allotted exam room at least 20 minutes before start of the exam for smooth operation of the QP collection/distribution.</strong></p>
        <p><strong>2. Request all faculty/Non-faculty colleagues to please observe the “NO CELL PHONE/LAPTOP” usage during the duty period.</strong></p>
        <p><strong>3. The question papers will be distributed exactly at 10:00 AM. Please ensure that all students are expected to be seated in their designated places by 9:50 AM – however, we estimate that few students will enter post this time – and hence NO students will be allowed to enter the exam room after 10:00 AM under any circumstances.</strong></p>
        <p><strong>4. The students are required to report to the examination centers at Mahindra University with their MU identity card (ID) at 9.30 AM onward. In the event of a lost ID card or if a student is not carrying their ID card, they will be liable for a penalty of Rs. 5000/-, which can only be paid through the QR code (using PhonePe, G Pay, Paytm, etc.) available at the check-in desk for obtaining a new or temporary ID card.</strong></p>
        <p><strong>5. Cell phones, smartwatches, notes, papers, and bags are strictly prohibited in the examination hall. Students need to bring their own pens, pencils, scientific (non-programmable) calculator, ruler, and erasers; borrowing from other students will not be allowed. If any student is found carrying any banned item during the examination, their exam paper will be immediately confiscated and awarded ‘ZERO MARK’. There will be random physical frisking in each exam room.</strong></p>
        <p><strong>6. Students will be permitted to leave the exam room only after completing the first one hour.</strong></p>
        <p><strong>7. No wash room break for Minors and supplementary exams!</strong></p>

        <p><em>This is a noreply email. For any queries please contact: <a href="mailto:murtaza.bohra@mahindrauniversity.edu.in">murtaza.bohra@mahindrauniversity.edu.in</a></em></p>
        <p>Thank you for your cooperation.</p>
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
          <p><strong>Warm Regards,</strong></p>
          <p><strong>Prof. Murtaza Bohra</strong><br>
          Controller of Examinations<br>
          <strong>Mahindra University, Hyderabad</strong></p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"Examination Cell" <${process.env.MAIL_USER}>`,
      to: user.mail_id,
      subject: 'Invigilation Duties - Minor-1 2025-26',
      html,
      text: 'Please view this email in HTML format.'
    });

    console.log(`✅ Individual mail sent to ${user.mail_id}`);
    res.json({ message: `Mail sent to ${user.name}` });

  } catch (err) {
    console.error('❌ Individual mail error:', err.message);
    res.status(500).json({ message: 'Failed to send individual mail' });
  }
});

/* ---------------- BULK API ---------------- */
app.post('/send-mails', async (req, res) => {
  const { fromDate, toDate } = req.body;

  if (!fromDate || !toDate) {
    return res.status(400).json({ message: 'fromDate and toDate are required' });
  }

  await sendBulkInvigilationMails(fromDate, toDate);
  res.json({ message: 'Bulk mail process completed. Check logs.' });
});

/* ---------------- LOGIN API ---------------- */
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Check credentials from environment variables
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ success: false, message: 'Server configuration error' });
  }
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    res.json({ success: true, token: 'admin-token-123' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

/* ---------------- PROTECTED ROUTES ---------------- */
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

/* ---------------- START ---------------- */
app.listen(3000, () => {
  console.log('🚀 Server running at http://localhost:3000');
});
